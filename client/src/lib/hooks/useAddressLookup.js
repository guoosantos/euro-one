import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getCachedReverse, reverseGeocode } from "../reverseGeocode.js";
import { FALLBACK_ADDRESS } from "../utils/geocode.js";

const DEFAULT_BATCH_SIZE = Number.POSITIVE_INFINITY;
const MAX_CONCURRENCY = 1;
const MIN_INTERVAL_MS = 340;

const buildCoordKey = (lat, lng, precision = 5) => {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return "";
  const factor = 10 ** precision;
  return `${Math.round(lat * factor) / factor},${Math.round(lng * factor) / factor}`;
};

const shallowArrayEqual = (a, b) => {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
};

const shallowObjectEqual = (a, b) => {
  if (a === b) return true;
  if (!a || !b) return false;
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  for (const key of keysA) {
    if (a[key] !== b[key]) return false;
  }
  return true;
};

export default function useAddressLookup(
  items = [],
  { enabled = true, batchSize = DEFAULT_BATCH_SIZE, getKey, getCoords } = {},
) {
  const list = useMemo(() => (Array.isArray(items) ? items : []), [items]);
  const [addresses, setAddresses] = useState({});
  const [loadingKeys, setLoadingKeys] = useState([]);
  const loadingKeySet = useMemo(() => new Set(loadingKeys), [loadingKeys]);
  const inFlightRef = useRef(new Set());
  const addressesRef = useRef({});
  const getKeyRef = useRef(getKey);
  const getCoordsRef = useRef(getCoords);
  const queueRef = useRef([]);
  const abortControllersRef = useRef(new Map());
  const activeWorkersRef = useRef(0);
  const lastDispatchRef = useRef(0);
  const runIdRef = useRef(0);

  useEffect(() => {
    getKeyRef.current = getKey;
    getCoordsRef.current = getCoords;
  }, [getCoords, getKey]);

  useEffect(() => {
    addressesRef.current = addresses;
  }, [addresses]);

  const resolveKey = useCallback((item) => {
    if (getKeyRef.current) {
      return getKeyRef.current(item);
    }
    const coords = getCoordsRef.current ? getCoordsRef.current(item) : item;
    const lat = coords?.lat ?? coords?.latitude;
    const lng = coords?.lng ?? coords?.lon ?? coords?.longitude;
    return buildCoordKey(Number(lat), Number(lng));
  }, []);

  const clearControllers = useCallback(() => {
    abortControllersRef.current.forEach((controller) => controller.abort());
    abortControllersRef.current.clear();
    activeWorkersRef.current = 0;
    inFlightRef.current = new Set();
  }, []);

  const updateLoadingKeys = useCallback((updater) => {
    setLoadingKeys((prev) => {
      const next = updater(prev);
      return shallowArrayEqual(prev, next) ? prev : next;
    });
  }, []);

  const updateAddresses = useCallback((updater) => {
    setAddresses((prev) => {
      const next = updater(prev);
      if (next === prev) return prev;
      return shallowObjectEqual(prev, next) ? prev : next;
    });
  }, []);

  const scheduleLoadingKeys = useCallback(
    (keys) => {
      if (!keys || !keys.length) return;
      updateLoadingKeys((prev) => Array.from(new Set([...prev, ...keys])));
    },
    [updateLoadingKeys],
  );

  const removeLoadingKey = useCallback((key) => {
    if (!key) return;
    updateLoadingKeys((prev) => {
      if (!prev.includes(key)) return prev;
      return prev.filter((item) => item !== key);
    });
  }, [updateLoadingKeys]);

  const launchWorker = useCallback(
    (runId) => {
      if (!enabled || activeWorkersRef.current >= MAX_CONCURRENCY) return;
      if (!queueRef.current.length) return;

      const entry = queueRef.current.shift();
      if (!entry) return;

      activeWorkersRef.current += 1;
      const controller = new AbortController();
      abortControllersRef.current.set(entry.key, controller);
      scheduleLoadingKeys([entry.key]);

      const run = async () => {
        try {
          const now = Date.now();
          const waitMs = Math.max(0, MIN_INTERVAL_MS - (now - lastDispatchRef.current));
          if (waitMs) {
            await new Promise((resolve, reject) => {
              const timeoutId = setTimeout(resolve, waitMs);
              controller.signal.addEventListener(
                "abort",
                () => {
                  clearTimeout(timeoutId);
                  reject(new DOMException("Aborted", "AbortError"));
                },
                { once: true },
              );
            });
          }

          lastDispatchRef.current = Date.now();
          const resolved = await reverseGeocode(entry.lat, entry.lng, { signal: controller.signal });
          if (runIdRef.current !== runId) return;
          const nextValue = resolved || FALLBACK_ADDRESS;
          updateAddresses((prev) => {
            if (prev[entry.key] === nextValue) return prev;
            return { ...prev, [entry.key]: nextValue };
          });
        } catch (error) {
          if (controller.signal.aborted || error?.name === "AbortError" || runIdRef.current !== runId) return;
          updateAddresses((prev) => {
            const nextValue = prev[entry.key] || FALLBACK_ADDRESS;
            if (prev[entry.key] === nextValue) return prev;
            return { ...prev, [entry.key]: nextValue };
          });
        } finally {
          abortControllersRef.current.delete(entry.key);
          removeLoadingKey(entry.key);
          inFlightRef.current.delete(entry.key);
          activeWorkersRef.current -= 1;
          if (runIdRef.current === runId && queueRef.current.length) {
            launchWorker(runId);
          }
        }
      };

      run();
    },
    [enabled, removeLoadingKey, scheduleLoadingKeys],
  );

  useEffect(() => {
    if (!enabled) {
      clearControllers();
      updateLoadingKeys(() => []);
      return undefined;
    }

    const currentRunId = runIdRef.current + 1;
    runIdRef.current = currentRunId;
    lastDispatchRef.current = Date.now() - MIN_INTERVAL_MS;
    clearControllers();

    const currentAddresses = addressesRef.current || {};
    const seenKeys = new Set();
    const pending = list
      .map((item) => {
        const coords = getCoordsRef.current ? getCoordsRef.current(item) : item;
        const lat = coords?.lat ?? coords?.latitude;
        const lng = coords?.lng ?? coords?.lon ?? coords?.longitude;
        const key = resolveKey(item);
        return { key, lat: Number(lat), lng: Number(lng) };
      })
      .filter((entry) => entry.key && Number.isFinite(entry.lat) && Number.isFinite(entry.lng))
      .filter((entry) => {
        if (seenKeys.has(entry.key)) return false;
        seenKeys.add(entry.key);
        return true;
      });

    const cachedUpdates = {};
    pending.forEach((entry) => {
      const cached = getCachedReverse(entry.lat, entry.lng);
      if (cached && currentAddresses[entry.key] !== cached) {
        cachedUpdates[entry.key] = cached;
      }
    });

    if (Object.keys(cachedUpdates).length) {
      updateAddresses((prev) => {
        let changed = false;
        const next = { ...prev };
        Object.entries(cachedUpdates).forEach(([key, value]) => {
          if (prev[key] !== value) {
            next[key] = value;
            changed = true;
          }
        });
        return changed ? next : prev;
      });
    }

    const missing = pending
      .filter((entry) => !cachedUpdates[entry.key])
      .filter((entry) => !(entry.key in currentAddresses))
      .filter((entry) => !inFlightRef.current.has(entry.key))
      .slice(0, batchSize);

    if (!missing.length) return undefined;

    const uniqueMissing = [];
    const seen = new Set();
    missing.forEach((entry) => {
      if (seen.has(entry.key)) return;
      seen.add(entry.key);
      uniqueMissing.push(entry);
    });

    queueRef.current = uniqueMissing;
    uniqueMissing.forEach((entry) => inFlightRef.current.add(entry.key));
    scheduleLoadingKeys(uniqueMissing.map((entry) => entry.key));

    launchWorker(currentRunId);

    return () => {
      clearControllers();
      queueRef.current = [];
      updateLoadingKeys(() => []);
    };
  }, [batchSize, clearControllers, enabled, launchWorker, list, resolveKey, scheduleLoadingKeys, updateAddresses, updateLoadingKeys]);

  return { addresses, loadingKeys: loadingKeySet };
}
