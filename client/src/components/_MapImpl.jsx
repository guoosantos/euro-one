import React, { useRef } from "react";
import { MapContainer, TileLayer, Marker, Popup } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import L from "leaflet";
import useMapLifecycle from "../lib/map/useMapLifecycle.js";
import { leafletDefaultIcon } from "../lib/map/leaflet-default-icon.js";
import { DEFAULT_MAP_LAYER } from "../lib/mapLayers.js";

const defaultIcon = leafletDefaultIcon;

const STATUS_COLORS = {
  online: "#22c55e",
  alert: "#facc15",
  offline: "#f87171",
  blocked: "#a855f7",
};

const statusIconCache = new Map();

function getStatusIcon(status) {
  const color = STATUS_COLORS[status];
  if (!color) return defaultIcon;
  if (statusIconCache.has(status)) return statusIconCache.get(status);

  const icon = L.divIcon({
    className: "fleet-marker",
    html: `<span style="display:block;width:18px;height:18px;border-radius:9999px;background:${color};box-shadow:0 0 0 2px rgba(11,15,23,0.85);border:2px solid rgba(255,255,255,0.85);"></span>`,
    iconSize: [18, 18],
    iconAnchor: [9, 9],
    popupAnchor: [0, -10],
  });

  statusIconCache.set(status, icon);
  return icon;
}

export default function MapImpl({ center = [-23.55, -46.63], zoom = 11, markers = [], height = 420, className }) {
  const containerClass = ["card p-0 overflow-hidden", className].filter(Boolean).join(" ");
  const mapRef = useRef(null);
  const { onMapReady } = useMapLifecycle({ mapRef });
  const baseLayer = DEFAULT_MAP_LAYER;
  const tileUrl = baseLayer?.url || "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
  const tileAttribution =
    baseLayer?.attribution || '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';
  const tileSubdomains = baseLayer?.subdomains ?? "abc";
  const tileMaxZoom = baseLayer?.maxZoom;

  return (
    <div className={containerClass} style={{ height }}>
      <MapContainer
        ref={mapRef}
        center={center}
        zoom={zoom}
        style={{ height: "100%", width: "100%" }}
        whenReady={onMapReady}
      >
        <TileLayer url={tileUrl} attribution={tileAttribution} subdomains={tileSubdomains} maxZoom={tileMaxZoom} />
        {markers.map((marker, index) => (
          <Marker
            key={marker.id || index}
            position={[marker.lat, marker.lng]}
            icon={marker.icon ?? getStatusIcon(marker.status)}
          >
            <Popup>{marker.popup ?? marker.label ?? "Veículo"}</Popup>
          </Marker>
        ))}
      </MapContainer>
    </div>
  );
}
