import { useCallback, useEffect, useRef } from "react";
import L from "leaflet";

const FALLBACK_DELAY_MS = 120;
const CENTER_EPSILON = 0.00005;

function hasCenterMoved(fromCenter, toCenter, fromZoom, toZoom) {
  if (!fromCenter || !toCenter) return true;
  const latMoved = Math.abs(Number(fromCenter.lat) - Number(toCenter.lat)) > CENTER_EPSILON;
  const lngMoved = Math.abs(Number(fromCenter.lng) - Number(toCenter.lng)) > CENTER_EPSILON;
  const zoomMoved = Number.isFinite(fromZoom) && Number.isFinite(toZoom) ? Math.abs(fromZoom - toZoom) > 0.01 : true;
  return latMoved || lngMoved || zoomMoved;
}

function normalizeLatLngPoint(raw) {
  if (!raw) return null;
  if (Array.isArray(raw)) {
    const [lat, lng] = raw;
    const latNum = Number(lat);
    const lngNum = Number(lng);
    if (!Number.isFinite(latNum) || !Number.isFinite(lngNum)) return null;
    return [latNum, lngNum];
  }
  if (typeof raw === "object") {
    const latNum = Number(raw.lat ?? raw.latitude);
    const lngNum = Number(raw.lng ?? raw.lon ?? raw.longitude);
    if (!Number.isFinite(latNum) || !Number.isFinite(lngNum)) return null;
    return [latNum, lngNum];
  }
  return null;
}

function normalizeGeometryPoints(geometry) {
  if (!Array.isArray(geometry)) return [];
  return geometry.map(normalizeLatLngPoint).filter(Boolean);
}

function isValidBounds(bounds) {
  return Boolean(bounds && typeof bounds.isValid === "function" && bounds.isValid());
}

export default function useLeafletFocus({ page = "Unknown" } = {}) {
  const mapRef = useRef(null);
  const pendingFocusRef = useRef(null);
  const fallbackTimeoutRef = useRef(null);
  const isDev = Boolean(import.meta?.env?.DEV);

  const log = useCallback(
    (tag, payload) => {
      if (!isDev) return;
      console.log(tag, payload);
    },
    [isDev],
  );

  const applyFocusLatLng = useCallback(
    (payload, { pendingApplied = false } = {}) => {
      const map = mapRef.current;
      if (!map) return false;

      const lat = Number(payload?.lat);
      const lng = Number(payload?.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;

      const targetZoom = Number.isFinite(payload?.zoom) ? Number(payload.zoom) : map.getZoom?.();
      const animate = payload?.animate !== false;
      const reason = payload?.reason || "UNKNOWN";
      const fromCenter = map.getCenter?.();
      const fromZoom = map.getZoom?.();
      const targetCenter = { lat, lng };

      map.stop?.();
      map.setView([lat, lng], targetZoom, { animate });

      log("[MAP_FOCUS_APPLY]", {
        page,
        reason,
        fromCenter,
        fromZoom,
        toCenter: targetCenter,
        toZoom: targetZoom,
        pendingApplied,
        t: Date.now(),
      });

      if (fallbackTimeoutRef.current) {
        clearTimeout(fallbackTimeoutRef.current);
      }
      fallbackTimeoutRef.current = setTimeout(() => {
        const currentMap = mapRef.current;
        if (!currentMap || !currentMap._mapPane) return;
        const currentCenter = currentMap.getCenter?.();
        const currentZoom = currentMap.getZoom?.();
        if (!hasCenterMoved(fromCenter, currentCenter, fromZoom, currentZoom)) {
          log("[MAP_FOCUS_FALLBACK_SET_VIEW]", {
            page,
            reason,
            fromCenter,
            fromZoom,
            toCenter: targetCenter,
            toZoom: targetZoom,
            t: Date.now(),
          });
          currentMap.stop?.();
          currentMap.setView([lat, lng], targetZoom, { animate });
        }
      }, FALLBACK_DELAY_MS);

      return true;
    },
    [log, page],
  );

  const applyFitBounds = useCallback(
    (payload, { pendingApplied = false } = {}) => {
      const map = mapRef.current;
      if (!map || !payload?.bounds || !isValidBounds(payload.bounds)) return false;

      const fromCenter = map.getCenter?.();
      const fromZoom = map.getZoom?.();
      const toCenter = payload.bounds?.getCenter?.() || null;
      const toZoom = map.getBoundsZoom ? map.getBoundsZoom(payload.bounds, false, payload?.options?.padding) : map.getZoom?.();

      map.stop?.();
      map.fitBounds(payload.bounds, payload.options || {});

      log("[MAP_FOCUS_APPLY]", {
        page,
        reason: payload?.reason || "UNKNOWN",
        fromCenter,
        fromZoom,
        toCenter,
        toZoom,
        pendingApplied,
        t: Date.now(),
      });

      return true;
    },
    [log, page],
  );

  const setPendingFocus = useCallback(
    (pendingPayload) => {
      pendingFocusRef.current = pendingPayload;
      log("[MAP_FOCUS_PENDING]", {
        page,
        reason: pendingPayload?.payload?.reason || pendingPayload?.reason || "UNKNOWN",
        t: Date.now(),
      });
    },
    [log, page],
  );

  const applyPending = useCallback(() => {
    const pending = pendingFocusRef.current;
    if (!pending) return;
    pendingFocusRef.current = null;
    if (pending.type === "bounds") {
      applyFitBounds(pending.payload, { pendingApplied: true });
      return;
    }
    applyFocusLatLng(pending.payload, { pendingApplied: true });
  }, [applyFitBounds, applyFocusLatLng]);

  const registerMap = useCallback(
    (mapInstance) => {
      if (!mapInstance) return;
      mapRef.current = mapInstance;
      if (!pendingFocusRef.current) return;
      if (mapInstance._loaded) {
        applyPending();
      } else {
        mapInstance.whenReady(applyPending);
      }
    },
    [applyPending],
  );

  const focusLatLng = useCallback(
    (payload) => {
      const map = mapRef.current;
      if (!map || !map._loaded) {
        setPendingFocus({ type: "latlng", payload });
        if (map?.whenReady) {
          map.whenReady(applyPending);
        }
        return false;
      }
      return applyFocusLatLng(payload);
    },
    [applyFocusLatLng, applyPending, setPendingFocus],
  );

  const fitBounds = useCallback(
    (bounds, options = {}, reason = "UNKNOWN") => {
      if (!isValidBounds(bounds)) return false;
      const map = mapRef.current;
      const payload = { bounds, options, reason };
      if (!map || !map._loaded) {
        setPendingFocus({ type: "bounds", payload });
        if (map?.whenReady) {
          map.whenReady(applyPending);
        }
        return false;
      }
      return applyFitBounds(payload);
    },
    [applyFitBounds, applyPending, setPendingFocus],
  );

  const focusGeometry = useCallback(
    (geometry, options = {}, reason = "UNKNOWN") => {
      const points = normalizeGeometryPoints(geometry);
      if (!points.length) return false;
      if (points.length === 1) {
        const [lat, lng] = points[0];
        return focusLatLng({ lat, lng, zoom: options.zoom, animate: options.animate, reason });
      }
      const bounds = L.latLngBounds(points);
      return fitBounds(bounds, options, reason);
    },
    [fitBounds, focusLatLng],
  );

  useEffect(() => {
    return () => {
      if (fallbackTimeoutRef.current) {
        clearTimeout(fallbackTimeoutRef.current);
        fallbackTimeoutRef.current = null;
      }
    };
  }, []);

  return {
    registerMap,
    focusLatLng,
    fitBounds,
    focusGeometry,
    setPendingFocus,
  };
}
