import React, { useEffect, useMemo, useState } from "react";
import { MapContainer, TileLayer, Marker, Popup } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import L from "leaflet";

const STATUS_PALETTE = {
  online: { bg: "rgba(34,197,94,0.18)", border: "rgba(34,197,94,0.8)", arrow: "#34d399" },
  alert: { bg: "rgba(250,204,21,0.22)", border: "rgba(250,204,21,0.78)", arrow: "#facc15" },
  offline: { bg: "rgba(148,163,184,0.22)", border: "rgba(148,163,184,0.75)", arrow: "#94a3b8" },
  blocked: { bg: "rgba(147,51,234,0.22)", border: "rgba(168,85,247,0.85)", arrow: "#a855f7" },
  default: { bg: "rgba(148,163,184,0.22)", border: "rgba(148,163,184,0.65)", arrow: "#a3aed0" },
};

const iconCache = new Map();

export default function MapImpl({
  center = [-23.55, -46.63],
  zoom = 11,
  markers = [],
  fullscreen = false,
  height = 420,
  className = "",
  autoFit = false,
  onMarkerClick,
  highlightedId,
  style,
}) {
  const [mapRef, setMapRef] = useState(null);

  const filteredMarkers = useMemo(() => markers.filter(hasValidCoords), [markers]);

  useEffect(() => {
    if (!autoFit || !mapRef) return;
    if (!filteredMarkers.length) return;

    const bounds = L.latLngBounds(filteredMarkers.map((marker) => [marker.lat, marker.lng]));
    if (!bounds.isValid()) return;

    if (filteredMarkers.length === 1) {
      const marker = filteredMarkers[0];
      mapRef.setView([marker.lat, marker.lng], Math.max(mapRef.getZoom(), 14));
      return;
    }

    mapRef.fitBounds(bounds, { padding: [80, 80] });
  }, [autoFit, filteredMarkers, mapRef]);

  useEffect(() => {
    if (!mapRef) return;
    if (!center || !Array.isArray(center)) return;
    if (autoFit && filteredMarkers.length > 1) return;
    if (!Number.isFinite(center[0]) || !Number.isFinite(center[1])) return;
    mapRef.setView(center, mapRef.getZoom());
  }, [autoFit, center, filteredMarkers.length, mapRef]);

  const containerClass = `${fullscreen ? "h-full w-full" : "card overflow-hidden p-0"} ${className}`.trim();
  const containerStyle = fullscreen ? style : { ...(style || {}), height };

  const mapCenter = useMemo(() => {
    if (filteredMarkers.length) {
      const first = filteredMarkers[0];
      return [first.lat, first.lng];
    }
    return center;
  }, [center, filteredMarkers]);

  return (
    <div className={containerClass} style={containerStyle}>
      <MapContainer
        center={mapCenter}
        zoom={zoom}
        scrollWheelZoom
        whenCreated={setMapRef}
        style={{ height: "100%", width: "100%" }}
        className="fleet-map"
      >
        <TileLayer url={import.meta.env.VITE_MAP_TILE_URL || "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"} />

        {filteredMarkers.map((marker) => (
          <Marker
            key={marker.id ?? `${marker.lat}-${marker.lng}`}
            position={[marker.lat, marker.lng]}
            icon={buildIcon(marker, highlightedId)}
            eventHandlers={{
              click: () => {
                onMarkerClick?.(marker);
                marker.onClick?.(marker);
              },
            }}
          >
            {(marker.popup || marker.label) && (
              <Popup className="fleet-popup" closeButton>
                {marker.popup ?? <div className="text-sm text-white/80">{marker.label}</div>}
              </Popup>
            )}
          </Marker>
        ))}
      </MapContainer>
    </div>
  );
}

function hasValidCoords(marker) {
  return Number.isFinite(marker?.lat) && Number.isFinite(marker?.lng);
}

function buildIcon(marker, highlightedId) {
  const tone = STATUS_PALETTE[marker.status] || STATUS_PALETTE.default;
  const rotation = Math.round(marker.course ?? marker.heading ?? 0);
  const speed = marker.speed != null ? Math.max(0, Math.round(marker.speed)) : null;
  const ignition = marker.ignition ? "1" : "0";
  const key = `${marker.status || "default"}-${rotation}-${speed}-${ignition}-${highlightedId === marker.id ? "1" : "0"}`;

  if (!iconCache.has(key)) {
    iconCache.set(
      key,
      L.divIcon({
        className: "fleet-marker-wrapper",
        iconAnchor: [20, 40],
        popupAnchor: [0, -32],
        html: buildIconHtml({ tone, rotation, speed, ignition, active: highlightedId === marker.id }),
      }),
    );
  }

  return iconCache.get(key);
}

function buildIconHtml({ tone, rotation, speed, ignition, active }) {
  const speedText = speed != null ? `${speed}<span class="fleet-marker__unit">km/h</span>` : "—";
  return `
    <div class="fleet-marker ${active ? "fleet-marker--active" : ""}" style="--marker-bg:${tone.bg};--marker-border:${tone.border};--marker-arrow:${tone.arrow};--marker-rotation:${rotation}deg;">
      <div class="fleet-marker__heading"></div>
      <div class="fleet-marker__body">
        <div class="fleet-marker__pulse"></div>
        <div class="fleet-marker__speed">${speedText}</div>
        <div class="fleet-marker__ignition ${ignition === "1" ? "is-on" : ""}"></div>
      </div>
    </div>
  `;
}
