import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MapContainer, Marker, TileLayer, useMap, Polygon, Circle, CircleMarker, Tooltip } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "./monitoring-map.css";

// --- CONFIGURAÇÃO E CONSTANTES ---
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

// --- HELPERS DE ESTILO ---

function getStatusStyle(status) {
  if (!status) return STATUS_STYLES.offline;
  return STATUS_STYLES[status] || STATUS_STYLES.offline;
}

function getMarkerIcon(color, iconType) {
  const key = `${iconType || "default"}-${color || "default"}`;
  if (markerIconCache.has(key)) return markerIconCache.get(key);

  const symbol = ICON_SYMBOLS[iconType] || ICON_SYMBOLS.default;
  const baseColor = color || "#22c55e";
  const accentColor = color || "#34d399";

  const iconHtml = `
    <div style="position:relative;display:flex;align-items:flex-end;justify-content:center;width:42px;height:54px;filter:drop-shadow(0 10px 18px rgba(0,0,0,0.4));">
      <div style="position:absolute;bottom:10px;width:42px;height:42px;border-radius:16px;border:2px solid ${accentColor};opacity:0.35;"></div>
      <div style="position:absolute;bottom:4px;width:34px;height:34px;border-radius:14px;background:linear-gradient(140deg,${baseColor},${baseColor} 60%,rgba(255,255,255,0.25));box-shadow:0 8px 14px rgba(0,0,0,0.35),0 0 0 2px rgba(11,15,23,0.9);border:2px solid rgba(255,255,255,0.9);overflow:hidden;">
        <div style="position:absolute;inset:0;background:radial-gradient(circle at 30% 25%,rgba(255,255,255,0.45),transparent 55%);"></div>
        <span style="position:relative;z-index:1;display:flex;align-items:center;justify-content:center;width:100%;height:100%;font-size:18px;">${symbol}</span>
      </div>
      <div style="position:absolute;bottom:-1px;width:14px;height:14px;background:${baseColor};transform:rotate(45deg);border-radius:3px;border:2px solid rgba(255,255,255,0.9);box-shadow:0 4px 10px rgba(0,0,0,0.35);"></div>
    </div>
  `;

  const icon = L.divIcon({
    className: "fleet-marker",
    html: iconHtml,
    iconSize: [42, 54],
    iconAnchor: [21, 42],
    popupAnchor: [0, -34],
  });

  markerIconCache.set(key, icon);
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

function MarkerLayer({ markers, focusMarkerId, mapViewport, onViewportChange, onMarkerSelect, onMarkerOpenDetails }) {
  const map = useMap();
  const hasInitialFitRef = useRef(false);
  const markerRefs = useRef(new Map());
  
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

  // Focar no marcador quando selecionado
  useEffect(() => {
    if (!map || !focusMarkerId) return;

    const target = safeMarkers.find((marker) => marker.id === focusMarkerId);
    if (target) {
      map.flyTo([target.lat, target.lng], Math.max(map.getZoom(), FOCUS_ZOOM), {
        duration: 0.7,
        easeLinearity: 0.3
      });

      setTimeout(() => {
        const instance = markerRefs.current.get(focusMarkerId);
        if (instance) instance.openPopup();
      }, 1200);
    }
  }, [focusMarkerId, map, safeMarkers]);

  // Ajuste inicial da viewport (Fit Bounds)
  useEffect(() => {
    if (!map || hasInitialFitRef.current) return;
    const applyInitialFit = () => {
      // Se tiver viewport salvo nas preferências, usa ele
      if (mapViewport?.center && Array.isArray(mapViewport.center)) {
        const [lat, lng] = mapViewport.center;
        if (Number.isFinite(lat) && Number.isFinite(lng)) {
          map.setView([lat, lng], mapViewport.zoom || DEFAULT_ZOOM);
          hasInitialFitRef.current = true;
          return;
        }
      }

      // Caso contrário, ajusta para ver todos os marcadores
      if (safeMarkers.length > 0) {
        const bounds = L.latLngBounds(safeMarkers.map((m) => [m.lat, m.lng]));
        map.fitBounds(bounds, { padding: [50, 50], maxZoom: 16 });
        hasInitialFitRef.current = true;
      } else {
        map.setView(DEFAULT_CENTER, DEFAULT_ZOOM);
        hasInitialFitRef.current = true;
      }
    };

    if (map._loaded) {
      applyInitialFit();
    } else {
      map.whenReady(applyInitialFit);
    }
  }, [map, safeMarkers, mapViewport]);

  return safeMarkers.map((marker) => (
    <Marker
      key={marker.id ?? `${marker.lat}-${marker.lng}`}
      position={[marker.lat, marker.lng]}
      icon={getMarkerIcon(marker.color || marker.accentColor, marker.iconType)}
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
  ));
}

function RegionOverlay({ target, mapReady }) {
  const map = useMap();
  const radius = target?.radius ?? 500;

  useEffect(() => {
    if (!map || !target || !mapReady) return;
    if (!Number.isFinite(target.lat) || !Number.isFinite(target.lng)) return;

    const applyFit = () => {
      try {
        const center = L.latLng(target.lat, target.lng);
        const circle = L.circle(center, { radius });
        map.fitBounds(circle.getBounds(), { padding: [48, 48], maxZoom: 16 });
      } catch (_error) {
        // Evita falha ao ajustar bounds quando o mapa não está pronto
      }
    };

    if (map._loaded) applyFit();
    else map.whenReady(applyFit);
  }, [map, mapReady, radius, target]);

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
  );
}

function ClickToZoom({ mapReady }) {
  const map = useMap();

  useEffect(() => {
    if (!map || !mapReady) return undefined;

    const handleClick = (event) => {
      const currentZoom = map.getZoom?.() ?? DEFAULT_ZOOM;
      const maxZoom = map.getMaxZoom?.() ?? 18;
      const nextZoom = Math.min(currentZoom + 1, maxZoom);
      const target = event?.latlng || map.getCenter();

      if (!target || typeof target.lat !== "number" || typeof target.lng !== "number") return;

      map.stop?.();
      map.flyTo(target, nextZoom, { duration: 0.25, easeLinearity: 0.35 });
    };

    map.on("click", handleClick);
    return () => map.off("click", handleClick);
  }, [map, mapReady]);

  return null;
}

function MapControls({ mapReady, mapViewport, focusTarget, bearing = 0, onRotate = null, onRotateTo = null, onResetRotation = null }) {
  const map = useMap();
  const compassRef = useRef(null);
  const dragStateRef = useRef(null);

  const stepRotate = () => {
    if (onRotate) onRotate(45);
  };

  const resetAndCenter = () => {
    onResetRotation?.();
    recenter();
  };

  const zoomIn = () => {
    if (!map) return;
    map.stop?.();
    map.zoomIn?.(1, { animate: true });
  };

  const zoomOut = () => {
    if (!map) return;
    map.stop?.();
    map.zoomOut?.(1, { animate: true });
  };

  const recenter = () => {
    if (!map) return;
    const targetCenter = Array.isArray(focusTarget?.center)
      ? focusTarget.center
      : Array.isArray(mapViewport?.center)
        ? mapViewport.center
        : null;
    const center = targetCenter || map.getCenter() || DEFAULT_CENTER;
    const zoom = Number.isFinite(focusTarget?.zoom)
      ? focusTarget.zoom
      : Number.isFinite(mapViewport?.zoom)
        ? mapViewport.zoom
        : map.getZoom?.() ?? DEFAULT_ZOOM;
    map.stop?.();
    map.flyTo(center, zoom, { duration: 0.3, easeLinearity: 0.25 });
  };

  const getPointerAngle = (event) => {
    const rect = compassRef.current?.getBoundingClientRect();
    if (!rect) return null;
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const angle = (Math.atan2(event.clientY - cy, event.clientX - cx) * 180) / Math.PI + 90;
    return Number.isFinite(angle) ? angle : null;
  };

  const handleCompassDown = (event) => {
    const startAngle = getPointerAngle(event);
    if (startAngle === null) return;

    dragStateRef.current = { startAngle, startBearing: bearing, hasMoved: false };

    const handleMove = (moveEvent) => {
      const angle = getPointerAngle(moveEvent);
      const state = dragStateRef.current;
      if (angle === null || !state) return;
      const delta = angle - state.startAngle;
      if (Math.abs(delta) > 0.5) state.hasMoved = true;

      if (onRotateTo) {
        onRotateTo(state.startBearing + delta);
      } else if (onRotate) {
        onRotate(delta);
      }
    };

    const handleUp = () => {
      const state = dragStateRef.current;
      dragStateRef.current = null;
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
      if (!state?.hasMoved) return;
    };

    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
  };

  return (
    <div className="pointer-events-none absolute right-3 top-3 z-[999] flex flex-col items-end gap-3">
      <div className="pointer-events-auto flex flex-col overflow-hidden rounded-md border border-white/15 bg-[#0f141c]/85 text-white/80 shadow-md backdrop-blur-sm">
        <button
          type="button"
          className="flex h-7 w-7 items-center justify-center text-[13px] font-semibold transition hover:bg-white/10"
          aria-label="Aumentar zoom"
          onClick={zoomIn}
        >
          +
        </button>
        <div className="h-px bg-white/10" />
        <button
          type="button"
          className="flex h-7 w-7 items-center justify-center text-[13px] font-semibold transition hover:bg-white/10"
          aria-label="Reduzir zoom"
          onClick={zoomOut}
        >
          −
        </button>
      </div>

      <button
        ref={compassRef}
        type="button"
        onMouseDown={handleCompassDown}
        onClick={stepRotate}
        onDoubleClick={resetAndCenter}
        className={`pointer-events-auto flex h-8 w-8 items-center justify-center rounded-md border px-0.5 text-[11px] font-semibold uppercase shadow-md transition backdrop-blur-sm ${
          bearing !== 0 ? "border-primary/60 bg-[#0f141c]/85 text-primary" : "border-white/15 bg-[#0f141c]/80 text-white/80"
        } hover:border-primary/60 hover:text-white`}
        aria-label="Controle de rotação do mapa"
      >
        <span
          className="relative flex h-6 w-6 items-center justify-center rounded-full border border-white/20 bg-white/5"
          style={{ transform: `rotate(${bearing}deg)` }}
        >
          <span className="text-[10px] font-bold text-white">N</span>
        </span>
      </button>
    </div>
  );
}

// --- COMPONENTE PRINCIPAL ---

export default function MonitoringMap({
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
  addressViewport = null,
  invalidateKey = 0,
}) {
  const tileUrl = mapLayer?.url || import.meta.env.VITE_MAP_TILE_URL || "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
  const [mapReady, setMapReady] = useState(false);
  const [mapBearing, setMapBearing] = useState(0);
  const mapRef = useRef(null);

  const normaliseBounds = useCallback((bounds) => {
    if (!bounds) return null;
    if (
      Array.isArray(bounds) &&
      bounds.length === 2 &&
      bounds.every((point) => Array.isArray(point) && point.length === 2 && point.every((value) => Number.isFinite(Number(value))))
    ) {
      const [[south, west], [north, east]] = bounds;
      return L.latLngBounds(
        L.latLng(Number(south), Number(west)),
        L.latLng(Number(north), Number(east)),
      );
    }
    return null;
  }, []);

  const normalizeBearing = useCallback((value) => {
    const mod = value % 360;
    return mod < 0 ? mod + 360 : mod;
  }, []);

  useEffect(() => {
    const instance = mapRef.current;
    if (!instance) return undefined;

    if (instance._loaded) {
      setMapReady(true);
      return undefined;
    }

    instance.whenReady(() => setMapReady(true));
  }, [mapLayer?.key]);

  useEffect(() => {
    if (!mapReady) return undefined;
    const map = mapRef.current;
    if (!map?.invalidateSize) return undefined;

    const timer = setTimeout(() => map.invalidateSize(), 60);
    return () => clearTimeout(timer);
  }, [invalidateKey, mapLayer?.key, mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return undefined;

    const pane = map.getPane?.("mapPane");
    const baseLatLngToContainerPoint = map.latLngToContainerPoint?.bind(map);
    const baseContainerPointToLatLng = map.containerPointToLatLng?.bind(map);

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
      if (!pane) return;
      const current = pane.style.transform || "";
      const withoutRotate = current.replace(/ rotate\([^)]*\)/, "").trim();
      pane.style.transform = `${withoutRotate} rotate(${mapBearing}deg)`;
      pane.style.transformOrigin = "50% 50%";
    };

    if (baseLatLngToContainerPoint && baseContainerPointToLatLng) {
      map.latLngToContainerPoint = (latlng, zoom) => rotatePoint(baseLatLngToContainerPoint(latlng, zoom), mapBearing);
      map.containerPointToLatLng = (point, zoom) => baseContainerPointToLatLng(rotatePoint(point, -mapBearing), zoom);
    }

    map.on("move", applyRotation);
    map.on("zoom", applyRotation);
    applyRotation();

    return () => {
      if (baseLatLngToContainerPoint) map.latLngToContainerPoint = baseLatLngToContainerPoint;
      if (baseContainerPointToLatLng) map.containerPointToLatLng = baseContainerPointToLatLng;
      map.off("move", applyRotation);
      map.off("zoom", applyRotation);
      if (pane) {
        pane.style.transform = (pane.style.transform || "").replace(/ rotate\([^)]*\)/, "").trim();
      }
    };
  }, [mapBearing, mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !focusTarget) return;

    const bounds = focusTarget.bounds ? normaliseBounds(focusTarget.bounds) : null;
    if (bounds) {
      map.stop?.();
      map.fitBounds(bounds, { padding: [48, 48], maxZoom: 17 });
      return;
    }

    if (!focusTarget.center) return;
    const [lat, lng] = focusTarget.center;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    const zoom = Number.isFinite(focusTarget.zoom)
      ? focusTarget.zoom
      : Math.max(map.getZoom?.() ?? DEFAULT_ZOOM, FOCUS_ZOOM);
    map.stop?.();
    map.flyTo([lat, lng], zoom, { duration: 0.6, easeLinearity: 0.25 });
  }, [focusTarget, mapReady, normaliseBounds]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    if (addressViewport) {
      const bounds = normaliseBounds(addressViewport.bounds);
      if (bounds) {
        map.stop?.();
        map.fitBounds(bounds, { padding: [60, 60], maxZoom: 17 });
        return;
      }

      if (addressViewport.center) {
        const [lat, lng] = addressViewport.center;
        if (Number.isFinite(lat) && Number.isFinite(lng)) {
          const targetZoom = Math.max(map.getZoom?.() ?? DEFAULT_ZOOM, FOCUS_ZOOM);
          map.stop?.();
          map.flyTo([lat, lng], targetZoom, { duration: 0.6, easeLinearity: 0.25 });
        }
        return;
      }
    }

    if (!addressMarker || !Number.isFinite(addressMarker.lat) || !Number.isFinite(addressMarker.lng)) return;

    const targetZoom = Math.max(map.getZoom?.() ?? DEFAULT_ZOOM, FOCUS_ZOOM);
    map.stop?.();
    map.flyTo([addressMarker.lat, addressMarker.lng], targetZoom, { duration: 0.6, easeLinearity: 0.25 });
  }, [addressMarker, addressViewport, mapReady, normaliseBounds]);

  const rotateMap = useCallback((delta) => {
    setMapBearing((prev) => normalizeBearing(prev + delta));
  }, [normalizeBearing]);

  const setMapBearingTo = useCallback((value) => {
    setMapBearing(normalizeBearing(value));
  }, [normalizeBearing]);

  const resetMapRotation = useCallback(() => {
    setMapBearing(0);
  }, []);

  const tileSubdomains = mapLayer?.subdomains ?? "abc";

  return (
    <div className="h-full w-full bg-[#0b0f17] relative z-0">
      <MapContainer
        center={DEFAULT_CENTER}
        zoom={DEFAULT_ZOOM}
        className="h-full w-full outline-none"
        zoomControl={false}
        scrollWheelZoom={true}
        preferCanvas={true}
        updateWhenIdle={true}
        wheelDebounceTime={120}
        wheelPxPerZoomLevel={70}
        whenCreated={(instance) => {
          mapRef.current = instance;
        }}
      >
        <TileLayer
          key={mapLayer?.key || tileUrl}
          url={tileUrl}
          attribution={mapLayer?.attribution || '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'}
          maxZoom={mapLayer?.maxZoom || 20}
          subdomains={tileSubdomains}
        />

        <ClickToZoom mapReady={mapReady} />
        <MapControls
          mapReady={mapReady}
          mapViewport={mapViewport}
          focusTarget={focusTarget}
          bearing={mapBearing}
          onRotate={rotateMap}
          onRotateTo={setMapBearingTo}
          onResetRotation={resetMapRotation}
        />

        <MarkerLayer
          markers={markers}
          focusMarkerId={focusMarkerId}
          mapViewport={mapViewport}
          onViewportChange={onViewportChange}
          onMarkerSelect={onMarkerSelect}
          onMarkerOpenDetails={onMarkerOpenDetails}
        />

        <RegionOverlay target={regionTarget} mapReady={mapReady} />
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
}

