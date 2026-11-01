"use client";

import { useCallback, useRef, useState } from "react";

/**
 * Client-side guard against duplicate requests: `run(fn)` is ignored while a previous call is
 * still pending, and `pending` drives disabled/busy UI. Use it for every button that calls the API.
 */
export function useSingleFlight() {
  const busy = useRef(false);
  const [pending, setPending] = useState(false);
  const run = useCallback(async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
    if (busy.current) return undefined;
    busy.current = true;
    setPending(true);
    try {
      return await fn();
    } finally {
      busy.current = false;
      setPending(false);
    }
  }, []);
  return { pending, run };
}
