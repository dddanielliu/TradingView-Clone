import { createCompositeMarketData, type LiveMarketData } from "../market/composite.ts";
import { getConfiguredProviders } from "../market/config.ts";
import { createBinanceProvider } from "../market/providers/binance.ts";
import { createTradingViewProvider } from "../market/providers/tradingview.ts";
import { createYahooProvider } from "../market/providers/yahoo.ts";
import type { MarketProvider } from "../market/types.ts";
import * as engine from "../services/demo/engine.ts";
import { registerSymbol } from "../services/demo/instruments.ts";
import { createDemoAdapter } from "./demo.ts";
import type { OpenChartsAdapter } from "./types.ts";

/**
 * Live market data for any instrument, with the bundled paper-trading engine
 * behind it.
 *
 * Providers come from `VITE_DATA_PROVIDERS` (default `yahoo,binance,tradingview`)
 * and are tried in that order per symbol. Every tick marks the paper engine,
 * and every symbol the trader opens is registered with it, so paper orders work
 * on whatever is on the chart. The bundled demo tick feed is not started.
 */

const FACTORIES: Record<string, () => MarketProvider> = {
  yahoo: () => createYahooProvider(),
  binance: () => createBinanceProvider(),
  tradingview: () => createTradingViewProvider(),
};

export function createLiveMarketData(providerIds: readonly string[] = getConfiguredProviders()): LiveMarketData {
  const providers = providerIds.flatMap((id) => (FACTORIES[id] ? [FACTORIES[id]()] : []));
  return createCompositeMarketData(providers);
}

export function createLiveAdapter(providerIds?: readonly string[]): OpenChartsAdapter {
  const marketData = createLiveMarketData(providerIds);
  const paper = createDemoAdapter();

  marketData.onResolved((symbol) => registerSymbol(symbol));
  marketData.subscribe((event) => {
    if (event.type === "tick") engine.mark(event.symbol, (event.bid + event.ask) / 2);
  });

  // Prime the engine's price for a symbol as soon as a quote is read, so a
  // market order works before the first streamed tick.
  const getQuote = marketData.getQuote!.bind(marketData);
  marketData.getQuote = async (symbol) => {
    const quote = await getQuote(symbol);
    if (quote && quote.bid > 0) engine.mark(symbol, (quote.bid + quote.ask) / 2);
    return quote;
  };

  return {
    name: `live:${(providerIds ?? getConfiguredProviders()).join(",")}`,
    marketData,
    trading: paper.trading,
    storage: paper.storage,
  };
}
