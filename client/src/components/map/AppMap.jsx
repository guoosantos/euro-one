import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MapContainer } from "react-leaflet";

const DEFAULT_CENTER = [-23.55052, -46.633308];
const DEFAULT_ZOOM = 12;

function resolveCenter(center) {
  if (Array.isArray(center) && center.length >= 2) {
    const lat = Number(center[0]);
    const lng = Number(center[1]);
    if (Number.isFinite(lat) && Number.isFinite(lng)) return [lat, lng];
  }
  if (center && typeof center === "object") {
    const lat = Number(center.lat ?? center.latitude);
    const lng = Number(center.lng ?? center.lon ?? center.longitude);
    if (Number.isFinite(lat) && Number.isFinite(lng)) return [lat, lng];
  }
  return null;
}

function resolveZoom(zoom) {
  const next = Number(zoom);
  return Number.isFinite(next) && next > 0 ? next : null;
}

const AppMap = React.forwardRef(function AppMap(
  { center, zoom, className = "", style, invalidateKey, onReadyStateChange, whenReady, ...props },
  ref,
) {
  const mapRef = useRef(null);
  const [isReady, setIsReady] = useState(false);

  const resolvedCenter = useMemo(() => resolveCenter(center) || DEFAULT_CENTER, [center]);
  const resolvedZoom = useMemo(() => resolveZoom(zoom) || DEFAULT_ZOOM, [zoom]);

  const attachRef = useCallback(
    (map) => {
      mapRef.current = map;
      if (typeof ref === "function") {
        ref(map);
      } else if (ref) {
        ref.current = map;
      }
    },
    [ref],
  );

  const handleReady = useCallback(
    (event) => {
      setIsReady(true);
      onReadyStateChange?.(true);
      whenReady?.(event);
      const map = event?.target || mapRef.current;
      map?.invalidateSize?.();
    },
    [onReadyStateChange, whenReady],
  );

  useEffect(() => {
    if (!isReady) return;
    const map = mapRef.current;
    if (!map) return;
    map.invalidateSize?.();
  }, [invalidateKey, isReady]);

  return (
    <MapContainer
      ref={attachRef}
      center={resolvedCenter}
      zoom={resolvedZoom}
      className={`app-map ${className}`.trim()}
      style={{ height: "100%", width: "100%", minHeight: 320, overflow: "hidden", ...style }}
      whenReady={handleReady}
      {...props}
    />
  );
});

export default AppMap;
