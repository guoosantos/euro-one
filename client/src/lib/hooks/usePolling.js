import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/**
 * Hook de polling com dependências estáveis para evitar loops infinitos.
 *
 * Pode ser usado de duas formas para manter compatibilidade:
 * - usePolling(() => api.get("/endpoint"), { enabled: true, intervalMs: 5000 })
 * - usePolling({ fetchFn: () => api.get("/endpoint"), enabled: true, intervalMs: 5000 })
 */
export default function usePolling(requestFnOrOptions, maybeOptions = {}) {
  const requestFn = typeof requestFnOrOptions === "function"
    ? requestFnOrOptions
    : requestFnOrOptions?.fetchFn;

  const options = typeof requestFnOrOptions === "function" ? maybeOptions : requestFnOrOptions || {};
  const {
    enabled = true,
    paused = false,
    intervalMs = 5000,
    dependencies = [],
    resetOnChange = false,
  } = options;

  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(Boolean(enabled));
  const [lastUpdated, setLastUpdated] = useState(null);

  const fnRef = useRef(requestFn);
  const tickRef = useRef(null);

  fnRef.current = requestFn;

  useEffect(() => {
    if (!enabled || paused || typeof fnRef.current !== "function") return undefined;

    let cancelled = false;
    let timerId;

    async function tick() {
      if (cancelled) return;

      try {
        setLoading(true);
        const result = await fnRef.current();
        if (!cancelled) {
          setData(result ?? null);
          setError(null);
          setLastUpdated(new Date());
        }
      } catch (err) {
        if (!cancelled) {
          setError(err);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
          if (Number.isFinite(intervalMs) && intervalMs > 0) {
            timerId = setTimeout(tick, intervalMs);
          }
        }
      }
    }

    tickRef.current = tick;
    tick();

    return () => {
      cancelled = true;
      if (timerId) clearTimeout(timerId);
    };
  }, [enabled, paused, intervalMs, ...dependencies]);

  useEffect(() => {
    if (!resetOnChange || paused) return;
    setData(null);
    setError(null);
    setLastUpdated(null);
    setLoading(Boolean(enabled));
  }, [enabled, paused, resetOnChange, ...dependencies]);

  const refresh = useCallback(async () => {
    if (typeof fnRef.current !== "function") return undefined;
    if (enabled && typeof tickRef.current === "function") {
      return tickRef.current();
    }
    try {
      setLoading(true);
      const result = await fnRef.current();
      setData(result ?? null);
      setError(null);
      setLastUpdated(new Date());
      return result;
    } catch (err) {
      setError(err);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  return useMemo(
    () => ({
      data,
      error,
      loading,
      lastUpdated,
      refresh,
    }),
    [data, error, loading, lastUpdated, refresh],
  );
}

export { usePolling };
