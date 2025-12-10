import { useCallback, useEffect, useRef } from "react";

function isDocumentHidden() {
  if (typeof document === "undefined") return false;
  return document.visibilityState === "hidden";
}

export function usePollingTask(
  task,
  {
    enabled = true,
    intervalMs = 10_000,
    immediate = true,
    maxConsecutiveErrors = 3,
    pauseWhenHidden = true,
    backoffFactor = 2,
    maxIntervalMs = 60_000,
    onError,
    onPermanentFailure,
  } = {},
) {
  const timerRef = useRef(null);
  const failuresRef = useRef(0);
  const runningRef = useRef(false);
  const cancelledRef = useRef(false);
  const haltedRef = useRef(false);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      globalThis.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const runRef = useRef(null);

  const schedule = useCallback((delay) => {
    const effectiveDelay = Number.isFinite(delay) ? delay : intervalMs;
    if (!enabled || !effectiveDelay || cancelledRef.current || haltedRef.current) return;
    clearTimer();
    timerRef.current = globalThis.setTimeout(() => {
      timerRef.current = null;
      if (runRef.current) {
        void runRef.current();
      }
    }, effectiveDelay);
  }, [clearTimer, enabled, intervalMs]);

  const run = useCallback(async () => {
    if (!enabled || cancelledRef.current || haltedRef.current) return;
    if (runningRef.current) return;
    if (pauseWhenHidden && isDocumentHidden()) {
      schedule();
      return;
    }

    runningRef.current = true;
    try {
      await task();
      failuresRef.current = 0;
    } catch (error) {
      failuresRef.current += 1;
      if (typeof onError === "function") {
        try {
          onError(error, failuresRef.current);
        } catch (_notifyError) {
          // ignore notification errors
        }
      }
      if (failuresRef.current >= maxConsecutiveErrors) {
        if (typeof onPermanentFailure === "function") {
          try {
            onPermanentFailure(error, failuresRef.current);
          } catch (_notifyError) {
            // ignore notification errors
          }
        }
        haltedRef.current = true;
        return;
      }
    } finally {
      runningRef.current = false;
      if (!cancelledRef.current && enabled && intervalMs && !haltedRef.current) {
        const backoff = Math.min(intervalMs * Math.max(1, backoffFactor ** failuresRef.current), maxIntervalMs);
        schedule(failuresRef.current ? backoff : intervalMs);
      }
    }
  }, [backoffFactor, enabled, intervalMs, maxConsecutiveErrors, maxIntervalMs, onError, onPermanentFailure, pauseWhenHidden, schedule, task]);

  useEffect(() => {
    runRef.current = run;
  }, [run]);

  useEffect(() => {
    cancelledRef.current = false;
    haltedRef.current = false;
    failuresRef.current = 0;
    clearTimer();

    if (!enabled) {
      return () => {
        cancelledRef.current = true;
        clearTimer();
      };
    }

    if (immediate) {
      void run();
    } else if (intervalMs) {
      schedule(intervalMs);
    }

    return () => {
      cancelledRef.current = true;
      clearTimer();
    };
  }, [enabled, intervalMs, immediate, run, schedule, clearTimer]);

  return { trigger: run, stop: clearTimer };
}

export default usePollingTask;
