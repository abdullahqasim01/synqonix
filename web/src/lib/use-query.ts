"use client";

import { useCallback, useEffect, useState } from "react";
import { errorMessage } from "@/lib/api/client";

type Result<T> = { data?: T; error?: unknown };

/**
 * Tiny data-fetching hook around the typed API client.
 * `reload()` refetches without flashing the loading state.
 */
export function useQuery<T>(fetcher: () => Promise<Result<T>>, deps: unknown[]) {
  const [state, setState] = useState<{ data?: T; error?: string; loading: boolean }>({ loading: true });
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void fetcher().then(
      (res) => {
        if (cancelled) return;
        setState(res.data !== undefined ? { data: res.data, loading: false } : { error: errorMessage(res.error), loading: false });
      },
      (err: unknown) => !cancelled && setState({ error: err instanceof Error ? err.message : "Request failed", loading: false }),
    );
    return () => {
      cancelled = true;
    };
    // `deps` is the caller's dependency list for `fetcher`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, version]);

  const reload = useCallback(() => setVersion((v) => v + 1), []);
  return { ...state, reload };
}
