import "server-only";

// Server-side de-duplication: while a task for `key` is running, other callers get the same
// promise instead of starting a second copy (double clicks, two tabs, autopilot + manual).
// Kept on globalThis because Next may load each route as a separate module instance.

const store = globalThis as { __singleFlight?: Map<string, Promise<unknown>> };
const inFlight = (store.__singleFlight ??= new Map());

export function singleFlight<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const running = inFlight.get(key) as Promise<T> | undefined;
  if (running) return running;
  const p = fn().finally(() => inFlight.delete(key));
  inFlight.set(key, p);
  return p;
}

export const isInFlight = (key: string) => inFlight.has(key);
