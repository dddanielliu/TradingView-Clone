import { useSyncExternalStore } from "react";
import { safeStorage } from "../lib/safe-storage.ts";

/**
 * Light / dark theme, TradingView-style: switched from the main menu and
 * remembered; the first visit follows the operating system.
 *
 * Applied as a `light` / `dark` class on <html>, which is what the scoped
 * stylesheet's theme selectors key off (see postcss.config.js).
 */

export type Theme = "light" | "dark";

const KEY = "tv_theme";
const listeners = new Set<() => void>();

function systemTheme(): Theme {
  if (typeof window === "undefined" || !window.matchMedia) return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function readTheme(): Theme {
  const saved = safeStorage.getItem(KEY);
  return saved === "dark" || saved === "light" ? saved : systemTheme();
}

let current: Theme = readTheme();

function apply(theme: Theme): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.classList.toggle("dark", theme === "dark");
  root.classList.toggle("light", theme === "light");
  root.style.colorScheme = theme;
}

apply(current);

export function getTheme(): Theme {
  return current;
}

export function setTheme(theme: Theme): void {
  current = theme;
  safeStorage.setItem(KEY, theme);
  apply(theme);
  for (const l of listeners) l();
}

export function toggleTheme(): void {
  setTheme(current === "dark" ? "light" : "dark");
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useTheme(): Theme {
  return useSyncExternalStore(subscribe, getTheme, getTheme);
}
