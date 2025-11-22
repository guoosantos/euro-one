import React, { useEffect, useMemo } from "react";
import { MapContainer, Marker, Popup, TileLayer, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

const DEFAULT_CENTER = [-23.55, -46.63];
const DEFAULT_ZOOM = 11;

const markerIconCache = new Map();

function getMarkerIcon(color) {
  const key = color || "default";
  if (markerIconCache.has(key)) return markerIconCache.get(key);

  const icon = L.divIcon({
    className: "fleet-marker",
    html: `<span style="display:block;width:18px;height:18px;border-radius:9999px;background:${
      color || "#22c55e"
    };box-shadow:0 0 0 2px rgba(11,15,23,0.85);border:2px solid rgba(255,255,255,0.85);"></span>`,
    iconSize: [18, 18],
    iconAnchor: [9, 9],
    popupAnchor: [0, -10],
  });

  markerIconCache.set(key, icon);
  return icon;
}

function PopupContent({ marker }) {
  return (
    <div className="space-y-1">
      {marker.label ? <div className="text-sm font-semibold text-white">{marker.label}</div> : null}
      {marker.address ? <div className="text-xs text-white/70">{marker.address}</div> : null}
      {marker.speedLabel ? (
        <div className="text-xs text-white/80 flex justify-between">
          <span>{marker.speedTitle ?? "Speed"}</span>
          <span>{marker.speedLabel}</span>
        </div>
      ) : null}
      {marker.statusLabel ? (
        <div className="text-xs text-white/80 flex justify-between">
          <span>{marker.statusTitle ?? "Status"}</span>
          <span>{marker.statusLabel}</span>
        </div>
      ) : null}
      {marker.lastUpdateLabel ? (
        <div className="text-xs text-white/80 flex justify-between">
          <span>{marker.updatedTitle ?? "Updated"}</span>
          <span>{marker.lastUpdateLabel}</span>
        </div>
      ) : null}
    </div>
  );
}

function MarkerLayer({ markers, focusMarkerId }) {
  const map = useMap();
  const safeMarkers = useMemo(
    () => markers.filter((marker) => Number.isFinite(marker.lat) && Number.isFinite(marker.lng)),
    [markers],
  );

  useEffect(() => {
    if (!safeMarkers.length) {
      map.setView(DEFAULT_CENTER, DEFAULT_ZOOM);
      return;
    }

    const bounds = L.latLngBounds(safeMarkers.map((marker) => [marker.lat, marker.lng]));
    map.fitBounds(bounds, { padding: [48, 48], maxZoom: 16 });
  }, [map, safeMarkers]);

  useEffect(() => {
    if (!focusMarkerId) return;
    const target = safeMarkers.find((marker) => marker.id === focusMarkerId);
    if (target) {
      map.flyTo([target.lat, target.lng], Math.max(map.getZoom(), 14), { duration: 0.75 });
    }
  }, [focusMarkerId, map, safeMarkers]);

  return safeMarkers.map((marker) => (
    <Marker key={marker.id ?? `${marker.lat}-${marker.lng}`} position={[marker.lat, marker.lng]} icon={getMarkerIcon(marker.color)}>
      <Popup>
        <PopupContent marker={marker} />
      </Popup>
    </Marker>
  ));
}

export default function MonitoringMap({ markers = [], geofences = [], focusMarkerId = null, height = 360 }) {
  const style = useMemo(() => ({ height: typeof height === "number" ? `${height}px` : height || "360px" }), [height]);

  const safeCenter = useMemo(() => {
    const firstMarker = markers.find((marker) => Number.isFinite(marker.lat) && Number.isFinite(marker.lng));
    return firstMarker ? [firstMarker.lat, firstMarker.lng] : DEFAULT_CENTER;
  }, [markers]);

  const tileUrl = import.meta.env.VITE_MAP_TILE_URL || "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";

  return (
    <div className="rounded-xl border border-white/5 bg-[#0b0f17]" style={style}>
      <MapContainer
        center={safeCenter}
        zoom={DEFAULT_ZOOM}
        style={{ height: "100%", width: "100%" }}
        scrollWheelZoom
      >
        <TileLayer url={tileUrl} />
        <MarkerLayer markers={markers} focusMarkerId={focusMarkerId} />
      </MapContainer>
    </div>
  );
}
