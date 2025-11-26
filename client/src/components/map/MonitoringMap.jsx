import React, { useEffect, useMemo, useRef } from "react";
import { MapContainer, Marker, Popup, TileLayer, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

const DEFAULT_CENTER = [-19.9167, -43.9345];
const DEFAULT_ZOOM = 12;
const FOCUS_ZOOM = 15;

const markerIconCache = new Map();

const ICON_SYMBOLS = {
  car: "🚗",
  motorcycle: "🏍️",
  truck: "🚚",
  person: "🧍",
  tag: "🏷️",
  watercraft: "🚤",
  default: "📡",
};

const STATUS_STYLES = {
  online: { background: "rgba(34,197,94,0.15)", border: "1px solid rgba(74,222,128,0.6)", color: "#bbf7d0" },
  alert: { background: "rgba(250,204,21,0.12)", border: "1px solid rgba(250,204,21,0.6)", color: "#fef9c3" },
  blocked: { background: "rgba(147,51,234,0.15)", border: "1px solid rgba(192,132,252,0.65)", color: "#e9d5ff" },
  offline: { background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.2)", color: "#e5e7eb" },
};

function getStatusStyle(status) {
  if (!status) return STATUS_STYLES.offline;
  return STATUS_STYLES[status] || STATUS_STYLES.offline;
}

function getMarkerIcon(color, iconType) {
  const key = `${iconType || "default"}-${color || "default"}`;
  if (markerIconCache.has(key)) return markerIconCache.get(key);

  const symbol = ICON_SYMBOLS[iconType] || ICON_SYMBOLS.default;
  const baseColor = color || "#22c55e";

  const iconHtml = `
    <div style="display:flex;align-items:center;justify-content:center;width:34px;height:42px;">
      <div style="position:relative;width:34px;height:34px;border-radius:14px;background:${baseColor};box-shadow:0 8px 14px rgba(0,0,0,0.35),0 0 0 2px rgba(11,15,23,0.9);border:2px solid rgba(255,255,255,0.8);overflow:hidden;">
        <div style="position:absolute;inset:0;background:linear-gradient(135deg,rgba(255,255,255,0.16),rgba(255,255,255,0.02));"></div>
        <span style="position:relative;z-index:1;display:flex;align-items:center;justify-content:center;width:100%;height:100%;font-size:18px;">${symbol}</span>
      </div>
    </div>
  `;

  const icon = L.divIcon({
    className: "fleet-marker",
    html: iconHtml,
    iconSize: [34, 42],
    iconAnchor: [17, 32],
    popupAnchor: [0, -28],
  });

  markerIconCache.set(key, icon);
  return icon;
}

function PopupContent({ marker }) {
  const statusStyle = getStatusStyle(marker.status);
  return (
    <div className="space-y-1.5 text-white">
      {marker.label ? <div className="text-sm font-semibold leading-tight">{marker.label}</div> : null}
      {marker.plate ? <div className="text-[11px] uppercase tracking-wide text-white/60">{marker.plate}</div> : null}
      {marker.address ? <div className="text-xs leading-snug text-white/80">{marker.address}</div> : null}
      <div className="flex items-center gap-2 text-xs text-white/80">
        <span className="rounded-lg bg-white/10 px-2 py-1 text-[11px] font-semibold text-white">
          {marker.speedLabel || "—"}
        </span>
        {marker.statusLabel ? (
          <span
            className="rounded-full px-2 py-1 text-[11px] font-semibold"
            style={{
              background: statusStyle.background,
              border: statusStyle.border,
              color: statusStyle.color,
            }}
          >
            {marker.statusLabel}
          </span>
        ) : null}
      </div>
      {marker.lastUpdateLabel ? (
        <div className="flex items-center gap-2 text-[11px] text-white/60">
          <span>{marker.updatedTitle ?? "Última atualização"}</span>
          <span className="text-white/80">{marker.lastUpdateLabel}</span>
        </div>
      ) : null}
    </div>
  );
}

function MarkerLayer({ markers, focusMarkerId, mapViewport, onViewportChange }) {
  const map = useMap();
  const lastFocusedRef = useRef(null);
  const hasInitialFitRef = useRef(false);
  const markerRefs = useRef(new Map());
  const safeMarkers = useMemo(
    () => markers.filter((marker) => Number.isFinite(marker.lat) && Number.isFinite(marker.lng)),
    [markers],
  );

  useEffect(() => {
    if (typeof onViewportChange !== "function") return undefined;

    const handleMove = () => {
      const center = map.getCenter();
      onViewportChange({ center: [center.lat, center.lng], zoom: map.getZoom() });
    };

    map.on("moveend", handleMove);
    return () => {
      map.off("moveend", handleMove);
    };
  }, [map, onViewportChange]);

  useEffect(() => {
    if (focusMarkerId) {
      const targetMarker = markerRefs.current.get(focusMarkerId);
      if (targetMarker) {
        targetMarker.openPopup();
      }
    }
  }, [focusMarkerId]);

  useEffect(() => {
    if (focusMarkerId) {
      const target = safeMarkers.find((marker) => marker.id === focusMarkerId);
      if (target && lastFocusedRef.current !== focusMarkerId) {
        lastFocusedRef.current = focusMarkerId;
        map.flyTo([target.lat, target.lng], Math.max(map.getZoom(), FOCUS_ZOOM), { duration: 0.75 });
        const targetMarker = markerRefs.current.get(focusMarkerId);
        if (targetMarker) {
          targetMarker.openPopup();
        }
        return;
      }
    }

    if (!safeMarkers.length) {
      hasInitialFitRef.current = false;
      lastFocusedRef.current = null;
      map.setView(DEFAULT_CENTER, DEFAULT_ZOOM);
      return;
    }

    if (!hasInitialFitRef.current) {
      if (mapViewport?.center && Array.isArray(mapViewport.center)) {
        const [lat, lng] = mapViewport.center;
        if (Number.isFinite(lat) && Number.isFinite(lng)) {
          map.setView([lat, lng], mapViewport.zoom || DEFAULT_ZOOM);
          hasInitialFitRef.current = true;
          return;
        }
      }

      const bounds = L.latLngBounds(safeMarkers.map((marker) => [marker.lat, marker.lng]));
      map.fitBounds(bounds, { padding: [48, 48], maxZoom: 16 });
      hasInitialFitRef.current = true;
    }
  }, [focusMarkerId, map, mapViewport, safeMarkers]);

  return safeMarkers.map((marker) => (
    <Marker
      key={marker.id ?? `${marker.lat}-${marker.lng}`}
      position={[marker.lat, marker.lng]}
      icon={getMarkerIcon(marker.color, marker.iconType)}
      ref={(instance) => {
        if (!marker.id) return;
        if (instance) {
          markerRefs.current.set(marker.id, instance);
        } else {
          markerRefs.current.delete(marker.id);
        }
      }}
    >
      <Popup>
        <PopupContent marker={marker} />
      </Popup>
    </Marker>
  ));
}

export default function MonitoringMap({
  markers = [],
  geofences = [],
  focusMarkerId = null,
  height = 360,
  mapViewport = null,
  onViewportChange = null,
}) {
  const style = useMemo(() => ({ height: typeof height === "number" ? `${height}px` : height || "360px" }), [height]);
  const initialCenterRef = useRef(
    mapViewport?.center && mapViewport.center.length === 2 ? mapViewport.center : DEFAULT_CENTER,
  );
  const initialZoomRef = useRef(Number.isFinite(mapViewport?.zoom) ? mapViewport.zoom : DEFAULT_ZOOM);

  const tileUrl = import.meta.env.VITE_MAP_TILE_URL || "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";

  return (
    <div className="rounded-xl border border-white/5 bg-[#0b0f17]" style={style}>
      <MapContainer
        center={initialCenterRef.current}
        zoom={initialZoomRef.current}
        style={{ height: "100%", width: "100%" }}
        scrollWheelZoom
      >
        <TileLayer url={tileUrl} />
        <MarkerLayer markers={markers} focusMarkerId={focusMarkerId} mapViewport={mapViewport} onViewportChange={onViewportChange} />
      </MapContainer>
    </div>
  );
}
