import { useEffect, useMemo, useRef, useState } from "react";
import { getCachedReverse, reverseGeocode } from "../reverseGeocode.js";

export const FALLBACK_ADDRESS = "Endereço indisponível";
const DEFAULT_DEBOUNCE_MS = 350;

const buildCoordKey = (lat, lon, precision = 5) => {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return "";
  const factor = 10 ** precision;
  return `${Math.round(lat * factor) / factor},${Math.round(lon * factor) / factor}`;
};

export function useReverseGeocode(lat, lon, { enabled = true, debounceMs = DEFAULT_DEBOUNCE_MS } = {}) {
  const safeLat = Number.isFinite(lat) ? Number(lat) : null;
  const safeLon = Number.isFinite(lon) ? Number(lon) : null;
  const key = useMemo(() => buildCoordKey(safeLat, safeLon), [safeLat, safeLon]);
  const [state, setState] = useState(() => {
    if (!key) return { address: "", loading: false };
    const cached = getCachedReverse(safeLat, safeLon);
    return { address: cached || "", loading: false };
  });
  const activeKeyRef = useRef(key);

  useEffect(() => {
    activeKeyRef.current = key;
  }, [key]);

  useEffect(() => {
    if (!enabled || !key) {
      setState({ address: "", loading: false });
      return undefined;
    }

    const cached = getCachedReverse(safeLat, safeLon);
    if (cached) {
      setState({ address: cached, loading: false });
      return undefined;
    }

    setState((prev) => ({ address: prev.address, loading: true }));
    let cancelled = false;

    const timeoutId = setTimeout(async () => {
      try {
        const resolved = await reverseGeocode(safeLat, safeLon);
        if (cancelled || activeKeyRef.current !== key) return;
        setState({ address: resolved || FALLBACK_ADDRESS, loading: false });
      } catch (_err) {
        if (cancelled || activeKeyRef.current !== key) return;
        setState({ address: FALLBACK_ADDRESS, loading: false });
      }
    }, debounceMs);

    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
    };
  }, [debounceMs, enabled, key, safeLat, safeLon]);

  const retry = async () => {
    if (!key || !enabled || !Number.isFinite(safeLat) || !Number.isFinite(safeLon)) return null;
    setState((prev) => ({ address: prev.address, loading: true }));
    try {
      const resolved = await reverseGeocode(safeLat, safeLon, { force: true });
      if (activeKeyRef.current !== key) return null;
      setState({ address: resolved || FALLBACK_ADDRESS, loading: false });
      return resolved;
    } catch (_error) {
      if (activeKeyRef.current !== key) return null;
      setState({ address: FALLBACK_ADDRESS, loading: false });
      return null;
    }
  };

  const address = state.address || (enabled && key ? FALLBACK_ADDRESS : "");
  return { address, loading: state.loading, retry };
}

export default useReverseGeocode;
