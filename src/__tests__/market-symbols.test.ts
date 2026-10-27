import { describe, expect, it } from "vitest";
import { parseProviders } from "../market/config.ts";
import {
  aggregateCandles,
  barsWanted,
  cleanCandles,
  fromYahooTicker,
  normalizeCategory,
  parseId,
  tickFromPricescale,
  toYahooTicker,
  windowCandles,
} from "../market/symbols.ts";

const bar = (time: number, close: number, extra: Partial<{ open: number; high: number; low: number; volume: number }> = {}) => ({
  time,
  open: extra.open ?? close,
  high: extra.high ?? close,
  low: extra.low ?? close,
  close,
  volume: extra.volume ?? 1,
});

describe("symbol ids", () => {
  it("parses EXCHANGE:TICKER", () => {
    expect(parseId("nasdaq:aapl")).toEqual({ exchange: "NASDAQ", ticker: "AAPL" });
    expect(parseId("AAPL")).toEqual({ exchange: "", ticker: "AAPL" });
  });

  it.each([
    ["NASDAQ:AAPL", "AAPL"],
    ["NYSE:BRK.B", "BRK-B"],
    ["FX:EURUSD", "EURUSD=X"],
    ["OANDA:GBPJPY", "GBPJPY=X"],
    ["COINBASE:BTCUSD", "BTC-USD"],
    ["KRAKEN:ETHUSDT", "ETH-USD"],
    ["SP:SPX", "^GSPC"],
    ["TVC:VIX", "^VIX"],
    ["TVC:DXY", "DX-Y.NYB"],
    ["COMEX:GC1!", "GC=F"],
    ["CME_MINI:NQ1!", "NQ=F"],
    ["LSE:VOD", "VOD.L"],
    ["TSE:7203", "7203.T"],
    ["XETR:SAP", "SAP.DE"],
    ["YAHOO:^FTMC", "^FTMC"],
  ])("maps %s to Yahoo %s", (id, yahoo) => {
    expect(toYahooTicker(id)).toBe(yahoo);
  });

  it("refuses ids Yahoo can't serve", () => {
    expect(toYahooTicker("BINANCE:BTCUSDT")).toBeNull();
    expect(toYahooTicker("FX:NOTAPAIR")).toBeNull();
  });

  it.each([
    ["AAPL", "NMS", "NASDAQ:AAPL"],
    ["IBM", "NYQ", "NYSE:IBM"],
    ["BRK-B", "NYQ", "NYSE:BRK.B"],
    ["EURUSD=X", "CCY", "FX:EURUSD"],
    ["BTC-USD", "CCC", "COINBASE:BTCUSD"],
    ["^GSPC", "SNP", "SP:SPX"],
    ["GC=F", "CMX", "COMEX:GC1!"],
    ["VOD.L", "LSE", "LSE:VOD"],
    ["^FTMC", "FGI", "YAHOO:^FTMC"],
  ])("maps Yahoo %s (%s) back to %s", (ticker, exchange, id) => {
    expect(fromYahooTicker(ticker, exchange)).toBe(id);
  });

  it("round-trips the mapped ids", () => {
    for (const id of ["FX:EURUSD", "SP:SPX", "COMEX:GC1!", "LSE:VOD"]) {
      expect(fromYahooTicker(toYahooTicker(id)!)).toBe(id);
    }
    // A plain US ticker needs Yahoo's exchange code to tell NASDAQ from NYSE.
    expect(fromYahooTicker(toYahooTicker("NASDAQ:AAPL")!, "NMS")).toBe("NASDAQ:AAPL");
  });

  it("normalises provider types into categories", () => {
    expect(normalizeCategory("EQUITY")).toBe("STOCK");
    expect(normalizeCategory("cryptocurrency")).toBe("CRYPTO");
    expect(normalizeCategory("spot")).toBe("CRYPTO");
    expect(normalizeCategory("ETF")).toBe("FUND");
    expect(normalizeCategory(undefined)).toBe("OTHER");
  });

  it("derives the tick from pricescale and minmov", () => {
    expect(tickFromPricescale(100, 1)).toBe(0.01);
    expect(tickFromPricescale(100000, 5)).toBeCloseTo(0.00005);
    expect(tickFromPricescale(0, 1)).toBeNull();
  });
});

describe("providers config", () => {
  it("defaults to yahoo, binance, tradingview", () => {
    expect(parseProviders(undefined)).toEqual(["yahoo", "binance", "tradingview"]);
    expect(parseProviders("  ")).toEqual(["yahoo", "binance", "tradingview"]);
  });

  it("keeps order, drops unknown and duplicate entries", () => {
    expect(parseProviders("Binance, nope, yahoo,binance")).toEqual(["binance", "yahoo"]);
    expect(parseProviders("demo")).toEqual(["demo"]);
  });
});

describe("bars", () => {
  it("sorts, dedupes and drops broken rows", () => {
    const rows = cleanCandles([bar(120, 2), bar(60, 1), bar(120, 3), { ...bar(180, 4), close: NaN }]);
    expect(rows.map((r) => [r.time, r.close])).toEqual([
      [60, 1],
      [120, 3],
    ]);
  });

  it("aggregates 1h bars into epoch-aligned 4h bars", () => {
    const h = 3600;
    const rows = aggregateCandles(
      [
        bar(0, 10, { open: 9, high: 11, low: 8, volume: 1 }),
        bar(h, 12, { open: 10, high: 13, low: 10, volume: 2 }),
        bar(3 * h, 11, { open: 12, high: 12, low: 7, volume: 3 }),
        bar(4 * h, 15, { open: 11, high: 16, low: 11, volume: 4 }),
      ],
      4 * h,
    );
    expect(rows).toEqual([
      { time: 0, open: 9, high: 13, low: 7, close: 11, volume: 6 },
      { time: 4 * h, open: 11, high: 16, low: 11, close: 15, volume: 4 },
    ]);
  });

  it("applies the contract window: fromMs inclusive, toMs exclusive, newest `limit`", () => {
    const rows = [bar(60, 1), bar(120, 2), bar(180, 3), bar(240, 4)];
    expect(windowCandles(rows, { fromMs: 120_000, toMs: 240_000 }).map((r) => r.time)).toEqual([120, 180]);
    expect(windowCandles(rows, { limit: 2 }).map((r) => r.time)).toEqual([180, 240]);
  });

  it("sizes a request from its window when it has no limit", () => {
    expect(barsWanted({ timeframe: "1h", limit: 300 })).toBe(300);
    expect(barsWanted({ timeframe: "1h", fromMs: 0, toMs: 10 * 3_600_000 })).toBe(11);
    expect(barsWanted({ timeframe: "1h" })).toBe(500);
  });
});
