import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export function usePollingResource(fetcher, {
  interval = 5_000,
  enabled = true,
  backoffFactor = 2,
  maxInterval = 60_000,
  initialData = null,
  pauseWhenHidden = true,
} = {}) {
  const [state, setState] = useState({ data: initialData, loading: Boolean(enabled), error: null, fetchedAt: null });
  const timerRef = useRef(null);
  const abortRef = useRef(null);
  const stoppedRef = useRef(false);
  const intervalRef = useRef(interval);
  const visibilityRef = useRef(typeof document === "undefined" ? "visible" : document.visibilityState);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const schedule = useCallback((delay) => {
    clearTimer();
    if (!enabled || stoppedRef.current) return;
    const nextDelay = Number.isFinite(delay) ? delay : intervalRef.current;
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      void run();
    }, nextDelay);
  }, [clearTimer, enabled]);

  const run = useCallback(async () => {
    if (!enabled || stoppedRef.current) return;
    if (pauseWhenHidden && visibilityRef.current === "hidden") {
      schedule(intervalRef.current);
      return;
    }
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setState((prev) => ({ ...prev, loading: true }));

    try {
      const result = await fetcher({ signal: controller.signal });
      if (controller.signal.aborted) return;
      intervalRef.current = interval;
      setState({ data: result ?? initialData, loading: false, error: null, fetchedAt: new Date() });
      schedule(intervalRef.current);
    } catch (error) {
      if (controller.signal.aborted) return;
      const status = Number(error?.status || error?.response?.status);
      const permanent = error?.permanent || (Number.isFinite(status) && status >= 400 && status < 500);
      if (permanent) {
        stoppedRef.current = true;
      } else {
        intervalRef.current = Math.min(intervalRef.current * backoffFactor, maxInterval);
      }
      setState((prev) => ({
        ...prev,
        loading: false,
        error: error instanceof Error ? error : new Error(error?.message || "Erro desconhecido"),
      }));
      if (!permanent) {
        schedule(intervalRef.current);
      }
    }
  }, [enabled, fetcher, initialData, interval, backoffFactor, maxInterval, schedule]);

  useEffect(() => {
    stoppedRef.current = false;
    intervalRef.current = interval;
    if (enabled) {
      void run();
    } else {
      clearTimer();
      abortRef.current?.abort();
      setState({ data: initialData, loading: false, error: null, fetchedAt: null });
    }
    return () => {
      stoppedRef.current = true;
      clearTimer();
      abortRef.current?.abort();
    };
  }, [enabled, run, clearTimer, interval, initialData]);

  useEffect(() => {
    if (!pauseWhenHidden || typeof document === "undefined") return undefined;
    const handleVisibility = () => {
      visibilityRef.current = document.visibilityState;
      if (visibilityRef.current === "visible" && !stoppedRef.current && enabled) {
        clearTimer();
        void run();
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, [clearTimer, enabled, pauseWhenHidden, run]);

  const refresh = useCallback(() => {
    stoppedRef.current = false;
    intervalRef.current = interval;
    clearTimer();
    void run();
  }, [clearTimer, interval, run]);

  return useMemo(() => ({
    data: state.data ?? initialData,
    loading: Boolean(state.loading),
    error: state.error,
    fetchedAt: state.fetchedAt,
    refresh,
  }), [state, initialData, refresh]);
}

export default usePollingResource;
