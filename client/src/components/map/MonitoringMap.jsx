import React, { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { MapContainer, Marker, TileLayer, useMap, Polygon, Circle, CircleMarker, Tooltip } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "./monitoring-map.css";
import { createVehicleMarkerIcon } from "../../lib/map/vehicleMarkerIcon.js";
import { buildEffectiveMaxZoom, resolveFocusZoom } from "../../lib/map-config.js";

// --- CONFIGURAÇÃO E CONSTANTES ---
const DEFAULT_CENTER = [-19.9167, -43.9345];
const DEFAULT_ZOOM = 12;
const FOCUS_ZOOM = 17;
const DEBUG_MAP = true;

const clusterIconCache = new Map();
const ADDRESS_PIN_ICON = L.divIcon({
  className: "address-pin",
  html: `
    <div style="position:relative;display:flex;align-items:center;justify-content:center;width:20px;height:20px;">
      <div style="width:14px;height:14px;border-radius:9999px;background:#22d3ee;box-shadow:0 0 14px rgba(34,211,238,0.8);border:2px solid white;"></div>
    </div>
  `,
  iconSize: [20, 20],
  iconAnchor: [10, 10],
});

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
      {marker.label && <div className="text-sm font-bold leading-tight text-white">{marker.label}</div>}
      {marker.plate && <div className="text-[11px] uppercase tracking-wide text-white/60">{marker.plate}</div>}
      
      {addressText && <div className="text-xs leading-snug text-white/80 border-t border-white/10 pt-1 mt-1">{addressText}</div>}
      
      <div className="flex items-center gap-2 text-xs text-white/80 mt-2">
        <span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-mono font-semibold text-white">
          {marker.speedLabel || "0 km/h"}
        </span>
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
      
      {marker.lastUpdateLabel && (
        <div className="flex items-center gap-1 text-[10px] text-white/50 mt-1">
          <span>{marker.updatedTitle ?? "Atualizado:"}</span>
          <span className="text-white/70">{marker.lastUpdateLabel}</span>
        </div>
      )}
    </div>
  );
}

function MarkerLayer({
  markers,
  focusMarkerId,
  mapViewport,
  onViewportChange,
  onMarkerSelect,
  onMarkerOpenDetails,
  suppressInitialFit = false,
  maxZoomLimit = 16,
  isAddressLocked,
  logMapApply,
  logMapSkip,
}) {
  const map = useMap();
  const hasInitialFitRef = useRef(false);
  const markerRefs = useRef(new Map());
  const [clusters, setClusters] = useState([]);
  const clusterSignatureRef = useRef("");
  
  const safeMarkers = useMemo(
    () => markers.filter((marker) => Number.isFinite(marker.lat) && Number.isFinite(marker.lng)),
    [markers],
  );
  // Manipular eventos de movimento (opcional)
  useEffect(() => {
    if (!map || !onViewportChange) return undefined;

    const handleMove = () => {
      if (!map._loaded) return;
      const center = map.getCenter();
      onViewportChange({ center: [center.lat, center.lng], zoom: map.getZoom() });
    };

    map.on("moveend", handleMove);
    return () => map.off("moveend", handleMove);
  }, [map, onViewportChange]);

  useEffect(() => {
    if (!map) return undefined;

    const updateClusters = () => {
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
  }, [map, safeMarkers]);

  // Focar no marcador quando selecionado
  useEffect(() => {
    if (!map || !focusMarkerId) return;
    if (isAddressLocked?.()) {
      console.log("[ADDR_LOCK_BLOCK]", "auto-fit blocked");
      logMapSkip?.("FOCUS_MARKER");
      return;
    }

    const target = safeMarkers.find((marker) => marker.id === focusMarkerId);
    if (target) {
      logMapApply?.("FOCUS_MARKER", map, [target.lat, target.lng], Math.max(map.getZoom(), FOCUS_ZOOM));
      map.flyTo([target.lat, target.lng], Math.max(map.getZoom(), FOCUS_ZOOM), {
        duration: 0.7,
        easeLinearity: 0.3
      });

      setTimeout(() => {
        const instance = markerRefs.current.get(focusMarkerId);
        if (instance) instance.openPopup();
      }, 1200);
    }
  }, [focusMarkerId, isAddressLocked, map, safeMarkers]);

  // Ajuste inicial da viewport (Fit Bounds)
  useEffect(() => {
    if (!map || hasInitialFitRef.current || suppressInitialFit) return;
    const applyInitialFit = () => {
      if (isAddressLocked?.()) {
        console.log("[ADDR_LOCK_BLOCK]", "auto-fit blocked");
        logMapSkip?.("AUTO_FIT");
        return;
      }
      console.log("[AUTO_FIT] APPLY", {
        center: map.getCenter?.(),
        zoom: map.getZoom?.(),
        t: Date.now(),
      });
      // Se tiver viewport salvo nas preferências, usa ele
      if (mapViewport?.center && Array.isArray(mapViewport.center)) {
        const [lat, lng] = mapViewport.center;
        if (Number.isFinite(lat) && Number.isFinite(lng)) {
          logMapApply?.("AUTO_FIT_VIEWPORT", map, [lat, lng], mapViewport.zoom || DEFAULT_ZOOM);
          map.setView([lat, lng], mapViewport.zoom || DEFAULT_ZOOM);
          hasInitialFitRef.current = true;
          return;
        }
      }

      // Caso contrário, ajusta para ver todos os marcadores
      if (safeMarkers.length > 0) {
        const bounds = L.latLngBounds(safeMarkers.map((m) => [m.lat, m.lng]));
        const mapMax = map.getMaxZoom?.() ?? maxZoomLimit ?? 16;
        const nextZoom = Math.min(map.getBoundsZoom(bounds, false, [50, 50]), Math.min(mapMax, maxZoomLimit ?? 16));
        logMapApply?.("AUTO_FIT_MARKERS", map, [bounds.getCenter().lat, bounds.getCenter().lng], nextZoom);
        map.setView(bounds.getCenter(), nextZoom);
        hasInitialFitRef.current = true;
      } else {
        logMapApply?.("AUTO_FIT_DEFAULT", map, DEFAULT_CENTER, DEFAULT_ZOOM);
        map.setView(DEFAULT_CENTER, DEFAULT_ZOOM);
        hasInitialFitRef.current = true;
      }
    };

    if (map._loaded) {
      applyInitialFit();
    } else {
      map.whenReady(applyInitialFit);
    }
  }, [isAddressLocked, map, mapViewport, safeMarkers, suppressInitialFit]);

  return clusters.map((cluster) => {
    if (cluster.type === "cluster") {
      return (
        <Marker
          key={cluster.id}
          position={[cluster.lat, cluster.lng]}
          icon={getClusterIcon(cluster.count)}
        eventHandlers={{
          click: () => {
            if (isAddressLocked?.()) {
              console.log("[ADDR_LOCK_BLOCK]", "auto-fit blocked");
              logMapSkip?.("CLUSTER_CLICK");
              return;
            }
            logMapApply?.("CLUSTER_CLICK", map, [cluster.lat, cluster.lng], Math.min(map.getZoom() + 2, 18));
            map.flyTo([cluster.lat, cluster.lng], Math.min(map.getZoom() + 2, 18), { duration: 0.35 });
          },
        }}
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

function RegionOverlay({ target, mapReady, autoFit = true, isAddressLocked, logMapApply, logMapSkip }) {
  const map = useMap();
  const radius = target?.radius ?? 500;

  useEffect(() => {
    if (!map || !target || !mapReady) return;
    if (!autoFit) return;
    if (isAddressLocked?.()) {
      console.log("[ADDR_LOCK_BLOCK]", "auto-fit blocked");
      logMapSkip?.("REGION_AUTO_FIT");
      return;
    }
    if (!Number.isFinite(target.lat) || !Number.isFinite(target.lng)) return;

    const applyFit = () => {
      if (isAddressLocked?.()) {
        console.log("[ADDR_LOCK_BLOCK]", "auto-fit blocked");
        logMapSkip?.("REGION_AUTO_FIT");
        return;
      }
      console.log("[AUTO_FIT] APPLY", {
        center: map.getCenter?.(),
        zoom: map.getZoom?.(),
        t: Date.now(),
      });
      try {
        const center = L.latLng(target.lat, target.lng);
        const circle = L.circle(center, { radius });
        const maxZoom = map.getMaxZoom?.() ?? 16;
        const bounds = circle.getBounds();
        const nextZoom = Math.min(map.getBoundsZoom(bounds, false, [48, 48]), Math.min(maxZoom, 16));
        logMapApply?.("REGION_AUTO_FIT", map, [bounds.getCenter().lat, bounds.getCenter().lng], nextZoom);
        map.setView(bounds.getCenter(), nextZoom);
      } catch (_error) {
        // Evita falha ao ajustar bounds quando o mapa não está pronto
      }
    };

    if (map._loaded) applyFit();
    else map.whenReady(applyFit);
  }, [autoFit, isAddressLocked, map, mapReady, radius, target]);

  if (!target || !Number.isFinite(target.lat) || !Number.isFinite(target.lng)) return null;
  return (
    <Circle
      center={[target.lat, target.lng]}
      radius={radius}
      pathOptions={{ color: "#22d3ee", fillColor: "#22d3ee", fillOpacity: 0.12, weight: 2 }}
    >
      <Tooltip direction="top" offset={[0, -10]} opacity={0.9} className="monitoring-popup">
        <div className="text-xs text-white/80">
          <div className="font-semibold text-white">{target.label}</div>
          <div>{target.address}</div>
          <div className="text-white/60">Raio: {radius} m</div>
        </div>
      </Tooltip>
    </Circle>
  );
}

function AddressMarker({ marker }) {
  if (!marker || !Number.isFinite(marker.lat) || !Number.isFinite(marker.lng)) return null;

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
      <Marker position={[marker.lat, marker.lng]} icon={ADDRESS_PIN_ICON} />
    </>
  );
}

function ClickToZoom({ mapReady, maxZoom, logMapApply, isAddressLocked, logMapSkip }) {
  const map = useMap();

  useEffect(() => {
    if (!map || !mapReady) return undefined;

    const handleClick = (event) => {
      if (isAddressLocked?.()) {
        console.log("[ADDR_LOCK_BLOCK]", "auto-fit blocked");
        logMapSkip?.("MAP_CLICK_ZOOM");
        return;
      }
      const currentZoom = map.getZoom?.() ?? DEFAULT_ZOOM;
      const allowedMax = Number.isFinite(maxZoom) ? maxZoom : map.getMaxZoom?.() ?? 18;
      const nextZoom = Math.min(currentZoom + 1, allowedMax);
      const target = event?.latlng || map.getCenter();

      if (!target || typeof target.lat !== "number" || typeof target.lng !== "number") return;

      map.stop?.();
      logMapApply?.("MAP_CLICK_ZOOM", map, [target.lat, target.lng], nextZoom);
      map.flyTo(target, nextZoom, { duration: 0.25, easeLinearity: 0.35 });
    };

    map.on("click", handleClick);
    return () => map.off("click", handleClick);
  }, [isAddressLocked, logMapSkip, map, mapReady, maxZoom, logMapApply]);

  return null;
}

function MapControls({
  mapReady,
  mapViewport,
  focusTarget,
  bearing = 0,
  onRotate = null,
  onRotateTo = null,
  onResetRotation = null,
  maxZoom,
  logMapApply,
  isAddressLocked,
  logMapSkip,
}) {
  const map = useMap();
  const compassRef = useRef(null);
  const dragStateRef = useRef(null);
  const dragMovedRef = useRef(false);
  const pointerIdRef = useRef(null);

  const zoomIn = () => {
    if (!map) return;
    if (isAddressLocked?.()) {
      console.log("[ADDR_LOCK_BLOCK]", "auto-fit blocked");
      logMapSkip?.("MAP_ZOOM_IN");
      return;
    }
    map.stop?.();
    const allowedMax = Number.isFinite(maxZoom) ? maxZoom : map.getMaxZoom?.() ?? 18;
    const nextZoom = Math.min((map.getZoom?.() ?? DEFAULT_ZOOM) + 1, allowedMax);
    logMapApply?.("MAP_ZOOM_IN", map, [map.getCenter().lat, map.getCenter().lng], nextZoom);
    map.flyTo(map.getCenter(), nextZoom, { duration: 0.15, easeLinearity: 0.35 });
  };

  const zoomOut = () => {
    if (!map) return;
    if (isAddressLocked?.()) {
      console.log("[ADDR_LOCK_BLOCK]", "auto-fit blocked");
      logMapSkip?.("MAP_ZOOM_OUT");
      return;
    }
    map.stop?.();
    map.zoomOut?.(1, { animate: true });
  };

  const getPointerAngle = (event) => {
    const rect = compassRef.current?.getBoundingClientRect();
    if (!rect) return null;
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const angle = (Math.atan2(event.clientY - cy, event.clientX - cx) * 180) / Math.PI + 90;
    return Number.isFinite(angle) ? angle : null;
  };

  const handleCompassPointerDown = (event) => {
    event.preventDefault();
    const startAngle = getPointerAngle(event);
    if (startAngle === null) return;

    pointerIdRef.current = event.pointerId;
    dragStateRef.current = { startAngle, startBearing: bearing, lastAngle: startAngle, accumulated: 0, hasMoved: false };
    dragMovedRef.current = false;

    const handleMove = (moveEvent) => {
      if (pointerIdRef.current !== null && moveEvent.pointerId !== pointerIdRef.current) return;
      const angle = getPointerAngle(moveEvent);
      const state = dragStateRef.current;
      if (angle === null || !state) return;
      let delta = angle - state.lastAngle;
      if (delta > 180) delta -= 360;
      else if (delta < -180) delta += 360;

      state.accumulated += delta;
      state.lastAngle = angle;

      if (Math.abs(state.accumulated) > 0.5) {
        state.hasMoved = true;
        dragMovedRef.current = true;
      }

      const nextBearing = state.startBearing + state.accumulated;
      if (onRotateTo) {
        onRotateTo(nextBearing);
      } else if (onRotate) {
        onRotate(state.accumulated);
      }
    };

    const handleUp = (upEvent) => {
      if (pointerIdRef.current !== null && upEvent.pointerId !== pointerIdRef.current) return;
      const state = dragStateRef.current;
      dragStateRef.current = null;
      pointerIdRef.current = null;
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
      compassRef.current?.releasePointerCapture?.(event.pointerId);
      if (!state?.hasMoved) return;
    };

    compassRef.current?.setPointerCapture?.(event.pointerId);
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
  };

  const handleCompassClick = () => {
    if (dragMovedRef.current) {
      dragMovedRef.current = false;
      return;
    }
    onResetRotation?.();
  };

  const displayBearing = ((bearing % 360) + 360) % 360;

  return (
    <div className="monitoring-map-controls pointer-events-none absolute right-3 top-3 z-[1200] flex flex-col items-end gap-2">
      <div className="pointer-events-auto flex flex-col overflow-hidden rounded-md border border-white/15 bg-[#0f141c]/80 text-white/80 shadow-sm backdrop-blur-md">
        <button
          type="button"
          className="flex h-9 w-9 items-center justify-center text-[13px] font-semibold transition hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
          aria-label="Aumentar zoom"
          onClick={zoomIn}
        >
          +
        </button>
        <div className="h-px bg-white/10" />
        <button
          type="button"
          className="flex h-9 w-9 items-center justify-center text-[13px] font-semibold transition hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
          aria-label="Reduzir zoom"
          onClick={zoomOut}
        >
          −
        </button>
      </div>

      <button
        ref={compassRef}
        type="button"
        onPointerDown={handleCompassPointerDown}
        onClick={handleCompassClick}
        className={`pointer-events-auto flex h-9 w-9 items-center justify-center rounded-md border px-0.5 text-[11px] font-semibold uppercase shadow-sm transition backdrop-blur-md ${
          displayBearing !== 0 ? "border-primary/60 bg-[#0f141c]/85 text-primary" : "border-white/15 bg-[#0f141c]/80 text-white/80"
        } hover:border-primary/60 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60`}
        aria-label="Controle de rotação do mapa"
      >
        <span
          className="relative flex h-7 w-7 items-center justify-center rounded-full border border-white/20 bg-white/5"
          style={{ transform: `rotate(${bearing}deg)` }}
        >
          <span className="text-[10px] font-bold text-white">N</span>
        </span>
      </button>
    </div>
  );
}

// --- COMPONENTE PRINCIPAL ---

const MonitoringMap = React.forwardRef(function MonitoringMap({
  markers = [],
  geofences = [],
  focusMarkerId = null,
  mapViewport = null,
  onViewportChange = null,
  regionTarget = null,
  onMarkerSelect = null,
  onMarkerOpenDetails = null,
  mapLayer,
  focusTarget,
  addressMarker,
  invalidateKey = 0,
  mapPreferences = null,
}, _ref) {
  const tileUrl = mapLayer?.url || import.meta.env.VITE_MAP_TILE_URL || "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
  const [mapReady, setMapReady] = useState(false);
  const [mapBearing, setMapBearing] = useState(0);
  const mapRef = useRef(null);
  const addressFocusLockRef = useRef(0);
  const providerMaxZoom = Number.isFinite(mapLayer?.maxZoom) ? Number(mapLayer.maxZoom) : 20;
  const effectiveMaxZoom = useMemo(
    () => buildEffectiveMaxZoom(mapPreferences?.maxZoom, providerMaxZoom),
    [mapPreferences?.maxZoom, providerMaxZoom],
  );
  const selectZoom = useMemo(
    () => (Number.isFinite(mapPreferences?.selectZoom) && mapPreferences.selectZoom > 0 ? mapPreferences.selectZoom : FOCUS_ZOOM),
    [mapPreferences?.selectZoom],
  );
  const shouldWarnMaxZoom = Boolean(mapPreferences?.shouldWarnMaxZoom);
  const startAddressFocusLock = useCallback(() => {
    addressFocusLockRef.current = Date.now() + 5000;
    console.log("[ADDR_LOCK_START]");
  }, []);
  const isAddressLocked = useCallback(() => Date.now() < addressFocusLockRef.current, []);
  const logMapApply = useCallback(
    (reason, map, toCenter, toZoom, extra = {}) => {
      if (!DEBUG_MAP || !map) return;
      console.log("[MAP_APPLY]", {
        page: "Monitoring",
        reason,
        lockActive: isAddressLocked(),
        from: { center: map.getCenter?.(), zoom: map.getZoom?.() },
        to: { center: toCenter, zoom: toZoom },
        t: Date.now(),
        ...extra,
      });
    },
    [isAddressLocked],
  );
  const logMapSkip = useCallback((reason) => {
    if (!DEBUG_MAP) return;
    console.log("[MAP_SKIP]", { page: "Monitoring", reason, t: Date.now() });
  }, []);

  useImperativeHandle(
    _ref,
    () => ({
      focusAddress: (lat, lng, zoom = FOCUS_ZOOM) => {
        const map = mapRef.current;
        if (!map) return false;
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
        const nextZoom = FOCUS_ZOOM;
        console.log("[ADDR_SELECT]", { lat, lng });
        startAddressFocusLock();
        map.stop?.();
        console.log("[ADDR_APPLY_FLYTO]", FOCUS_ZOOM);
        map.flyTo([lat, lng], nextZoom, {
          animate: true,
          duration: 0.6,
          easeLinearity: 0.25,
        });

        return true;
      },
      lockAddress: (ms = 1500) => {
        addressFocusLockRef.current = Date.now() + ms;
        return true;
      },
    }),
    [startAddressFocusLock],
  );

  useEffect(() => {
    if (!mapReady) return undefined;
    const map = mapRef.current;
    if (!map?.invalidateSize) return undefined;
    if (isAddressLocked()) {
      console.log("[ADDR_LOCK_BLOCK]", "auto-fit blocked");
      return undefined;
    }

    const timer = setTimeout(() => map.invalidateSize(), 60);
    return () => clearTimeout(timer);
  }, [invalidateKey, isAddressLocked, mapLayer?.key, mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return undefined;
    const appliedBearing = mapBearing;

    const baseLatLngToContainerPoint = map.latLngToContainerPoint?.bind(map);
    const baseContainerPointToLatLng = map.containerPointToLatLng?.bind(map);
    const baseContainerPointToLayerPoint = map.containerPointToLayerPoint?.bind(map);
    const baseLayerPointToContainerPoint = map.layerPointToContainerPoint?.bind(map);
    const baseMouseEventToContainerPoint = map.mouseEventToContainerPoint?.bind(map);

    const rotatePoint = (point, angleDeg) => {
      if (!point || typeof point.x !== "number" || typeof point.y !== "number") return point;
      const size = map.getSize();
      const center = L.point(size.x / 2, size.y / 2);
      const angle = (angleDeg * Math.PI) / 180;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      const dx = point.x - center.x;
      const dy = point.y - center.y;
      return L.point(center.x + dx * cos - dy * sin, center.y + dx * sin + dy * cos);
    };

    const applyRotation = () => {
      const panes = map._panes || {};
      Object.values(panes).forEach((currentPane) => {
        if (!currentPane?.style) return;
        const current = currentPane.style.transform || "";
        const withoutRotate = current.replace(/ rotate\([^)]*\)/, "").trim();
        currentPane.style.transform = `${withoutRotate} rotate(${appliedBearing}deg)`;
        currentPane.style.transformOrigin = "50% 50%";
      });
    };

    if (baseLatLngToContainerPoint && baseContainerPointToLatLng) {
      map.latLngToContainerPoint = (latlng, zoom) => rotatePoint(baseLatLngToContainerPoint(latlng, zoom), appliedBearing);
      map.containerPointToLatLng = (point, zoom) => baseContainerPointToLatLng(rotatePoint(point, -appliedBearing), zoom);
    }

    if (baseContainerPointToLayerPoint && baseLayerPointToContainerPoint) {
      map.containerPointToLayerPoint = (point) => rotatePoint(baseContainerPointToLayerPoint(rotatePoint(point, -appliedBearing)), appliedBearing);
      map.layerPointToContainerPoint = (point) => rotatePoint(baseLayerPointToContainerPoint(rotatePoint(point, -appliedBearing)), appliedBearing);
    }

    if (baseMouseEventToContainerPoint) {
      map.mouseEventToContainerPoint = (event) => rotatePoint(baseMouseEventToContainerPoint(event), appliedBearing);
    }

    map.on("move", applyRotation);
    map.on("zoom", applyRotation);
    applyRotation();

    return () => {
      if (baseLatLngToContainerPoint) map.latLngToContainerPoint = baseLatLngToContainerPoint;
      if (baseContainerPointToLatLng) map.containerPointToLatLng = baseContainerPointToLatLng;
      if (baseContainerPointToLayerPoint) map.containerPointToLayerPoint = baseContainerPointToLayerPoint;
      if (baseLayerPointToContainerPoint) map.layerPointToContainerPoint = baseLayerPointToContainerPoint;
      if (baseMouseEventToContainerPoint) map.mouseEventToContainerPoint = baseMouseEventToContainerPoint;
      map.off("move", applyRotation);
      map.off("zoom", applyRotation);
      const panes = map._panes || {};
      Object.values(panes).forEach((currentPane) => {
        if (!currentPane?.style) return;
        currentPane.style.transform = (currentPane.style.transform || "").replace(/ rotate\([^)]*\)/, "").trim();
      });
    };
  }, [mapBearing, mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    console.log("[FOCUS_TARGET] APPLY", {
      focusTarget,
      center: map?.getCenter?.(),
      zoom: map?.getZoom?.(),
      t: Date.now(),
    });
    if (!map || !mapReady || !focusTarget) return;
    if (isAddressLocked()) {
      console.log("[ADDR_LOCK_BLOCK]", "auto-fit blocked");
      logMapSkip("FOCUS_TARGET");
      return;
    }
    if (focusTarget.type === "address") return;

    if (!focusTarget.center) return;
    const [lat, lng] = focusTarget.center;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    const { zoom } = resolveFocusZoom({
      requestedZoom: focusTarget.zoom,
      selectZoom,
      currentZoom: map.getZoom?.() ?? DEFAULT_ZOOM,
      maxZoom: mapPreferences?.maxZoom,
      providerMaxZoom,
    });
    map.stop?.();
    logMapApply("FOCUS_TARGET", map, [lat, lng], zoom);
    map.flyTo([lat, lng], zoom, { duration: 0.6, easeLinearity: 0.25 });
  }, [focusTarget, isAddressLocked, logMapApply, logMapSkip, mapReady, mapPreferences?.maxZoom, providerMaxZoom, selectZoom]);

  const rotateMap = useCallback((delta) => {
    setMapBearing((prev) => prev + delta);
  }, []);

  const setMapBearingTo = useCallback((value) => {
    setMapBearing(value);
  }, []);

  const resetMapRotation = useCallback(() => {
    setMapBearing(0);
  }, []);

  const tileSubdomains = mapLayer?.subdomains ?? "abc";

  return (
    <div className="monitoring-map-root h-full w-full bg-[#0b0f17] relative z-0">
      {shouldWarnMaxZoom ? (
        <div className="pointer-events-none absolute left-3 bottom-3 z-[1300] rounded-md border border-amber-500/40 bg-[#1f1205]/85 px-3 py-2 text-[11px] font-medium text-amber-100 shadow-lg shadow-amber-900/30">
          Zoom limitado a {effectiveMaxZoom} (web.maxZoom). Ajuste a configuração para permitir aproximação maior.
        </div>
      ) : null}
      <MapContainer
        center={DEFAULT_CENTER}
        zoom={DEFAULT_ZOOM}
        className="h-full w-full outline-none"
        zoomControl={false}
        maxZoom={effectiveMaxZoom}
        scrollWheelZoom={true}
        preferCanvas={true}
        updateWhenIdle={true}
        wheelDebounceTime={120}
        wheelPxPerZoomLevel={70}
        whenCreated={(instance) => {
          mapRef.current = instance;
          window._MAP_ = instance;
          window._EURO_ONE_MAP_ = instance;
          window.__EURO_ONE_FLY_TO__ = (lat, lng, zoom = 17) => {
            const map = window._EURO_ONE_MAP_;
            if (!map) return false;
            map.stop?.();
            logMapApply("DEBUG_FLY_TO", map, [lat, lng], zoom);
            map.flyTo([lat, lng], zoom, { duration: 0.6, easeLinearity: 0.25 });
            return true;
          };
          window.__EURO_ONE_SET_VIEW__ = (lat, lng, zoom = 17) => {
            const map = window._EURO_ONE_MAP_;
            if (!map) return false;
            map.stop?.();
            logMapApply("DEBUG_SET_VIEW", map, [lat, lng], zoom);
            map.setView([lat, lng], zoom, { animate: true });
            return true;
          };

          // Evita corrida no mapReady ao aguardar o Leaflet ficar pronto.
          if (instance?._loaded) {
            console.log("[MAP] READY", {
              center: instance.getCenter?.(),
              zoom: instance.getZoom?.(),
              t: Date.now(),
            });
            setMapReady(true);
          } else {
            instance.whenReady(() => {
              console.log("[MAP] READY", {
                center: instance.getCenter?.(),
                zoom: instance.getZoom?.(),
                t: Date.now(),
              });
              setMapReady(true);
            });
          }
        }}
      >
        <TileLayer
          key={mapLayer?.key || tileUrl}
          url={tileUrl}
          attribution={mapLayer?.attribution || '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'}
          maxZoom={effectiveMaxZoom}
          subdomains={tileSubdomains}
        />

        <ClickToZoom
          mapReady={mapReady}
          maxZoom={effectiveMaxZoom}
          logMapApply={logMapApply}
          isAddressLocked={isAddressLocked}
          logMapSkip={logMapSkip}
        />
        <MapControls
          mapReady={mapReady}
          mapViewport={mapViewport}
          focusTarget={focusTarget}
          bearing={mapBearing}
          onRotate={rotateMap}
          onRotateTo={setMapBearingTo}
          onResetRotation={resetMapRotation}
          maxZoom={effectiveMaxZoom}
          logMapApply={logMapApply}
          isAddressLocked={isAddressLocked}
          logMapSkip={logMapSkip}
        />

        <MarkerLayer
          markers={markers}
          focusMarkerId={focusMarkerId}
          mapViewport={mapViewport}
          onViewportChange={onViewportChange}
          onMarkerSelect={onMarkerSelect}
          onMarkerOpenDetails={onMarkerOpenDetails}
          suppressInitialFit={Boolean(addressMarker || focusTarget)}
          maxZoomLimit={effectiveMaxZoom}
          isAddressLocked={isAddressLocked}
          logMapApply={logMapApply}
          logMapSkip={logMapSkip}
        />

        <RegionOverlay
          target={regionTarget}
          mapReady={mapReady}
          autoFit={!addressMarker}
          isAddressLocked={isAddressLocked}
          logMapApply={logMapApply}
          logMapSkip={logMapSkip}
        />
        <AddressMarker marker={addressMarker} />

        {/* Renderização de Geofences */}
        {geofences.map((geo) => {
          if (!geo.coordinates || geo.coordinates.length === 0) return null;
          return (
            <Polygon
              key={geo.id}
              positions={geo.coordinates}
              pathOptions={{
                color: geo.color || "#3b82f6",
                fillColor: geo.color || "#3b82f6",
                fillOpacity: 0.15,
                weight: 2,
              }}
            />
          );
        })}
      </MapContainer>
    </div>
  );
});

export default MonitoringMap;
