import React, { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { Marker, TileLayer, useMap, Circle, CircleMarker, Tooltip, Polyline, Polygon } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "./monitoring-map.css";
import { createVehicleMarkerIcon } from "../../lib/map/vehicleMarkerIcon.js";
import { buildEffectiveMaxZoom } from "../../lib/map-config.js";
import useMapDataRefresh from "../../lib/map/useMapDataRefresh.js";
import { canInteractWithMap } from "../../lib/map/mapSafety.js";
import MapZoomControls from "./MapZoomControls.jsx";
import AppMap from "./AppMap.jsx";
import { formatAddress } from "../../lib/format-address.js";
import { DEFAULT_MAP_LAYER } from "../../lib/mapLayers.js";
import { buildOverlayShapes, buildRouteCorridorPolygons } from "../../lib/itinerary-overlay.js";

// --- CONFIGURAÇÃO E CONSTANTES ---
const clusterIconCache = new Map();
const addressPinIconCache = { current: null };

function getAddressPinIcon() {
  if (addressPinIconCache.current) return addressPinIconCache.current;
  if (!L?.divIcon) return null;
  addressPinIconCache.current = L.divIcon({
    className: "address-pin",
    html: `
      <div class="address-pin__wrap">
        <div class="address-pin__dot"></div>
      </div>
    `,
    iconSize: [20, 20],
    iconAnchor: [10, 10],
  });
  return addressPinIconCache.current;
}

const STATUS_STYLES = {
  online: { background: "rgba(34,197,94,0.15)", border: "1px solid rgba(74,222,128,0.6)", color: "#bbf7d0" },
  alert: { background: "rgba(250,204,21,0.12)", border: "1px solid rgba(250,204,21,0.6)", color: "#fef9c3" },
  blocked: { background: "rgba(147,51,234,0.15)", border: "1px solid rgba(192,132,252,0.65)", color: "#e9d5ff" },
  offline: { background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.2)", color: "#e5e7eb" },
};

// --- HELPERS DE ESTILO ---

function getStatusStyle(status) {
  if (!status) return STATUS_STYLES.offline;
  return STATUS_STYLES[status] || STATUS_STYLES.offline;
}

function getClusterIcon(count) {
  const rounded = Math.max(2, Math.min(9999, Number(count) || 0));
  const size = rounded < 10 ? 34 : rounded < 50 ? 38 : rounded < 200 ? 44 : 50;
  const key = `${rounded}-${size}`;
  if (clusterIconCache.has(key)) return clusterIconCache.get(key);

  const iconHtml = `
    <div class="cluster-marker" style="width:${size}px;height:${size}px;">
      <span>${rounded}</span>
    </div>
  `;

  const icon = L.divIcon({
    className: "cluster-marker-wrapper",
    html: iconHtml,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });

  clusterIconCache.set(key, icon);
  return icon;
}

// --- COMPONENTES INTERNOS ---

function PopupContent({ marker }) {
  const statusStyle = getStatusStyle(marker.status);
  const primaryLabel = marker.plate || marker.label || "Sem placa";
  const secondaryLabel = marker.model && marker.model !== primaryLabel ? marker.model : "";
  
  const addressText = useMemo(() => {
    if (typeof marker.address === "string") return marker.address;
    if (marker.address && typeof marker.address === "object") {
      return (
        marker.address.formatted ||
        marker.address.formattedAddress ||
        marker.address.shortAddress ||
        marker.address.address ||
        ""
      );
    }
    return "";
  }, [marker.address]);

  return (
    <div className="space-y-1.5 text-white min-w-[200px]">
      <div className="text-sm font-bold leading-tight text-white">{primaryLabel}</div>
      {secondaryLabel ? (
        <div className="text-[11px] text-white/70">{secondaryLabel}</div>
      ) : null}
      
      {addressText && <div className="text-xs leading-snug text-white/80 border-t border-white/10 pt-1 mt-1">{addressText}</div>}
      
      <div className="flex items-center gap-2 text-xs text-white/80 mt-2">
        <span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-mono font-semibold text-white">
          {marker.speedLabel || "0 km/h"}
        </span>
        {marker.ignitionLabel && (
          <span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-white/80">
            Ignição {marker.ignitionLabel}
          </span>
        )}
        {marker.statusLabel && (
          <span
            className="rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase"
            style={{
              background: statusStyle.background,
              border: statusStyle.border,
              color: statusStyle.color,
            }}
          >
            {marker.statusLabel}
          </span>
        )}
      </div>
      
      {marker.lastEventLabel && (
        <div className="flex flex-col gap-0.5 text-[10px] text-white/60">
          <span>Último evento: <span className="text-white/80">{marker.lastEventLabel}</span></span>
          {marker.lastEventTimeLabel && (
            <span>Hora: <span className="text-white/80">{marker.lastEventTimeLabel}</span></span>
          )}
        </div>
      )}
      {marker.lastUpdateLabel && (
        <div className="flex items-center gap-1 text-[10px] text-white/50 mt-1">
          <span>{marker.updatedTitle ?? "Atualizado:"}</span>
          <span className="text-white/70">{marker.lastUpdateLabel}</span>
        </div>
      )}
    </div>
  );
}

function formatToleranceLabel(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return "—";
  return `${Math.round(parsed)} m`;
}

function OverlayHoverTooltip({ name, type, tolerance }) {
  return (
    <div className="monitoring-overlay-tooltip text-[11px] leading-tight text-white/85">
      <div className="font-semibold text-white">{name || "—"}</div>
      <div className="mt-0.5 text-white/65">
        Tipo: <span className="text-white/85">{type}</span>
      </div>
      <div className="text-white/60">
        Tolerância: <span className="text-white/85">{tolerance || "—"}</span>
      </div>
    </div>
  );
}

function MarkerLayer({
  markers,
  focusMarkerId,
  onViewportChange,
  onMarkerSelect,
  onMarkerOpenDetails,
  onUserAction,
  onFocusDevice,
  markerRefs,
}) {
  const map = useMap();
  const [clusters, setClusters] = useState([]);
  const clusterSignatureRef = useRef("");
  const canUseMap = useCallback(() => canInteractWithMap(map), [map]);
  
  const safeMarkers = useMemo(
    () => markers.filter((marker) => Number.isFinite(marker.lat) && Number.isFinite(marker.lng)),
    [markers],
  );
  // Manipular eventos de movimento (opcional)
  useEffect(() => {
    if (!map || !onViewportChange) return undefined;

    const handleMove = () => {
      if (!canUseMap()) return;
      const center = map.getCenter();
      onViewportChange({ center: [center.lat, center.lng], zoom: map.getZoom() });
    };

    map.on("moveend", handleMove);
    return () => map.off("moveend", handleMove);
  }, [canUseMap, map, onViewportChange]);

  useEffect(() => {
    if (!map) return undefined;

    const updateClusters = () => {
      if (!canUseMap()) return;
      const zoom = map.getZoom();
      const radius = 60;
      const groupMap = new Map();

      safeMarkers.forEach((marker) => {
        const point = map.project([marker.lat, marker.lng], zoom);
        const key = `${Math.round(point.x / radius)}:${Math.round(point.y / radius)}`;
        const group = groupMap.get(key) || { markers: [], sumX: 0, sumY: 0 };
        group.markers.push(marker);
        group.sumX += point.x;
        group.sumY += point.y;
        groupMap.set(key, group);
      });

      const nextClusters = Array.from(groupMap.values()).map((group, index) => {
        if (group.markers.length === 1) {
          return { type: "marker", marker: group.markers[0], id: `m-${group.markers[0].id || index}` };
        }
        const avgX = group.sumX / group.markers.length;
        const avgY = group.sumY / group.markers.length;
        const center = map.unproject([avgX, avgY], zoom);
        return {
          type: "cluster",
          id: `c-${index}`,
          count: group.markers.length,
          lat: center.lat,
          lng: center.lng,
        };
      });

      const signature = [
        zoom,
        nextClusters
          .map((cluster) => {
            if (cluster.type === "marker") {
              return `m:${cluster.marker?.id ?? cluster.marker?.deviceId ?? cluster.id}`;
            }
            return `c:${cluster.count}:${cluster.lat.toFixed(5)}:${cluster.lng.toFixed(5)}`;
          })
          .join("|"),
      ].join("|");

      if (signature === clusterSignatureRef.current) return;
      clusterSignatureRef.current = signature;
      setClusters(nextClusters);
    };

    updateClusters();
    map.on("moveend zoomend", updateClusters);
    return () => {
      map.off("moveend zoomend", updateClusters);
    };
  }, [canUseMap, map, safeMarkers]);

  // Focar no marcador quando selecionado
  useEffect(() => {
    if (!focusMarkerId) return;
    const instance = markerRefs.current.get(focusMarkerId);
    if (!instance) return;
    const timer = setTimeout(() => {
      instance.openPopup();
    }, 1200);
    return () => clearTimeout(timer);
  }, [focusMarkerId]);

  return clusters.map((cluster) => {
    if (cluster.type === "cluster") {
      return (
        <Marker
          key={cluster.id}
          position={[cluster.lat, cluster.lng]}
          icon={getClusterIcon(cluster.count)}
        />
      );
    }

    const marker = cluster.marker;
    if (!marker) return null;

    return (
      <Marker
        key={marker.id ?? `${marker.lat}-${marker.lng}`}
        position={[marker.lat, marker.lng]}
        icon={
          createVehicleMarkerIcon({
            color: marker.color,
            iconType: marker.iconType,
            bearing: marker.heading,
            muted: marker.muted,
            accentColor: marker.accentColor,
            label: marker.mapLabel || marker.plate,
          }) ||
          L.divIcon({
            className: "fleet-marker",
            html: `<div style="width:18px;height:18px;border-radius:50%;background:${marker.color || "#60a5fa"};"></div>`,
            iconSize: [20, 20],
            iconAnchor: [10, 10],
          })
        }
        eventHandlers={{
          click: () => {
            const lat = Number(marker.lat);
            const lng = Number(marker.lng);
            if (Number.isFinite(lat) && Number.isFinite(lng)) {
              onUserAction?.();
              onFocusDevice?.({ lat, lng, reason: "MARKER_SELECT" });
            }
            if (marker.id) {
              onMarkerSelect?.(marker.id);
              onMarkerOpenDetails?.(marker.id);
            }
          },
        }}
        ref={(ref) => {
          if (ref && marker.id) markerRefs.current.set(marker.id, ref);
          else if (!ref && marker.id) markerRefs.current.delete(marker.id);
        }}
      >
        <Tooltip direction="top" offset={[0, -10]} opacity={0.9} className="monitoring-popup">
          <PopupContent marker={marker} />
        </Tooltip>
      </Marker>
    );
  });
}

function RegionOverlay({ target }) {
  const radius = target?.radius ?? 500;

  if (!target || !Number.isFinite(target.lat) || !Number.isFinite(target.lng)) return null;
  const targetLabel = target.label || target.name || "Alvo";
  const toleranceLabel = formatToleranceLabel(radius);
  return (
    <Circle
      center={[target.lat, target.lng]}
      radius={radius}
      pathOptions={{ color: "#22d3ee", fillColor: "#22d3ee", fillOpacity: 0.12, weight: 2 }}
    >
      <Tooltip direction="top" offset={[0, -10]} opacity={0.9} className="monitoring-popup">
        <div className="space-y-1">
          <OverlayHoverTooltip name={targetLabel} type="Alvo" tolerance={toleranceLabel} />
          <div className="text-[11px] text-white/60">{formatAddress(target.address)}</div>
        </div>
      </Tooltip>
    </Circle>
  );
}

function AddressMarker({ marker }) {
  const hasValidMarker = Boolean(marker && Number.isFinite(marker.lat) && Number.isFinite(marker.lng));
  const icon = getAddressPinIcon();

  if (!hasValidMarker) return null;

  return (
    <>
      <CircleMarker
        center={[marker.lat, marker.lng]}
        radius={8}
        pathOptions={{ color: "#22d3ee", fillColor: "#22d3ee", fillOpacity: 0.28, weight: 2 }}
      >
        <Tooltip direction="top" offset={[0, -6]} opacity={0.9} className="monitoring-popup">
          <div className="text-xs text-white/80">
            <div className="font-semibold text-white">{marker.label || "Ponto de referência"}</div>
            <div className="text-white/60">Toque para centralizar</div>
          </div>
        </Tooltip>
      </CircleMarker>
      <Marker position={[marker.lat, marker.lng]} icon={icon || undefined} />
    </>
  );
}

function ItineraryOverlayLayer({ overlay, focusPoint, variant = "official", shouldFit = true }) {
  const map = useMap();
  const lastFitTokenRef = useRef(null);
  const isDebug = variant === "debug";
  const { routeLines, geofences, checkpoints } = useMemo(
    () => buildOverlayShapes(overlay),
    [overlay],
  );
  const corridorBufferMeters = useMemo(() => {
    const raw = Number(overlay?.bufferMeters);
    if (!Number.isFinite(raw) || raw <= 0) return null;
    return raw;
  }, [overlay?.bufferMeters]);
  const routeCorridors = useMemo(
    () => buildRouteCorridorPolygons(routeLines, corridorBufferMeters),
    [corridorBufferMeters, routeLines],
  );
  const routeStyle = useMemo(
    () => (isDebug
      ? { color: "#ef4444", weight: 3, opacity: 0.9 }
      : { color: "#3b82f6", weight: 3, opacity: 0.9 }),
    [isDebug],
  );
  const corridorStyle = useMemo(
    () => (isDebug
      ? { color: "#ef4444", weight: 1, fillColor: "#ef4444", fillOpacity: 0.18 }
      : { color: "#3b82f6", weight: 1, fillColor: "#3b82f6", fillOpacity: 0.18 }),
    [isDebug],
  );
  const geofenceStyle = useMemo(
    () => (isDebug
      ? { color: "#ef4444", weight: 2, fillColor: "#ef4444", fillOpacity: 0.12 }
      : { color: "#3b82f6", weight: 2, fillColor: "#3b82f6", fillOpacity: 0.12 }),
    [isDebug],
  );
  const checkpointStyle = useMemo(
    () => (isDebug
      ? { color: "#ef4444", fillColor: "#ef4444", fillOpacity: 0.8 }
      : { color: "#3b82f6", fillColor: "#3b82f6", fillOpacity: 0.8 }),
    [isDebug],
  );
  const prefix = isDebug ? "itinerary-debug" : "itinerary";
  const routeTooltipLabel = overlay?.name || overlay?.itineraryName || overlay?.id || "Rota";
  const routeBufferLabel = useMemo(() => {
    const raw = Number(overlay?.bufferMeters);
    if (!Number.isFinite(raw) || raw <= 0) return "—";
    return formatToleranceLabel(raw);
  }, [overlay?.bufferMeters]);

  const safeRouteLines = routeLines.filter((line) => Array.isArray(line) && line.length > 1);
  const safeGeofences = geofences
    .map((geofence) => ({
      ...geofence,
      polygons: (geofence.polygons || []).filter((ring) => Array.isArray(ring) && ring.length > 2),
    }))
    .filter((geofence) => geofence.polygons.length > 0);

  useEffect(() => {
    if (!overlay || !map || !canInteractWithMap(map) || !shouldFit) return;
    const fitToken = overlay?.fitToken || "default";
    if (fitToken === lastFitTokenRef.current) return;
    lastFitTokenRef.current = fitToken;
    const bounds = L.latLngBounds([]);
    safeRouteLines.forEach((line) => {
      line.forEach((point) => bounds.extend(point));
    });
    safeGeofences.forEach((geofence) => {
      (geofence.polygons || []).forEach((ring) => {
        ring.forEach((point) => bounds.extend(point));
      });
    });
    if (focusPoint && Number.isFinite(focusPoint.lat) && Number.isFinite(focusPoint.lng)) {
      bounds.extend([focusPoint.lat, focusPoint.lng]);
    }
    if (!bounds.isValid()) return;
    map.fitBounds(bounds, { padding: [36, 36], animate: true });
  }, [focusPoint, map, overlay, safeGeofences, safeRouteLines, shouldFit]);

  if (!overlay) return null;

  return (
    <>
      {routeCorridors.length > 0
        ? routeCorridors.map((polygon, index) => (
            <Polygon
              key={`${prefix}-corridor-${index}`}
              positions={polygon}
              pathOptions={corridorStyle}
            >
              <Tooltip direction="top" offset={[0, -8]} opacity={0.9} className="monitoring-popup">
                <OverlayHoverTooltip name={routeTooltipLabel} type="Rota" tolerance={routeBufferLabel} />
              </Tooltip>
            </Polygon>
          ))
        : safeRouteLines.map((line, index) => (
            <Polyline
              key={`${prefix}-route-${index}`}
              positions={line}
              pathOptions={routeStyle}
            >
              <Tooltip direction="top" offset={[0, -8]} opacity={0.9} className="monitoring-popup">
                <OverlayHoverTooltip name={routeTooltipLabel} type="Rota" tolerance={routeBufferLabel} />
              </Tooltip>
            </Polyline>
          ))}
      {safeGeofences.map((geofence, index) => (
        <Polygon
          key={`${prefix}-geofence-${geofence.id || index}`}
          positions={geofence.polygons}
          pathOptions={geofenceStyle}
        >
          <Tooltip direction="top" offset={[0, -8]} opacity={0.9} className="monitoring-popup">
            <OverlayHoverTooltip
              name={geofence.name || "Cerca"}
              type="Cerca"
              tolerance={formatToleranceLabel(geofence?.toleranceMeters)}
            />
          </Tooltip>
        </Polygon>
      ))}
      {checkpoints.map((checkpoint, index) => (
        <CircleMarker
          key={`${prefix}-checkpoint-${index}`}
          center={[checkpoint.lat, checkpoint.lng]}
          radius={6}
          pathOptions={checkpointStyle}
        >
          <Tooltip direction="top" offset={[0, -8]} opacity={0.9} className="monitoring-popup">
            <OverlayHoverTooltip
              name={checkpoint.name || "Alvo"}
              type="Alvo"
              tolerance={formatToleranceLabel(checkpoint?.toleranceMeters)}
            />
          </Tooltip>
        </CircleMarker>
      ))}
    </>
  );
}

// --- COMPONENTE PRINCIPAL ---

const MonitoringMap = React.forwardRef(function MonitoringMap({
  markers = [],
  focusMarkerId = null,
  onViewportChange = null,
  regionTarget = null,
  onMarkerSelect = null,
  onMarkerOpenDetails = null,
  mapLayer,
  addressMarker,
  itineraryOverlay = null,
  itineraryOverlayFocusPoint = null,
  itineraryDebugOverlay = null,
  itineraryDebugOverlayFocusPoint = null,
  itineraryDebugBadge = null,
  invalidateKey = 0,
  mapPreferences = null,
}, _ref) {
  const fallbackLayer = DEFAULT_MAP_LAYER;
  const tileUrl =
    mapLayer?.url ||
    fallbackLayer?.url ||
    import.meta.env.VITE_MAP_TILE_URL ||
    "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const userActionRef = useRef(false);
  const markerRefs = useRef(new Map());
  const isMountedRef = useRef(true);
  const [isMapReady, setIsMapReady] = useState(false);
  const [shouldRenderMap, setShouldRenderMap] = useState(false);
  const pendingResizeRef = useRef({ rafIds: [], timeoutIds: [] });
  const resizeObserverRef = useRef(null);
  const resizeDebounceRef = useRef(null);
  const lastContainerSizeRef = useRef({ width: 0, height: 0 });
  const lastInvalidateAtRef = useRef(0);
  const isDev = Boolean(import.meta?.env?.DEV);
  const providerMaxZoom = Number.isFinite(mapLayer?.maxZoom)
    ? Number(mapLayer.maxZoom)
    : Number.isFinite(fallbackLayer?.maxZoom)
      ? Number(fallbackLayer.maxZoom)
      : 20;
  const effectiveMaxZoom = useMemo(
    () => buildEffectiveMaxZoom(mapPreferences?.maxZoom, providerMaxZoom),
    [mapPreferences?.maxZoom, providerMaxZoom],
  );
  const shouldWarnMaxZoom = Boolean(mapPreferences?.shouldWarnMaxZoom);

  const canUseMap = useCallback(
    (map) => canInteractWithMap(map, containerRef.current),
    [],
  );

  const focusDevice = useCallback(
    ({ lat, lng, zoom = 17, animate = true, reason } = {}) => {
      const nextLat = Number(lat);
      const nextLng = Number(lng);
      if (!Number.isFinite(nextLat) || !Number.isFinite(nextLng)) return false;
      const map = mapRef.current;
      if (!map || !isMapReady || !canUseMap(map)) return false;
      if (!isMountedRef.current) return false;
      const container = map.getContainer?.();
      if (!container || container.isConnected === false) return false;
      const rect = container.getBoundingClientRect?.();
      const hasContainerSize = Boolean(rect && rect.width > 0 && rect.height > 0);
      const shouldAnimate = Boolean(animate && hasContainerSize);
      userActionRef.current = true;
      if (isDev) {
        console.info("[MAP] USER_DEVICE_SELECT", { lat: nextLat, lng: nextLng, zoom, reason });
      }
      const runInvalidate = () => {
        if (!isMountedRef.current || mapRef.current !== map) return;
        const container = map.getContainer?.() || containerRef.current;
        if (!container || container.isConnected === false) return;
        const rect = container.getBoundingClientRect?.();
        if (!rect || rect.width <= 0 || rect.height <= 0) return;
        if (!canUseMap(map)) return;
        map.invalidateSize?.({ pan: false });
      };
      const scheduleResize = () => {
        const rafId = requestAnimationFrame(runInvalidate);
        pendingResizeRef.current.rafIds.push(rafId);
      };
      map.whenReady?.(scheduleResize);
      scheduleResize();
      map.stop?.();
      map.setView([nextLat, nextLng], zoom, { animate: shouldAnimate });
      const timeoutId = setTimeout(runInvalidate, 60);
      pendingResizeRef.current.timeoutIds.push(timeoutId);
      return true;
    },
    [canUseMap, isDev, isMapReady],
  );

  useImperativeHandle(
    _ref,
    () => ({
      focusAddress: ({ lat, lng }) => {
        const nextLat = Number(lat);
        const nextLng = Number(lng);
        if (!Number.isFinite(nextLat) || !Number.isFinite(nextLng)) return false;
        const map = mapRef.current;
        if (!map || !isMapReady || !canUseMap(map)) return false;
        return focusDevice({ lat: nextLat, lng: nextLng, zoom: 17, animate: true, reason: "ADDRESS_SELECT" });
      },
      focusDevice,
    }),
    [canUseMap, focusDevice, isMapReady],
  );

  useEffect(() => {
    if (!isDev) return undefined;
    console.info("[MAP] mounted — neutral state (no center, no zoom)");
    return undefined;
  }, [isDev]);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (resizeDebounceRef.current) {
        clearTimeout(resizeDebounceRef.current);
        resizeDebounceRef.current = null;
      }
      if (resizeObserverRef.current) {
        resizeObserverRef.current.disconnect();
        resizeObserverRef.current = null;
      }
      pendingResizeRef.current.rafIds.forEach((id) => cancelAnimationFrame(id));
      pendingResizeRef.current.timeoutIds.forEach((id) => clearTimeout(id));
      pendingResizeRef.current = { rafIds: [], timeoutIds: [] };
    };
  }, []);

  useEffect(() => {
    if (containerRef.current) {
      setShouldRenderMap(true);
    }
  }, []);

  useEffect(() => {
    return () => {
      const map = mapRef.current;
      if (map?.remove) {
        map.remove();
      }
      mapRef.current = null;
      markerRefs.current?.clear?.();
    };
  }, []);

  useEffect(() => {
    if (!isMapReady) return;
    const map = mapRef.current;
    if (!map || !canUseMap(map)) return;
    const now = Date.now();
    if (now - lastInvalidateAtRef.current < 120) return;
    lastInvalidateAtRef.current = now;
    const rafId = requestAnimationFrame(() => {
      if (!isMountedRef.current) return;
      if (!canUseMap(mapRef.current)) return;
      mapRef.current?.invalidateSize?.({ pan: false });
    });
    return () => cancelAnimationFrame(rafId);
  }, [canUseMap, invalidateKey, isMapReady, mapLayer?.key]);

  useEffect(() => {
    if (!shouldRenderMap) return undefined;
    const container = containerRef.current;
    if (!container) return undefined;

    const scheduleInvalidate = () => {
      if (resizeDebounceRef.current) {
        clearTimeout(resizeDebounceRef.current);
      }
      resizeDebounceRef.current = setTimeout(() => {
        const map = mapRef.current;
        if (!map || !isMapReady || !canUseMap(map)) return;
        const now = Date.now();
        if (now - lastInvalidateAtRef.current < 120) return;
        lastInvalidateAtRef.current = now;
        map.invalidateSize?.({ pan: false });
      }, 140);
    };

    const onResize = () => {
      const rect = container.getBoundingClientRect?.();
      if (!rect) return;
      const width = Math.round(rect.width);
      const height = Math.round(rect.height);
      if (width <= 0 || height <= 0) return;
      if (
        width === lastContainerSizeRef.current.width &&
        height === lastContainerSizeRef.current.height
      ) {
        return;
      }
      lastContainerSizeRef.current = { width, height };
      scheduleInvalidate();
    };

    onResize();

    if (typeof ResizeObserver === "function") {
      resizeObserverRef.current = new ResizeObserver(onResize);
      resizeObserverRef.current.observe(container);
    } else {
      window.addEventListener("resize", onResize);
    }

    return () => {
      if (resizeDebounceRef.current) {
        clearTimeout(resizeDebounceRef.current);
        resizeDebounceRef.current = null;
      }
      if (resizeObserverRef.current) {
        resizeObserverRef.current.disconnect();
        resizeObserverRef.current = null;
      } else {
        window.removeEventListener("resize", onResize);
      }
    };
  }, [canUseMap, isMapReady, shouldRenderMap]);

  useMapDataRefresh(mapRef, {
    markers,
    layers: [],
    selectedMarkerId: focusMarkerId,
    markerRefs,
  });

  const tileSubdomains = mapLayer?.subdomains ?? fallbackLayer?.subdomains ?? "abc";

  const handleMapReady = useCallback(
    (event) => {
      const map = event?.target || null;
      if (map) {
        mapRef.current = map;
      }
      setIsMapReady(true);
    },
    [],
  );

  return (
    <div className="monitoring-map-root h-full w-full min-w-0 bg-[#0b0f17] relative z-0">
      {shouldWarnMaxZoom ? (
        <div className="pointer-events-none absolute left-3 bottom-3 z-[1300] rounded-md border border-amber-500/40 bg-[#1f1205]/85 px-3 py-2 text-[11px] font-medium text-amber-100 shadow-lg shadow-amber-900/30">
          Zoom limitado a {effectiveMaxZoom} (web.maxZoom). Ajuste a configuração para permitir aproximação maior.
        </div>
      ) : null}
      {itineraryDebugBadge ? (
        <div
          className={`monitoring-test-banner pointer-events-none absolute left-3 top-3 z-[1300] ${
            itineraryDebugBadge.statusTone === "confirmed"
              ? "monitoring-test-banner--confirmed"
              : itineraryDebugBadge.kind === "disembarked"
                ? "monitoring-test-banner--disembarked"
                : ""
          }`}
          title="Exibição para conferência visual. Pode não estar embarcado no equipamento."
        >
          <div className="monitoring-test-banner__text">
            <span className="monitoring-test-banner__label">{itineraryDebugBadge.headline}</span>
            {itineraryDebugBadge.kind === "disembarked" ? (
              <span className="monitoring-test-banner__message">— {itineraryDebugBadge.message}</span>
            ) : (
              <>
                <span className="monitoring-test-banner__message">
                  — {itineraryDebugBadge.itineraryLabel}: {itineraryDebugBadge.itineraryName}
                </span>
                <span className="monitoring-test-banner__message">
                  — {itineraryDebugBadge.plateLabel}: {itineraryDebugBadge.plate}
                </span>
                <span className="monitoring-test-banner__message">
                  — {itineraryDebugBadge.statusLabelPrefix}:{" "}
                  <span
                    className={
                      itineraryDebugBadge.statusTone === "confirmed"
                        ? "monitoring-test-banner__status monitoring-test-banner__status--confirmed"
                        : "monitoring-test-banner__status"
                    }
                  >
                    {itineraryDebugBadge.statusLabel}
                  </span>
                </span>
              </>
            )}
          </div>
        </div>
      ) : null}
      <div ref={containerRef} className="h-full w-full">
        {shouldRenderMap ? (
          <AppMap
            ref={mapRef}
            zoomControl={false}
            scrollWheelZoom
            zoom={mapPreferences?.selectZoom}
            invalidateKey={invalidateKey}
            style={{ minHeight: 0 }}
            whenReady={handleMapReady}
          >
            <TileLayer
              key={mapLayer?.key || tileUrl}
              url={tileUrl}
              attribution={
                mapLayer?.attribution ||
                fallbackLayer?.attribution ||
                '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
              }
              maxZoom={effectiveMaxZoom}
              subdomains={tileSubdomains}
            />
            <MapZoomControls variant="classic" />

            <ItineraryOverlayLayer
              overlay={itineraryDebugOverlay}
              focusPoint={itineraryDebugOverlayFocusPoint}
              variant="debug"
              shouldFit={!itineraryOverlay}
            />
            <ItineraryOverlayLayer overlay={itineraryOverlay} focusPoint={itineraryOverlayFocusPoint} />

            <MarkerLayer
              markers={markers}
              focusMarkerId={focusMarkerId}
              onViewportChange={onViewportChange}
              onMarkerSelect={onMarkerSelect}
              onMarkerOpenDetails={onMarkerOpenDetails}
              onUserAction={() => {
                userActionRef.current = true;
              }}
              onFocusDevice={focusDevice}
              markerRefs={markerRefs}
            />

            <RegionOverlay target={regionTarget} />
            <AddressMarker marker={addressMarker} />
          </AppMap>
        ) : null}
      </div>
    </div>
  );
});

export default MonitoringMap;
