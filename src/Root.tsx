import { useState } from "react";
import { createDemoAdapter } from "./adapter/demo.ts";
import { createLiveAdapter } from "./adapter/live.ts";
import { OpenChartsProvider } from "./adapter/provider.tsx";
import type { OpenChartsAdapter } from "./adapter/types.ts";
import { isDemoMode } from "./market/config.ts";
import { Terminal } from "./terminal/Terminal.tsx";

/**
 * The hosted app's root.
 *
 * Deliberately what an integrator would write: install an adapter, render the
 * terminal. Everything else — query cache, market-data stream, notifications,
 * error boundary — comes from `<OpenChartsProvider>`.
 *
 * The adapter follows `VITE_DATA_PROVIDERS` (see .env.example): live data from
 * Yahoo / Binance / TradingView-API by default, or `demo` for the bundled
 * offline history.
 */

function createAdapter(): OpenChartsAdapter {
  return isDemoMode() ? createDemoAdapter() : createLiveAdapter();
}

export function Root() {
  const [adapter] = useState<OpenChartsAdapter>(createAdapter);
  return (
    <OpenChartsProvider adapter={adapter}>
      <Terminal />
    </OpenChartsProvider>
  );
}
