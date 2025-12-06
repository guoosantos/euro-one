import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const defaultState = { data: null, loading: false, error: null, lastUpdated: null };

export function usePolling({ fetchFn, intervalMs = 10_000, enabled = true } = {}) {
  const [state, setState] = useState(() => ({ ...defaultState, loading: Boolean(enabled) }));
  const timerRef = useRef(null);
  const isMountedRef = useRef(false);
  const isRunningRef = useRef(false);
  const requestIdRef = useRef(0);
  const enabledRef = useRef(enabled);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const scheduleNext = useCallback(() => {
    clearTimer();
    if (!enabledRef.current || !intervalMs) return;
    timerRef.current = setTimeout(() => {
      void runRef.current?.();
    }, intervalMs);
  }, [clearTimer, intervalMs]);

  const runRef = useRef(null);

  const run = useCallback(async () => {
    if (!enabledRef.current || isRunningRef.current) return;

    isRunningRef.current = true;
    const requestId = Date.now();
    requestIdRef.current = requestId;

    setState((prev) => ({ ...prev, loading: true }));

    try {
      const result = await fetchFn();
      if (!isMountedRef.current || requestIdRef.current !== requestId || !enabledRef.current) return;
      setState({ data: result ?? null, loading: false, error: null, lastUpdated: new Date() });
    } catch (error) {
      if (!isMountedRef.current || requestIdRef.current !== requestId || !enabledRef.current) return;
      setState((prev) => ({
        ...prev,
        loading: false,
        error: error instanceof Error ? error : new Error(error?.message || "Erro desconhecido"),
      }));
    } finally {
      if (requestIdRef.current === requestId) {
        isRunningRef.current = false;
        if (isMountedRef.current && enabledRef.current) {
          scheduleNext();
        }
      }
    }
  }, [fetchFn, scheduleNext]);

  useEffect(() => {
    enabledRef.current = enabled;
    if (!enabled) {
      clearTimer();
      isRunningRef.current = false;
      setState((prev) => ({ ...prev, loading: false }));
    } else if (isMountedRef.current) {
      void run();
    }
  }, [clearTimer, enabled, run]);

  useEffect(() => {
    isMountedRef.current = true;
    runRef.current = run;
    if (enabledRef.current) {
      void run();
    }
    return () => {
      isMountedRef.current = false;
      enabledRef.current = false;
      clearTimer();
    };
  }, [clearTimer, run]);

  const refresh = useCallback(() => {
    if (!enabledRef.current) return;
    clearTimer();
    return run();
  }, [clearTimer, run]);

  return useMemo(
    () => ({
      data: state.data,
      loading: Boolean(state.loading),
      error: state.error,
      lastUpdated: state.lastUpdated,
      refresh,
    }),
    [state.data, state.loading, state.error, state.lastUpdated, refresh],
  );
}

export default usePolling;
