import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { marketBridge } from "./server/market-bridge.ts";

/** Same parsing and default as src/market/config.ts. */
function enabledProviders(raw: string | undefined): string[] {
  const list = (raw ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return list.length > 0 ? list : ["yahoo", "binance", "tradingview"];
}

export default defineConfig(({ mode }) => {
  // `""` prefix: also read the server-only TV_SESSIONID / TV_SESSIONID_SIGN,
  // which never reach the browser bundle (only VITE_* do).
  const env = { ...loadEnv(mode, process.cwd(), ""), ...process.env };
  return {
    // GitHub Pages serves a project site from /<repo>/, so the demo workflow sets
    // BASE_PATH. Local builds and self-hosting stay at the domain root.
    base: process.env.BASE_PATH ?? "/",
    plugins: [
      react(),
      // Yahoo Finance and TradingView-API under /api/market (dev and preview).
      marketBridge({
        providers: enabledProviders(env.VITE_DATA_PROVIDERS),
        tvSession: env.TV_SESSIONID || undefined,
        tvSignature: env.TV_SESSIONID_SIGN || undefined,
      }),
    ],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
        "@propsim/types": path.resolve(__dirname, "./src/vendor/types.ts"),
      },
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes("node_modules")) {
              if (
                id.includes("/react/") ||
                id.includes("/react-dom/") ||
                id.includes("/react-router") ||
                id.includes("/@radix-ui/") ||
                id.includes("/@tanstack/") ||
                id.includes("/zustand/") ||
                id.includes("/scheduler/")
              ) {
                return "vendor-react";
              }
              if (id.includes("/lucide-react/")) {
                return "vendor-icons";
              }
            }
          },
        },
      },
    },
    server: {
      port: 5173,
      // /api/market is served by the market bridge above; anything else under
      // /api still goes to an optional local backend.
      proxy: {
        "^/api/(?!market/)": {
          target: "http://localhost:3000",
          changeOrigin: true,
        },
        "/ws": {
          target: "ws://localhost:3000",
          ws: true,
        },
      },
    },
  };
});
