import { useEffect, useMemo, useRef, useState } from "react";
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

  const resolveKey = useMemo(
    () =>
      getKey ||
      ((item) => {
        const coords = getCoords ? getCoords(item) : item;
        const lat = coords?.lat ?? coords?.latitude;
        const lng = coords?.lng ?? coords?.lon ?? coords?.longitude;
        return buildCoordKey(Number(lat), Number(lng));
      }),
    [getCoords, getKey],
  );

  useEffect(() => {
    setAddresses({});
    setLoadingKeys({});
    inFlightRef.current = new Set();
  }, [resolveKey]);

  useEffect(() => {
    if (!enabled) return undefined;

    const pending = list
      .map((item) => {
        const coords = getCoords ? getCoords(item) : item;
        const lat = coords?.lat ?? coords?.latitude;
        const lng = coords?.lng ?? coords?.lon ?? coords?.longitude;
        const key = resolveKey(item);
        return { key, lat: Number(lat), lng: Number(lng) };
      })
      .filter((entry) => entry.key && Number.isFinite(entry.lat) && Number.isFinite(entry.lng));

    const cachedUpdates = {};
    pending.forEach((entry) => {
      const cached = getCachedReverse(entry.lat, entry.lng);
      if (cached) cachedUpdates[entry.key] = cached;
    });

    if (Object.keys(cachedUpdates).length) {
      setAddresses((prev) => ({ ...prev, ...cachedUpdates }));
    }

    const missing = pending
      .filter((entry) => !cachedUpdates[entry.key])
      .filter((entry) => !(entry.key in addresses))
      .filter((entry) => !inFlightRef.current.has(entry.key))
      .slice(0, batchSize);

    if (!missing.length) return undefined;

    let cancelled = false;

    missing.forEach((entry) => {
      inFlightRef.current.add(entry.key);
    });

    setLoadingKeys((prev) => {
      const next = { ...prev };
      missing.forEach((entry) => {
        next[entry.key] = true;
      });
      return next;
    });

    (async () => {
      for (const entry of missing) {
        try {
          const resolved = await reverseGeocode(entry.lat, entry.lng);
          if (cancelled) return;
          setAddresses((prev) => ({ ...prev, [entry.key]: resolved || FALLBACK_ADDRESS }));
        } catch (_error) {
          if (cancelled) return;
          setAddresses((prev) => ({ ...prev, [entry.key]: prev[entry.key] || FALLBACK_ADDRESS }));
        } finally {
          if (cancelled) return;
          setLoadingKeys((prev) => ({ ...prev, [entry.key]: false }));
          inFlightRef.current.delete(entry.key);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [addresses, batchSize, enabled, getCoords, list, resolveKey]);

  return { addresses, loadingKeys };
}
