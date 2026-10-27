import { ProviderError } from "../types.ts";

/** Base URL of the market bridge (server/market-bridge.ts), honouring Vite's `base`. */
export function bridgeUrl(path: string): string {
  const base = (import.meta.env.BASE_URL ?? "/").replace(/\/$/, "");
  return `${base}/api/market/${path}`;
}

/** GET JSON from the bridge; bridge errors become ProviderErrors carrying the status. */
export async function bridgeGet<T>(
  provider: string,
  path: string,
  params: Record<string, string | number | undefined>,
  fetchImpl: typeof fetch,
  signal?: AbortSignal,
): Promise<T> {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") q.set(k, String(v));
  let res: Response;
  try {
    res = await fetchImpl(`${bridgeUrl(path)}?${q.toString()}`, { signal });
  } catch (err) {
    if ((err as Error).name === "AbortError") throw err;
    throw new ProviderError(provider, `bridge unreachable (${(err as Error).message})`);
  }
  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      // Not JSON (e.g. the static host has no bridge): keep the status.
      if (res.status === 404) message = "market bridge not available (run `npm run dev` or `npm run preview`)";
    }
    throw new ProviderError(provider, message, res.status);
  }
  return (await res.json()) as T;
}
