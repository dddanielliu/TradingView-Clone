import { useSyncExternalStore } from "react";

/**
 * Where TradingView would show an upgrade or sign-up prompt, or a feature this
 * clone does not have, the page shows "Oops, Not available" instead. Any
 * control calls `notAvailable("Compare symbols")`; <NotAvailableDialog/>
 * renders whichever feature was asked for last.
 */

let current: string | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}

export function notAvailable(feature: string): void {
  current = feature;
  emit();
}

export function dismissNotAvailable(): void {
  current = null;
  emit();
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

const read = () => current;

export function useNotAvailable(): string | null {
  return useSyncExternalStore(subscribe, read, read);
}
