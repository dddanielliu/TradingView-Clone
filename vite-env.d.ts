/// <reference types="vite/client" />

interface GoogleAccountsId {
  initialize(config: {
    client_id: string;
    callback: (response: { credential: string }) => void;
  }): void;
  renderButton(element: HTMLElement, options: Record<string, string>): void;
  prompt(): void;
}

interface Window {
  google?: {
    accounts: {
      id: GoogleAccountsId;
    };
  };
}

interface ImportMetaEnv {
  /**
   * Market-data providers, comma-separated, tried in order per symbol:
   * yahoo, binance, tradingview, or demo (bundled offline data).
   * Default: "yahoo,binance,tradingview".
   */
  readonly VITE_DATA_PROVIDERS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
