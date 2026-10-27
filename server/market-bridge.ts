import type { IncomingMessage, ServerResponse } from "node:http";
import type { Connect, Plugin } from "vite";

/**
 * Server half of the live market-data layer, mounted under `/api/market` by
 * both `vite` (dev) and `vite preview`.
 *
 * Two providers cannot run in a browser:
 *   - Yahoo Finance blocks cross-origin requests and wants a cookie + crumb.
 *   - TradingView-API (Mathieu2301, unofficial) has to set an `Origin` header
 *     on its websocket, which browsers forbid.
 * Both are reached from here and served to the page as plain JSON, with live
 * TradingView quotes streamed as Server-Sent Events. Binance needs no bridge.
 *
 *   GET /api/market/health
 *   GET /api/market/yahoo/search?q=&type=
 *   GET /api/market/yahoo/chart?symbol=&interval=&range=|period1=&period2=
 *   GET /api/market/tv/search?q=&type=
 *   GET /api/market/tv/symbol?symbol=
 *   GET /api/market/tv/candles?symbol=&timeframe=&count=&from=&to=   (seconds)
 *   GET /api/market/tv/quotes?symbols=a,b
 *   GET /api/market/tv/stream?symbols=a,b                            (SSE)
 *
 * Errors come back as `{ error, status }` with a 4xx/5xx status so the page
 * falls back to the next provider.
 */

export interface MarketBridgeOptions {
  /** Enabled providers (parsed VITE_DATA_PROVIDERS). */
  providers: string[];
  /** TradingView `sessionid` / `sessionid_sign` cookies — server-only, optional. */
  tvSession?: string;
  tvSignature?: string;
}

class BridgeError extends Error {
  constructor(
    message: string,
    readonly status = 502,
  ) {
    super(message);
  }
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

// ── Yahoo ──────────────────────────────────────────────────

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
const YAHOO_HOST = "https://query2.finance.yahoo.com";
const CRUMB_TTL_MS = 30 * 60_000;
/** After a 429, answer straight away for a while instead of hammering Yahoo. */
const YAHOO_COOLDOWN_MS = 60_000;

function createYahoo() {
  let session: { cookie: string; crumb: string; at: number } | null = null;
  let sessionPromise: Promise<{ cookie: string; crumb: string; at: number }> | null = null;
  let coolUntil = 0;

  async function handshake() {
    // fc.yahoo.com answers 404 but sets the A3 cookie the crumb is tied to.
    const first = await fetch("https://fc.yahoo.com/", { headers: { "User-Agent": UA }, redirect: "manual" });
    const cookie = first.headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .join("; ");
    const res = await fetch(`${YAHOO_HOST}/v1/test/getcrumb`, {
      headers: { "User-Agent": UA, ...(cookie ? { Cookie: cookie } : {}) },
    });
    const crumb = (await res.text()).trim();
    if (!res.ok || !crumb || crumb.includes(" ")) {
      throw new BridgeError(`Yahoo refused the session (HTTP ${res.status}${crumb ? `: ${crumb.slice(0, 60)}` : ""})`, res.status === 429 ? 429 : 502);
    }
    return { cookie, crumb, at: Date.now() };
  }

  async function getSession(fresh: boolean) {
    if (!fresh && session && Date.now() - session.at < CRUMB_TTL_MS) return session;
    sessionPromise ??= handshake().finally(() => {
      sessionPromise = null;
    });
    session = await sessionPromise;
    return session;
  }

  async function get(path: string, params: URLSearchParams): Promise<unknown> {
    if (Date.now() < coolUntil) {
      throw new BridgeError("Yahoo is rate-limiting this IP (cooling down)", 429);
    }
    for (let attempt = 0; attempt < 2; attempt++) {
      let s: { cookie: string; crumb: string } | null = null;
      try {
        s = await getSession(attempt > 0);
      } catch (err) {
        if (err instanceof BridgeError && err.status === 429) coolUntil = Date.now() + YAHOO_COOLDOWN_MS;
        throw err;
      }
      const q = new URLSearchParams(params);
      q.set("crumb", s.crumb);
      const res = await fetch(`${YAHOO_HOST}${path}?${q.toString()}`, {
        headers: { "User-Agent": UA, Cookie: s.cookie, Accept: "application/json" },
      });
      if (res.ok) return res.json();
      if ((res.status === 401 || res.status === 403 || res.status === 429) && attempt === 0) continue;
      if (res.status === 429) coolUntil = Date.now() + YAHOO_COOLDOWN_MS;
      const text = (await res.text().catch(() => "")).slice(0, 200);
      throw new BridgeError(`Yahoo HTTP ${res.status}${text ? `: ${text}` : ""}`, res.status === 404 ? 404 : res.status === 429 ? 429 : 502);
    }
    throw new BridgeError("Yahoo request failed", 502);
  }

  return {
    search: (q: string) =>
      get("/v1/finance/search", new URLSearchParams({ q, quotesCount: "25", newsCount: "0", listsCount: "0", enableFuzzyQuery: "false" })),
    chart: (symbol: string, params: URLSearchParams) =>
      get(`/v8/finance/chart/${encodeURIComponent(symbol)}`, params),
  };
}

// ── TradingView-API ────────────────────────────────────────

type TvData = typeof import("@mathieuc/tradingview/data");
type TvRoot = typeof import("@mathieuc/tradingview");
type TvClient = InstanceType<TvRoot["TradingViewClient"]>;

/** Our interval → TradingView's resolution: minutes as a count, then D / W / M. */
function tvResolution(tf: string): string {
  const m = /^(\d+)(m|h|d|w|M)$/.exec(tf);
  if (!m) return tf;
  const n = Number(m[1]);
  switch (m[2]) {
    case "m":
      return String(n);
    case "h":
      return String(n * 60);
    case "d":
      return `${n}D`;
    case "w":
      return `${n}W`;
    default:
      return `${n}M`;
  }
}

function createTradingView(opts: MarketBridgeOptions) {
  const credentials = opts.tvSession ? { session: opts.tvSession, signature: opts.tvSignature } : undefined;
  let libs: Promise<{ data: TvData; root: TvRoot }> | null = null;
  const load = () => {
    libs ??= Promise.all([import("@mathieuc/tradingview/data"), import("@mathieuc/tradingview")])
      .then(([data, root]) => ({ data, root }))
      .catch((err: unknown) => {
        libs = null;
        throw new BridgeError(`@mathieuc/tradingview is not installed (${(err as Error).message})`, 501);
      });
    return libs;
  };

  // One websocket shared by the one-shot calls; recreated if it dies.
  let client: TvClient | null = null;
  const shared = async () => {
    const { root } = await load();
    if (!client || client.isClosed) client = new root.TradingViewClient(credentials ? { credentials } : {});
    return client;
  };
  const run = async <T>(fn: (data: TvData, c: TvClient) => Promise<T>): Promise<T> => {
    const { data } = await load();
    const c = await shared();
    try {
      return await fn(data, c);
    } catch (err) {
      if (c.isClosed && client === c) client = null;
      const e = err as { code?: string; message?: string };
      const status = e.code === "SYMBOL_ERROR" || e.code === "NO_DATA" || e.code === "QUOTE_ERROR" ? 404 : 502;
      throw new BridgeError(`TradingView: ${e.code ? `${e.code} ` : ""}${e.message ?? String(err)}`, status);
    }
  };

  // ── live quotes: one watcher for the union of every open stream ──
  const listeners = new Map<string, Set<ServerResponse>>();
  let watcher: { stop(): Promise<void> } | null = null;
  let watching = "";
  let restartTimer: ReturnType<typeof setTimeout> | null = null;

  const broadcast = (symbol: string, payload: unknown) => {
    const set = listeners.get(symbol);
    if (!set) return;
    const line = `data: ${JSON.stringify(payload)}\n\n`;
    for (const res of set) res.write(line);
  };

  const restart = () => {
    if (restartTimer) clearTimeout(restartTimer);
    restartTimer = setTimeout(() => void rewatch(), 150);
  };

  async function rewatch() {
    const symbols = [...listeners.keys()].sort();
    const key = symbols.join(",");
    if (key === watching && watcher) return;
    const old = watcher;
    watcher = null;
    watching = key;
    await old?.stop().catch(() => undefined);
    if (symbols.length === 0) return;
    try {
      const { data } = await load();
      const w = await data.watchQuotes(
        { symbols, fields: ["lp", "lp_time", "bid", "ask", "ch", "chp", "volume", "open_price", "high_price", "low_price", "prev_close_price"], ...(credentials ? { credentials } : {}) },
        {
          onData: (symbol, quote) => broadcast(symbol, { symbol, ...quote }),
          onError: (error) => console.warn("[market-bridge] tradingview stream:", error.message),
        },
      );
      if (watching !== key) {
        await w.stop();
        return;
      }
      watcher = w;
      // No automatic reconnection in the library: start again when it closes.
      void w.closed.then(() => {
        if (watcher === w) {
          watcher = null;
          watching = "";
          if (listeners.size > 0) setTimeout(restart, 2_000);
        }
      });
    } catch (err) {
      console.warn("[market-bridge] tradingview stream failed:", (err as Error).message);
      watching = "";
      if (listeners.size > 0) setTimeout(restart, 5_000);
    }
  }

  return {
    search: (q: string, type?: string) =>
      run((data) => data.searchMarkets(q, type ? { type } : {})),
    symbol: (symbol: string) => run((data, client) => data.getSymbolInfo({ symbol, client })),
    quotes: (symbols: string[]) => run((data, client) => data.getQuotes({ symbols, client })),
    candles: (symbol: string, timeframe: string, count?: number, from?: number, to?: number) =>
      run((data, client) =>
        data.getCandles({
          symbol,
          timeframe: tvResolution(timeframe),
          client,
          ...(from != null ? { from, maxCount: 20_000 } : { count: count ?? 300 }),
          ...(to != null ? { to } : {}),
        }),
      ),
    stream(symbols: string[], req: IncomingMessage, res: ServerResponse) {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      });
      res.write(": connected\n\n");
      for (const s of symbols) {
        if (!listeners.has(s)) listeners.set(s, new Set());
        listeners.get(s)!.add(res);
      }
      restart();
      const ping = setInterval(() => res.write(": ping\n\n"), 15_000);
      req.on("close", () => {
        clearInterval(ping);
        for (const s of symbols) {
          const set = listeners.get(s);
          set?.delete(res);
          if (set && set.size === 0) listeners.delete(s);
        }
        restart();
      });
    },
  };
}

// ── routing ────────────────────────────────────────────────

function num(v: string | null): number | undefined {
  if (v == null || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function list(v: string | null): string[] {
  return (v ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 100);
}

export function createMarketMiddleware(opts: MarketBridgeOptions): Connect.NextHandleFunction {
  const yahoo = opts.providers.includes("yahoo") ? createYahoo() : null;
  const tv = opts.providers.includes("tradingview") ? createTradingView(opts) : null;

  return (req, res, next) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (!url.pathname.startsWith("/api/market/")) return next();
    const route = url.pathname.slice("/api/market/".length).replace(/\/$/, "");
    const p = url.searchParams;

    const handle = async (): Promise<unknown> => {
      if (route === "health") return { providers: opts.providers, yahoo: !!yahoo, tradingview: !!tv };

      if (route.startsWith("yahoo/")) {
        if (!yahoo) throw new BridgeError("yahoo is not in VITE_DATA_PROVIDERS", 404);
        if (route === "yahoo/search") return yahoo.search(p.get("q") ?? "");
        if (route === "yahoo/chart") {
          const symbol = p.get("symbol");
          if (!symbol) throw new BridgeError("symbol is required", 400);
          const q = new URLSearchParams();
          for (const k of ["interval", "range", "period1", "period2", "includePrePost", "events"]) {
            const v = p.get(k);
            if (v) q.set(k, v);
          }
          return yahoo.chart(symbol, q);
        }
      }

      if (route.startsWith("tv/")) {
        if (!tv) throw new BridgeError("tradingview is not in VITE_DATA_PROVIDERS", 404);
        if (route === "tv/search") return tv.search(p.get("q") ?? "", p.get("type") || undefined);
        if (route === "tv/symbol") {
          const symbol = p.get("symbol");
          if (!symbol) throw new BridgeError("symbol is required", 400);
          return tv.symbol(symbol);
        }
        if (route === "tv/quotes") return tv.quotes(list(p.get("symbols")));
        if (route === "tv/candles") {
          const symbol = p.get("symbol");
          const timeframe = p.get("timeframe") ?? "1d";
          if (!symbol) throw new BridgeError("symbol is required", 400);
          return tv.candles(symbol, timeframe, num(p.get("count")), num(p.get("from")), num(p.get("to")));
        }
        if (route === "tv/stream") {
          tv.stream(list(p.get("symbols")), req, res);
          return undefined;
        }
      }
      throw new BridgeError(`unknown route ${route}`, 404);
    };

    handle()
      .then((body) => {
        if (body !== undefined && !res.headersSent) sendJson(res, 200, body);
      })
      .catch((err: unknown) => {
        const status = err instanceof BridgeError ? err.status : 502;
        if (!res.headersSent) sendJson(res, status, { error: (err as Error).message, status });
      });
  };
}

/** Vite plugin: serve `/api/market/*` from `vite` and `vite preview`. */
export function marketBridge(opts: MarketBridgeOptions): Plugin {
  const middleware = createMarketMiddleware(opts);
  return {
    name: "market-bridge",
    configureServer(server) {
      server.middlewares.use(middleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware);
    },
  };
}
