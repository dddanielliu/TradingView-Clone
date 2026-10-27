import { describe, expect, it, vi } from "vitest";
import type { CandleRequest } from "../adapter/types.ts";
import { candlesFrom, createCompositeMarketData } from "../market/composite.ts";
import { createBinanceProvider } from "../market/providers/binance.ts";
import { createYahooProvider } from "../market/providers/yahoo.ts";
import { makeSymbol } from "../market/symbols.ts";
import { type MarketProvider, ProviderError } from "../market/types.ts";
import type { Candle } from "../services/schemas.ts";

const candle = (time: number, close = 1): Candle => ({ time, open: close, high: close, low: close, close, volume: 1 });

function fakeProvider(id: string, opts: Partial<MarketProvider> & { handles?: (s: string) => boolean } = {}): MarketProvider {
  return {
    id,
    canHandle: opts.handles ?? (() => true),
    search: opts.search ?? (async () => []),
    resolve: opts.resolve ?? (async (s) => makeSymbol({ id: s })),
    getCandles: opts.getCandles ?? (async () => []),
    getStats: opts.getStats ?? (async () => null),
    setInterest: opts.setInterest ?? (() => undefined),
  };
}

const req = (over: Partial<CandleRequest> = {}): CandleRequest => ({ symbol: "NASDAQ:AAPL", timeframe: "1h", limit: 10, ...over });

describe("composite market data", () => {
  it("falls back to the next provider when one is rate-limited, and remembers who served", async () => {
    const yahoo = fakeProvider("yahoo", {
      getCandles: vi.fn(async () => {
        throw new ProviderError("yahoo", "HTTP 429", 429);
      }),
    });
    const tv = fakeProvider("tradingview", { getCandles: vi.fn(async () => [candle(60), candle(120)]) });
    const md = createCompositeMarketData([yahoo, tv]);

    const rows = await md.getCandles(req());
    expect(rows).toHaveLength(2);
    expect(md.getActiveProvider("NASDAQ:AAPL")).toBe("tradingview");

    // Yahoo is cooling down now: the next request goes to TradingView first.
    await md.getCandles(req());
    expect(yahoo.getCandles).toHaveBeenCalledTimes(1);
    expect(tv.getCandles).toHaveBeenCalledTimes(2);
  });

  it("only routes to providers that can handle the id", async () => {
    const binance = fakeProvider("binance", {
      handles: (s) => s.startsWith("BINANCE:"),
      getCandles: vi.fn(async () => [candle(60)]),
    });
    const tv = fakeProvider("tradingview", { getCandles: vi.fn(async () => [candle(60)]) });
    const md = createCompositeMarketData([binance, tv]);
    await md.getCandles(req({ symbol: "NASDAQ:AAPL" }));
    expect(binance.getCandles).not.toHaveBeenCalled();
    await md.getCandles(req({ symbol: "BINANCE:BTCUSDT" }));
    expect(binance.getCandles).toHaveBeenCalledTimes(1);
  });

  it("treats an empty scroll-back window as an answer, not a failure", async () => {
    const a = fakeProvider("a", { getCandles: vi.fn(async () => []) });
    const b = fakeProvider("b", { getCandles: vi.fn(async () => [candle(60)]) });
    const md = createCompositeMarketData([a, b]);
    expect(await md.getCandles(req({ fromMs: 0, toMs: 60_000, limit: undefined }))).toEqual([]);
    expect(b.getCandles).not.toHaveBeenCalled();
    // Without a window, empty means "try someone else".
    expect(await md.getCandles(req())).toHaveLength(1);
  });

  it("throws with every provider's reason when all fail", async () => {
    const md = createCompositeMarketData([
      fakeProvider("a", { getCandles: async () => Promise.reject(new ProviderError("a", "down", 502)) }),
      fakeProvider("b", { getCandles: async () => Promise.reject(new ProviderError("b", "unknown symbol", 404)) }),
    ]);
    await expect(md.getCandles(req())).rejects.toThrow(/a: down.*b: unknown symbol/);
  });

  it("merges search results, dedupes by id and keeps going when a provider fails", async () => {
    const md = createCompositeMarketData([
      fakeProvider("yahoo", {
        search: async () => Promise.reject(new ProviderError("yahoo", "HTTP 429", 429)),
      }),
      fakeProvider("tradingview", {
        search: async () => [
          { id: "NASDAQ:AAPL", symbol: "AAPL", exchange: "NASDAQ", description: "Apple", type: "stock", provider: "tradingview" },
          { id: "CRYPTO:APPLEUSD", symbol: "APPLEUSD", exchange: "CRYPTO", description: "AppleSwap", type: "spot", provider: "tradingview" },
        ],
      }),
      fakeProvider("other", {
        search: async () => [
          { id: "nasdaq:aapl", symbol: "AAPL", exchange: "NASDAQ", description: "dup", type: "stock", provider: "other" },
        ],
      }),
    ]);
    const { results, errors } = await md.searchSymbols("aapl");
    expect(results.map((r) => r.id)).toEqual(["NASDAQ:AAPL", "CRYPTO:APPLEUSD"]);
    expect(errors).toEqual(["yahoo: HTTP 429"]);
  });

  it("resolves once, publishes the symbol and lists it", async () => {
    const resolve = vi.fn(async (s: string) => makeSymbol({ id: s, description: "Apple", type: "stock", tickSize: 0.01 }));
    const md = createCompositeMarketData([fakeProvider("tradingview", { resolve })]);
    const seen: string[] = [];
    md.onResolved((s) => seen.push(s.name));
    const changed = vi.fn();
    md.onSymbolsChange!(changed);

    const [a, b] = await Promise.all([md.resolveSymbol("NASDAQ:AAPL"), md.resolveSymbol("NASDAQ:AAPL")]);
    expect(a).toBe(b);
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(seen).toEqual(["NASDAQ:AAPL"]);
    expect(changed).toHaveBeenCalledTimes(1);
    expect((await md.getSymbols()).map((s) => s.name)).toEqual(["NASDAQ:AAPL"]);
    expect(a?.category).toBe("STOCK");
  });

  it("streams each symbol from the provider that serves it and forwards ticks", async () => {
    const interest: Record<string, string[]> = {};
    const make = (id: string, handles: (s: string) => boolean) =>
      fakeProvider(id, {
        handles,
        setInterest: (ids, emit) => {
          interest[id] = ids;
          for (const s of ids) emit({ symbol: s, bid: 1, ask: 2, timestamp: 0 });
        },
      });
    const md = createCompositeMarketData([
      make("binance", (s) => s.startsWith("BINANCE:")),
      make("tradingview", () => true),
    ]);
    const ticks: string[] = [];
    md.subscribe((e) => {
      if (e.type === "tick") ticks.push(e.symbol);
    });
    md.setSymbolInterest!(["BINANCE:BTCUSDT", "NASDAQ:AAPL"]);
    expect(interest).toEqual({ binance: ["BINANCE:BTCUSDT"], tradingview: ["NASDAQ:AAPL"] });
    expect(ticks.sort()).toEqual(["BINANCE:BTCUSDT", "NASDAQ:AAPL"]);
    // The last streamed price primes getQuote without a request.
    expect(await md.getQuote!("NASDAQ:AAPL")).toMatchObject({ bid: 1, ask: 2 });
  });
});

describe("binance provider", () => {
  const kline = (tSec: number) => [tSec * 1000, "1", "2", "0.5", "1.5", "10"];

  it("pages backwards past Binance's 1000-bar cap", async () => {
    const calls: URL[] = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      calls.push(url);
      const limit = Number(url.searchParams.get("limit"));
      const end = url.searchParams.get("endTime");
      const newest = end ? Math.floor((Number(end) + 1) / 1000) - 60 : 1_000_000 * 60;
      const rows = Array.from({ length: limit }, (_, i) => kline(newest - (limit - 1 - i) * 60));
      return new Response(JSON.stringify(rows));
    }) as unknown as typeof fetch;
    const p = createBinanceProvider({ fetchImpl });
    const rows = await p.getCandles({ symbol: "BINANCE:BTCUSDT", timeframe: "1m", limit: 1500 });
    expect(rows).toHaveLength(1500);
    expect(calls).toHaveLength(2);
    expect(calls[1]!.searchParams.get("limit")).toBe("500");
    expect(rows[0]!.time).toBeLessThan(rows[1]!.time);
  });

  it("turns HTTP errors into provider errors with the status", async () => {
    const fetchImpl = (async () => new Response("", { status: 451 })) as unknown as typeof fetch;
    const p = createBinanceProvider({ fetchImpl });
    await expect(p.getCandles({ symbol: "BINANCE:BTCUSDT", timeframe: "1h", limit: 5 })).rejects.toMatchObject({
      provider: "binance",
      status: 451,
    });
  });
});

describe("yahoo provider", () => {
  const chart = (timestamps: number[], close: number[]) => ({
    chart: {
      result: [
        {
          meta: { symbol: "AAPL", regularMarketPrice: 105, chartPreviousClose: 100, priceHint: 2, instrumentType: "EQUITY", longName: "Apple Inc." },
          timestamp: timestamps,
          indicators: { quote: [{ open: close, high: close, low: close, close, volume: close.map(() => 1) }] },
        },
      ],
      error: null,
    },
  });

  it("builds 4h from Yahoo's 1h bars and skips null padding", async () => {
    const h = 3600;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), "http://x");
      expect(url.pathname).toBe("/api/market/yahoo/chart");
      expect(url.searchParams.get("symbol")).toBe("AAPL");
      expect(url.searchParams.get("interval")).toBe("60m");
      const body = chart([0, h, 2 * h, 4 * h], [1, 2, 3, 4]);
      (body.chart.result[0]!.indicators.quote[0]!.close as (number | null)[])[2] = null;
      return new Response(JSON.stringify(body));
    }) as unknown as typeof fetch;
    const p = createYahooProvider({ fetchImpl });
    const rows = await candlesFrom(p, { symbol: "NASDAQ:AAPL", timeframe: "4h", limit: 10 });
    expect(rows.map((r) => [r.time, r.close])).toEqual([
      [0, 2],
      [4 * h, 4],
    ]);
  });

  it("reports the day change against the previous close", async () => {
    const fetchImpl = (async () => new Response(JSON.stringify(chart([], [])))) as unknown as typeof fetch;
    const stats = await createYahooProvider({ fetchImpl }).getStats("NASDAQ:AAPL");
    expect(stats).toMatchObject({ last: 105, change: 5, changePct: 5, prevClose: 100, provider: "yahoo" });
  });

  it("passes a bridge 429 through as a ProviderError so the composite can fall back", async () => {
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ error: "Yahoo HTTP 429: Too Many Requests", status: 429 }), { status: 429 })) as unknown as typeof fetch;
    await expect(createYahooProvider({ fetchImpl }).getStats("NASDAQ:AAPL")).rejects.toMatchObject({
      status: 429,
      message: "yahoo: Yahoo HTTP 429: Too Many Requests",
    });
  });
});
