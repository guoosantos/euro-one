import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from "react";

function isDocumentHidden() {
  if (typeof document === "undefined") return false;
  return document.visibilityState === "hidden";
}

const resources = new Map();

function defaultState(initialData) {
  return { data: initialData ?? null, error: null, loading: false, fetchedAt: null };
}

function getResource(key, initialData) {
  if (resources.has(key)) return resources.get(key);
  const resource = {
    key,
    state: defaultState(initialData),
    subscribers: new Set(),
    options: {
      enabled: false,
      intervalMs: 10_000,
      immediate: true,
      pauseWhenHidden: true,
      maxConsecutiveErrors: 3,
      backoffFactor: 2,
      maxIntervalMs: 60_000,
    },
    fetcher: null,
    timer: null,
    controller: null,
    running: false,
    failures: 0,
  };
  resources.set(key, resource);
  return resource;
}

function clearTimer(resource) {
  if (resource.timer) {
    clearTimeout(resource.timer);
    resource.timer = null;
  }
}

function notify(resource) {
  resource.subscribers.forEach((listener) => {
    try {
      listener();
    } catch (_err) {
      // ignore listener errors
    }
  });
}

function schedule(resource, delay) {
  const { enabled, intervalMs, backoffFactor, maxIntervalMs } = resource.options;
  if (!enabled || !intervalMs || resource.timer || resource.subscribers.size === 0) return;
  const baseDelay = Number.isFinite(delay) ? delay : intervalMs;
  const backoff = resource.failures ? Math.min(intervalMs * Math.max(1, backoffFactor ** resource.failures), maxIntervalMs) : baseDelay;
  resource.timer = setTimeout(() => {
    resource.timer = null;
    void run(resource);
  }, backoff);
}

async function run(resource, { withLoading = false } = {}) {
  const { enabled, pauseWhenHidden, maxConsecutiveErrors } = resource.options;
  if (!enabled || resource.running || resource.subscribers.size === 0) return;
  if (pauseWhenHidden && isDocumentHidden()) {
    schedule(resource);
    return;
  }

  resource.running = true;
  clearTimer(resource);
  const controller = new AbortController();
  resource.controller = controller;
  if (withLoading) {
    resource.state.loading = true;
    notify(resource);
  }

  let stopPolling = false;
  try {
    const result = resource.fetcher ? await resource.fetcher({ signal: controller.signal }) : null;
    if (controller.signal?.aborted) return;
    resource.failures = 0;
    resource.state.data = result ?? resource.state.data;
    resource.state.error = null;
    resource.state.fetchedAt = new Date();
  } catch (error) {
    if (controller.signal?.aborted) return;
    resource.failures += 1;
    resource.state.error = error instanceof Error ? error : new Error(error?.message || "Erro desconhecido");
    stopPolling = resource.state.error?.permanent || resource.failures >= maxConsecutiveErrors;
  } finally {
    if (!controller.signal?.aborted) {
      resource.state.loading = false;
      notify(resource);
      if (!stopPolling) {
        schedule(resource);
      }
    }
    resource.running = false;
  }
}

function setOptions(resource, options, { initialData }) {
  const next = { ...resource.options };
  if (options.intervalMs !== undefined) next.intervalMs = options.intervalMs;
  if (options.immediate !== undefined) next.immediate = options.immediate;
  if (options.pauseWhenHidden !== undefined) next.pauseWhenHidden = options.pauseWhenHidden;
  if (options.maxConsecutiveErrors !== undefined) next.maxConsecutiveErrors = options.maxConsecutiveErrors;
  if (options.backoffFactor !== undefined) next.backoffFactor = options.backoffFactor;
  if (options.maxIntervalMs !== undefined) next.maxIntervalMs = options.maxIntervalMs;
  next.enabled = Boolean(options.enabled);
  resource.options = next;
  if (!next.enabled) {
    clearTimer(resource);
    resource.controller?.abort();
  }
  if (initialData !== undefined && resource.state.data === null) {
    resource.state.data = initialData;
  }
}

function subscribe(resource, callback) {
  resource.subscribers.add(callback);
  return () => {
    resource.subscribers.delete(callback);
    if (resource.subscribers.size === 0) {
      clearTimer(resource);
      resource.controller?.abort();
    }
  };
}

export function useSharedPollingResource(key, fetcher, options = {}) {
  const resolvedKey = Array.isArray(key) ? key.join(":") : key;
  const resourceRef = useRef(getResource(resolvedKey, options.initialData));
  if (resourceRef.current.key !== resolvedKey) {
    resourceRef.current = getResource(resolvedKey, options.initialData);
  }

  const refresh = useCallback(() => {
    resourceRef.current.failures = 0;
    clearTimer(resourceRef.current);
    void run(resourceRef.current, { withLoading: true });
  }, []);

  useEffect(() => {
    const resource = resourceRef.current;
    resource.fetcher = fetcher;
    setOptions(resource, options, { initialData: options.initialData });
    if (options.immediate !== false && resource.options.enabled && resource.state.fetchedAt === null) {
      void run(resource, { withLoading: true });
    } else if (resource.options.enabled && resource.state.fetchedAt !== null && !resource.timer) {
      schedule(resource);
    }
    return () => {
      resource.fetcher = null;
    };
  }, [fetcher, options]);

  const subscribeFn = useCallback(
    (listener) => {
      const unsub = subscribe(resourceRef.current, listener);
      if (resourceRef.current.options.enabled && !resourceRef.current.timer && !resourceRef.current.running) {
        if (resourceRef.current.state.fetchedAt === null && resourceRef.current.options.immediate !== false) {
          void run(resourceRef.current, { withLoading: true });
        } else {
          schedule(resourceRef.current);
        }
      }
      return unsub;
    },
    [],
  );

  const getSnapshot = useCallback(() => resourceRef.current.state, []);

  const state = useSyncExternalStore(subscribeFn, getSnapshot, getSnapshot);

  return useMemo(
    () => ({
      data: state.data ?? options.initialData ?? null,
      error: state.error,
      loading: Boolean(state.loading),
      fetchedAt: state.fetchedAt,
      refresh,
    }),
    [state, options.initialData, refresh],
  );
}

export default useSharedPollingResource;
