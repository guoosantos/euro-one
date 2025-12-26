import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getCachedReverse, reverseGeocode } from "../reverseGeocode.js";
import { FALLBACK_ADDRESS } from "../utils/geocode.js";

const DEFAULT_BATCH_SIZE = 4;

const buildCoordKey = (lat, lng, precision = 5) => {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return "";
  const factor = 10 ** precision;
  return `${Math.round(lat * factor) / factor},${Math.round(lng * factor) / factor}`;
};

export default function useAddressLookup(
  items = [],
  { enabled = true, batchSize = DEFAULT_BATCH_SIZE, getKey, getCoords } = {},
) {
  const list = useMemo(() => (Array.isArray(items) ? items : []), [items]);
  const [addresses, setAddresses] = useState({});
  const [loadingKeys, setLoadingKeys] = useState({});
  const inFlightRef = useRef(new Set());
  const addressesRef = useRef({});
  const getKeyRef = useRef(getKey);
  const getCoordsRef = useRef(getCoords);

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

  useEffect(() => {
    if (!enabled) return undefined;

    const currentAddresses = addressesRef.current || {};
    const pending = list
      .map((item) => {
        const coords = getCoordsRef.current ? getCoordsRef.current(item) : item;
        const lat = coords?.lat ?? coords?.latitude;
        const lng = coords?.lng ?? coords?.lon ?? coords?.longitude;
        const key = resolveKey(item);
        return { key, lat: Number(lat), lng: Number(lng) };
      })
      .filter((entry) => entry.key && Number.isFinite(entry.lat) && Number.isFinite(entry.lng));

    const cachedUpdates = {};
    pending.forEach((entry) => {
      const cached = getCachedReverse(entry.lat, entry.lng);
      if (cached && currentAddresses[entry.key] !== cached) {
        cachedUpdates[entry.key] = cached;
      }
    });

    if (Object.keys(cachedUpdates).length) {
      setAddresses((prev) => {
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

    let cancelled = false;

    missing.forEach((entry) => {
      inFlightRef.current.add(entry.key);
    });

    setLoadingKeys((prev) => {
      let changed = false;
      const next = { ...prev };
      missing.forEach((entry) => {
        if (prev[entry.key] !== true) {
          next[entry.key] = true;
          changed = true;
        }
      });
      return changed ? next : prev;
    });

    (async () => {
      for (const entry of missing) {
        try {
          const resolved = await reverseGeocode(entry.lat, entry.lng);
          if (!cancelled) {
            setAddresses((prev) => {
              const nextValue = resolved || FALLBACK_ADDRESS;
              if (prev[entry.key] === nextValue) return prev;
              return { ...prev, [entry.key]: nextValue };
            });
          }
        } catch (_error) {
          if (!cancelled) {
            setAddresses((prev) => {
              const nextValue = prev[entry.key] || FALLBACK_ADDRESS;
              if (prev[entry.key] === nextValue) return prev;
              return { ...prev, [entry.key]: nextValue };
            });
          }
        } finally {
          if (!cancelled) {
            setLoadingKeys((prev) => {
              if (prev[entry.key] !== true) return prev;
              return { ...prev, [entry.key]: false };
            });
          }
          inFlightRef.current.delete(entry.key);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [batchSize, enabled, list, resolveKey]);

  return { addresses, loadingKeys };
}
