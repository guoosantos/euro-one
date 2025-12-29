import React, { useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { MapContainer, Marker, TileLayer, useMap, Polygon, Circle, CircleMarker, Tooltip } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "./monitoring-map.css";
import { createVehicleMarkerIcon } from "../../lib/map/vehicleMarkerIcon.js";
import { buildEffectiveMaxZoom } from "../../lib/map-config.js";

// --- CONFIGURAÇÃO E CONSTANTES ---
const NEUTRAL_CENTER = [0, 0];
const NEUTRAL_ZOOM = 2;
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
  onViewportChange,
  onMarkerSelect,
  onMarkerOpenDetails,
}) {
  const map = useMap();
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
              console.info("[MAP] USER_VEHICLE_SELECT", { lat, lng });
              map.stop?.();
              map.setView([lat, lng], 17, { animate: true });
              setTimeout(() => {
                map.invalidateSize?.();
              }, 50);
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

// --- COMPONENTE PRINCIPAL ---

const MonitoringMap = React.forwardRef(function MonitoringMap({
  markers = [],
  geofences = [],
  focusMarkerId = null,
  onViewportChange = null,
  regionTarget = null,
  onMarkerSelect = null,
  onMarkerOpenDetails = null,
  mapLayer,
  addressMarker,
  invalidateKey = 0,
  mapPreferences = null,
}, _ref) {
  const tileUrl = mapLayer?.url || import.meta.env.VITE_MAP_TILE_URL || "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
  const mapRef = useRef(null);
  const providerMaxZoom = Number.isFinite(mapLayer?.maxZoom) ? Number(mapLayer.maxZoom) : 20;
  const effectiveMaxZoom = useMemo(
    () => buildEffectiveMaxZoom(mapPreferences?.maxZoom, providerMaxZoom),
    [mapPreferences?.maxZoom, providerMaxZoom],
  );
  const shouldWarnMaxZoom = Boolean(mapPreferences?.shouldWarnMaxZoom);

  useEffect(() => {
    console.info("[MAP] mounted neutral", { center: NEUTRAL_CENTER, zoom: NEUTRAL_ZOOM });
  }, []);

  useImperativeHandle(
    _ref,
    () => ({
      focusAddress: ({ lat, lng }) => {
        const nextLat = Number(lat);
        const nextLng = Number(lng);
        if (!Number.isFinite(nextLat) || !Number.isFinite(nextLng)) return false;
        const map = mapRef.current;
        if (!map) return false;
        console.info("[MAP] USER_ADDRESS_SELECT", { lat: nextLat, lng: nextLng });
        map.stop?.();
        map.setView([nextLat, nextLng], 17, { animate: true });
        setTimeout(() => map.invalidateSize?.(), 50);
        return true;
      },
    }),
    [],
  );

  useEffect(() => {
    const map = mapRef.current;
    if (!map?.invalidateSize) return undefined;

    const timer = setTimeout(() => map.invalidateSize(), 60);
    return () => clearTimeout(timer);
  }, [invalidateKey, mapLayer?.key]);

  const tileSubdomains = mapLayer?.subdomains ?? "abc";

  return (
    <div className="monitoring-map-root h-full w-full bg-[#0b0f17] relative z-0">
      {shouldWarnMaxZoom ? (
        <div className="pointer-events-none absolute left-3 bottom-3 z-[1300] rounded-md border border-amber-500/40 bg-[#1f1205]/85 px-3 py-2 text-[11px] font-medium text-amber-100 shadow-lg shadow-amber-900/30">
          Zoom limitado a {effectiveMaxZoom} (web.maxZoom). Ajuste a configuração para permitir aproximação maior.
        </div>
      ) : null}
      <MapContainer
        center={NEUTRAL_CENTER}
        zoom={NEUTRAL_ZOOM}
        zoomControl
        scrollWheelZoom
        style={{ height: "100%", width: "100%" }}
        whenCreated={(map) => {
          mapRef.current = map;
        }}
      >
        <TileLayer
          key={mapLayer?.key || tileUrl}
          url={tileUrl}
          attribution={mapLayer?.attribution || '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'}
          maxZoom={effectiveMaxZoom}
          subdomains={tileSubdomains}
        />

        <MarkerLayer
          markers={markers}
          focusMarkerId={focusMarkerId}
          onViewportChange={onViewportChange}
          onMarkerSelect={onMarkerSelect}
          onMarkerOpenDetails={onMarkerOpenDetails}
        />

        <RegionOverlay target={regionTarget} />
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
