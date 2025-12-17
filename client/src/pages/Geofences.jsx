import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Circle as LeafletCircle, CircleMarker, MapContainer, Marker, Polygon, Polyline, TileLayer, Tooltip, useMapEvents } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { Circle as CircleIcon, Download, FileUp, MousePointer2, Save, Search, Undo2, X } from "lucide-react";

import useGeocodeSearch from "../lib/hooks/useGeocodeSearch.js";
import { useGeofences } from "../lib/hooks/useGeofences.js";
import { downloadKml, geofencesToKml, kmlToGeofences } from "../lib/kml.js";
import Button from "../ui/Button.jsx";
import Input from "../ui/Input.jsx";

const DEFAULT_CENTER = [-23.55052, -46.633308];
const COLOR_PALETTE = ["#22c55e", "#38bdf8", "#f97316", "#a855f7", "#eab308", "#ef4444"];

const vertexIcon = L.divIcon({
  html: '<span style="display:block;width:14px;height:14px;border-radius:9999px;border:2px solid #0f172a;background:#22c55e;box-shadow:0 0 0 2px #e2e8f0;"></span>',
  iconSize: [14, 14],
  iconAnchor: [7, 7],
});

const centerIcon = L.divIcon({
  html: '<span style="display:block;width:14px;height:14px;border-radius:9999px;border:2px solid #0f172a;background:#f97316;box-shadow:0 0 0 2px #e2e8f0;"></span>',
  iconSize: [14, 14],
  iconAnchor: [7, 7],
});

const radiusIcon = L.divIcon({
  html: '<span style="display:block;width:14px;height:14px;border-radius:9999px;border:2px solid #0f172a;background:#38bdf8;box-shadow:0 0 0 2px #e2e8f0;"></span>',
  iconSize: [14, 14],
  iconAnchor: [7, 7],
});

function generateLocalId(prefix = "local") {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) {
    return `${prefix}-${uuid}`;
  }
  const entropy = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}-${entropy}`;
}

function distanceBetween(a, b) {
  return L.latLng(a[0], a[1]).distanceTo(L.latLng(b[0], b[1]));
}

function clampCoordinate(value, min, max) {
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  return Math.min(Math.max(num, min), max);
}

function sanitizePolygon(points = []) {
  if (!Array.isArray(points)) return [];
  const normalized = points
    .map((pair) => {
      if (!Array.isArray(pair) || pair.length < 2) return null;
      const lat = clampCoordinate(pair[0], -90, 90);
      const lng = clampCoordinate(pair[1], -180, 180);
      if (lat === null || lng === null) return null;
      return [lat, lng];
    })
    .filter(Boolean);

  const deduped = [];
  normalized.forEach((point) => {
    const last = deduped[deduped.length - 1];
    if (!last || distanceBetween(last, point) >= 0.5) {
      deduped.push(point);
    }
  });

  return deduped.slice(0, 200);
}

function sanitizeCircleGeometry(geofence) {
  const lat = clampCoordinate(geofence?.center?.[0], -90, 90);
  const lng = clampCoordinate(geofence?.center?.[1], -180, 180);
  const radius = Number(geofence?.radius ?? 0);
  if (lat === null || lng === null || !Number.isFinite(radius) || radius <= 0) return null;
  return { center: [lat, lng], radius: Math.max(10, Math.round(radius)) };
}

function movePoint(center, distanceMeters, bearingDeg = 90) {
  const [lat, lon] = center;
  const earthRadius = 6371000;
  const angularDistance = distanceMeters / earthRadius;
  const bearing = (bearingDeg * Math.PI) / 180;
  const latRad = (lat * Math.PI) / 180;
  const lonRad = (lon * Math.PI) / 180;

  const destLat =
    Math.asin(
      Math.sin(latRad) * Math.cos(angularDistance) +
        Math.cos(latRad) * Math.sin(angularDistance) * Math.cos(bearing),
    ) *
    (180 / Math.PI);

  const destLon =
    (lonRad +
      Math.atan2(
        Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(latRad),
        Math.cos(angularDistance) - Math.sin(latRad) * Math.sin(destLat * (Math.PI / 180)),
      )) *
    (180 / Math.PI);

  return [destLat, destLon];
}

function MapBridge({ onClick, onMove }) {
  useMapEvents({
    click: (event) => onClick(event.latlng),
    mousemove: (event) => onMove(event.latlng),
  });
  return null;
}

function GeofenceHandles({ geofence, onUpdatePolygon, onUpdateCircle }) {
  if (!geofence) return null;

  if (geofence.type === "polygon") {
    return geofence.points.map((point, index) => (
      <Marker
        key={`${geofence.id}-vertex-${index}`}
        position={point}
        icon={vertexIcon}
        draggable
        eventHandlers={{
          drag: (event) => {
            const { lat, lng } = event.target.getLatLng();
            const next = geofence.points.map((existing, idx) => (idx === index ? [lat, lng] : existing));
            onUpdatePolygon(next);
          },
        }}
      />
    ));
  }

  if (geofence.type === "circle") {
    const center = geofence.center || DEFAULT_CENTER;
    const radius = geofence.radius || 200;
    const radiusHandle = movePoint(center, radius, 90);
    return (
      <>
        <Marker
          position={center}
          icon={centerIcon}
          draggable
          eventHandlers={{
            drag: (event) => {
              const { lat, lng } = event.target.getLatLng();
              onUpdateCircle({ center: [lat, lng], radius: geofence.radius });
            },
          }}
        />
        <Marker
          position={radiusHandle}
          icon={radiusIcon}
          draggable
          eventHandlers={{
            drag: (event) => {
              const { lat, lng } = event.target.getLatLng();
              const newRadius = distanceBetween(center, [lat, lng]);
              onUpdateCircle({ center, radius: Math.max(10, Math.round(newRadius)) });
            },
          }}
        />
      </>
    );
  }

  return null;
}

export default function Geofences() {
  const mapRef = useRef(null);
  const importInputRef = useRef(null);
  const [drawMode, setDrawMode] = useState(null);
  const [draftPolygon, setDraftPolygon] = useState([]);
  const [draftCircle, setDraftCircle] = useState({ center: null, edge: null });
  const [hoverPoint, setHoverPoint] = useState(null);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [deletedIds, setDeletedIds] = useState(new Set());
  const [selectedId, setSelectedId] = useState(null);
  const [hiddenIds, setHiddenIds] = useState(new Set());
  const [saving, setSaving] = useState(false);
  const [uiError, setUiError] = useState(null);
  const [status, setStatus] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [geofenceFilter, setGeofenceFilter] = useState("");

  const {
    geofences: remoteGeofences,
    loading,
    error: fetchError,
    refresh,
    createGeofence,
    updateGeofence,
    deleteGeofence,
  } = useGeofences({ autoRefreshMs: 0 });

  const {
    suggestions = [],
    isSearching = false,
    searchRegion = async () => null,
    clearSuggestions = () => {},
    previewSuggestions: previewSearchSuggestions = () => Promise.resolve([]),
    error: geocodeError = null,
  } = useGeocodeSearch() || {};

  const [localGeofences, setLocalGeofences] = useState([]);
  const [baselineGeofences, setBaselineGeofences] = useState([]);

  const activeGeofences = useMemo(
    () => localGeofences.filter((geo) => !deletedIds.has(geo.id)),
    [localGeofences, deletedIds],
  );

  const selectedGeofence = useMemo(
    () => activeGeofences.find((geo) => geo.id === selectedId) || null,
    [activeGeofences, selectedId],
  );

  useEffect(() => {
    if (!selectedGeofence || !mapRef.current) return;
    const map = mapRef.current;
    if (selectedGeofence.type === "polygon" && selectedGeofence.points?.length) {
      const bounds = L.latLngBounds(selectedGeofence.points.map((point) => L.latLng(point[0], point[1])));
      map.fitBounds(bounds, { padding: [32, 32] });
    } else if (selectedGeofence.center) {
      map.flyTo(selectedGeofence.center, Math.max(map.getZoom(), 14));
    }
  }, [selectedGeofence]);

  useEffect(() => {
    if (hasUnsavedChanges) return;
    setLocalGeofences(remoteGeofences);
    setBaselineGeofences(remoteGeofences);
    setDeletedIds(new Set());
    setHiddenIds(new Set());
    setSelectedId((current) => current || remoteGeofences[0]?.id || null);
  }, [remoteGeofences, hasUnsavedChanges]);

  const resetDrafts = useCallback(() => {
    setDrawMode(null);
    setDraftPolygon([]);
    setDraftCircle({ center: null, edge: null });
    setHoverPoint(null);
  }, []);

  const startDrawing = useCallback((mode) => {
    setDrawMode(mode);
    setDraftPolygon([]);
    setDraftCircle({ center: null, edge: null });
    setHoverPoint(null);
    setStatus(mode === "polygon" ? "Clique para adicionar vértices. Clique no primeiro ponto para fechar." : "Clique para posicionar o centro do círculo, depois defina o raio.");
  }, []);

  const handleMapClick = useCallback(
    (latlng) => {
      const point = [latlng.lat, latlng.lng];
      if (drawMode === "polygon") {
        if (draftPolygon.length >= 3 && distanceBetween(draftPolygon[0], point) < 12) {
          const newId = generateLocalId("local");
          const color = COLOR_PALETTE[(localGeofences.length + deletedIds.size) % COLOR_PALETTE.length];
          const next = [...draftPolygon];
          setLocalGeofences((current) => [...current, { id: newId, name: `Cerca ${current.length + 1}`, type: "polygon", points: next, color, center: next[0], radius: null }]);
          setSelectedId(newId);
          setHasUnsavedChanges(true);
          resetDrafts();
          return;
        }
        setDraftPolygon((current) => [...current, point]);
        return;
      }

      if (drawMode === "circle") {
        if (!draftCircle.center) {
          setDraftCircle({ center: point, edge: null });
          return;
        }
        const radius = Math.round(distanceBetween(draftCircle.center, point));
        const newId = generateLocalId("local");
        const color = COLOR_PALETTE[(localGeofences.length + deletedIds.size) % COLOR_PALETTE.length];
        setLocalGeofences((current) => [
          ...current,
          { id: newId, name: `Círculo ${current.length + 1}`, type: "circle", center: draftCircle.center, radius: Math.max(25, radius), color, points: [] },
        ]);
        setSelectedId(newId);
        setHasUnsavedChanges(true);
        resetDrafts();
        return;
      }

      setSelectedId(null);
    },
    [deletedIds.size, drawMode, draftCircle.center, draftPolygon, localGeofences.length, resetDrafts],
  );

  const handleMouseMove = useCallback(
    (latlng) => {
      const point = [latlng.lat, latlng.lng];
      setHoverPoint(point);
      if (drawMode === "circle" && draftCircle.center && !draftCircle.edge) {
        setDraftCircle((current) => ({ ...current, edge: point }));
      }
    },
    [drawMode, draftCircle.center],
  );

  const handleUpdatePolygon = useCallback(
    (id, nextPoints) => {
      setLocalGeofences((current) =>
        current.map((geo) => (geo.id === id ? { ...geo, points: nextPoints, center: nextPoints[0] } : geo)),
      );
      setHasUnsavedChanges(true);
    },
    [],
  );

  const handleUpdateCircle = useCallback((id, payload) => {
    setLocalGeofences((current) =>
      current.map((geo) => (geo.id === id ? { ...geo, ...payload, points: [] } : geo)),
    );
    setHasUnsavedChanges(true);
  }, []);

  const handleRemoveSelected = useCallback(() => {
    if (!selectedGeofence) return;
    setLocalGeofences((current) => current.filter((geo) => geo.id !== selectedGeofence.id));
    if (selectedGeofence.id && !selectedGeofence.id.startsWith("local-") && !selectedGeofence.id.startsWith("kml-")) {
      setDeletedIds((current) => {
        const next = new Set(current);
        next.add(selectedGeofence.id);
        return next;
      });
    }
    setSelectedId(null);
    setHasUnsavedChanges(true);
  }, [selectedGeofence]);

  const draftRadius = useMemo(() => {
    if (!draftCircle.center) return null;
    const target = draftCircle.edge || hoverPoint;
    if (!target) return null;
    return Math.max(10, Math.round(distanceBetween(draftCircle.center, target)));
  }, [draftCircle.center, draftCircle.edge, hoverPoint]);

  const helperMessage = useMemo(() => {
    if (status) return status;
    if (drawMode === "polygon") return "Clique no mapa para adicionar vértices e feche no ponto inicial.";
    if (drawMode === "circle") return "Clique para definir o centro e arraste o raio do círculo.";
    return "Mapa em destaque: desenhe cercas leves ou importe um KML.";
  }, [drawMode, status]);

  const handleRenameSelected = useCallback(
    (value) => {
      if (!selectedId) return;
      setLocalGeofences((current) => current.map((geo) => (geo.id === selectedId ? { ...geo, name: value } : geo)));
      setHasUnsavedChanges(true);
    },
    [selectedId],
  );

  const handleCancelChanges = useCallback(() => {
    setLocalGeofences(baselineGeofences);
    setDeletedIds(new Set());
    setHiddenIds(new Set());
    setHasUnsavedChanges(false);
    setStatus("");
    setSelectedId(baselineGeofences[0]?.id || null);
    resetDrafts();
  }, [baselineGeofences, resetDrafts]);

  const buildPayload = useCallback((geo) => {
    if (geo.type === "polygon") {
      const sanitized = sanitizePolygon(geo.points);
      if (sanitized.length < 3) {
        throw new Error("Polígono precisa de pelo menos 3 vértices válidos.");
      }
      return {
        name: geo.name || "Cerca virtual",
        description: geo.description || "",
        type: geo.type,
        color: geo.color,
        points: sanitized,
        center: null,
        radius: null,
      };
    }

    const circle = sanitizeCircleGeometry(geo);
    if (!circle) {
      throw new Error("Defina centro e raio válidos para o círculo.");
    }

    return {
      name: geo.name || "Cerca virtual",
      description: geo.description || "",
      type: geo.type,
      color: geo.color,
      points: [],
      center: { lat: circle.center[0], lng: circle.center[1] },
      radius: circle.radius,
    };
  }, []);

  const handleSave = useCallback(async () => {
    setSaving(true);
    setUiError(null);
    setStatus("Sincronizando cercas...");
    try {
      for (const id of deletedIds) {
        await deleteGeofence(id);
      }

      for (const geo of activeGeofences) {
        const payload = buildPayload(geo);
        if (!geo.id || geo.id.startsWith("local-") || geo.id.startsWith("kml-")) {
          await createGeofence(payload);
        } else {
          await updateGeofence(geo.id, payload);
        }
      }

      await refresh();
      setHasUnsavedChanges(false);
      setDeletedIds(new Set());
      setStatus("Cercas salvas com sucesso.");
      resetDrafts();
    } catch (error) {
      setUiError(error);
      setStatus(error?.message || "Falha ao salvar cercas.");
    } finally {
      setSaving(false);
    }
  }, [activeGeofences, buildPayload, createGeofence, deleteGeofence, deletedIds, refresh, resetDrafts, updateGeofence]);

  const handleExport = useCallback(() => {
    const kml = geofencesToKml(activeGeofences);
    downloadKml("geofences.kml", kml);
  }, [activeGeofences]);

  const handleImportFile = useCallback(
    async (event) => {
      const file = event.target.files?.[0];
      if (!file) return;
      const text = await file.text();
      const parsed = kmlToGeofences(text);
      const mapped = parsed.map((item, index) => {
        const id = generateLocalId("kml");
        const center = item.center || item.points?.[0] || DEFAULT_CENTER;
        return {
          id,
          name: item.name || `KML ${index + 1}`,
          type: item.type === "circle" ? "circle" : "polygon",
          points: item.points || [],
          center,
          radius: item.radius || null,
          color: item.color || COLOR_PALETTE[(localGeofences.length + index) % COLOR_PALETTE.length],
        };
      });
      setLocalGeofences((current) => [...current, ...mapped]);
      setSelectedId((current) => current || mapped[0]?.id || null);
      setHasUnsavedChanges(true);
      event.target.value = "";
    },
    [localGeofences.length],
  );

  const handleSearchChange = useCallback(
    (event) => {
      const value = event.target.value;
      setSearchQuery(value);
      previewSearchSuggestions(value);
    },
    [previewSearchSuggestions],
  );

  const flyTo = useCallback((lat, lng, bounds) => {
    const map = mapRef.current;
    if (!map) return;
    if (Array.isArray(bounds) && bounds.length === 4) {
      const [[south, west], [north, east]] = [
        [Number(bounds[0]), Number(bounds[2])],
        [Number(bounds[1]), Number(bounds[3])],
      ];
      map.fitBounds(
        L.latLngBounds(
          L.latLng(south, west),
          L.latLng(north, east),
        ),
        { padding: [32, 32] },
      );
      return;
    }
    map.flyTo([lat, lng], 14);
  }, []);

  const handleSearchSubmit = useCallback(
    async (event) => {
      event.preventDefault();
      const best = await searchRegion(searchQuery);
      if (best?.lat && best?.lng) {
        flyTo(best.lat, best.lng, best.boundingBox);
        clearSuggestions();
      }
    },
    [clearSuggestions, flyTo, searchQuery, searchRegion],
  );

  const guideLine = useMemo(() => {
    if (drawMode !== "polygon") return [];
    const points = [...draftPolygon];
    if (hoverPoint) points.push(hoverPoint);
    return points;
  }, [drawMode, draftPolygon, hoverPoint]);

  const visibleGeofences = useMemo(
    () => activeGeofences.filter((geo) => !hiddenIds.has(geo.id)),
    [activeGeofences, hiddenIds],
  );

  const filteredGeofences = useMemo(() => {
    const term = geofenceFilter.trim().toLowerCase();
    if (!term) return activeGeofences;
    return activeGeofences.filter((geo) => geo.name?.toLowerCase().includes(term));
  }, [activeGeofences, geofenceFilter]);

  const toggleVisibility = useCallback((id) => {
    setHiddenIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const markVisible = useCallback((ids = []) => {
    setHiddenIds((current) => {
      const next = new Set(current);
      ids.forEach((id) => next.delete(id));
      return next;
    });
  }, []);

  const isBusy = loading || saving;

  return (
    <div className="map-page">
      <div className="map-container">
        <MapContainer
          center={selectedGeofence?.center || DEFAULT_CENTER}
          zoom={13}
          scrollWheelZoom
          className="h-full w-full"
          whenCreated={(map) => {
            mapRef.current = map;
          }}
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />

          <MapBridge onClick={handleMapClick} onMove={handleMouseMove} />

          {visibleGeofences.map((geo) => {
            if (geo.type === "circle") {
              if (!geo.center || !geo.radius) return null;
              return (
                <LeafletCircle
                  key={geo.id}
                  center={geo.center}
                  radius={geo.radius}
                  pathOptions={{
                    color: selectedId === geo.id ? "#eab308" : geo.color || "#22c55e",
                    fillOpacity: 0.1,
                    weight: selectedId === geo.id ? 4 : 2,
                  }}
                  eventHandlers={{
                    click: (event) => {
                      event.originalEvent?.preventDefault();
                      setSelectedId(geo.id);
                    },
                  }}
                >
                  <Tooltip sticky direction="top">{geo.name}</Tooltip>
                </LeafletCircle>
              );
            }
            if (!geo.points?.length) return null;
            return (
              <Polygon
                key={geo.id}
                positions={geo.points}
                pathOptions={{
                  color: selectedId === geo.id ? "#eab308" : geo.color || "#38bdf8",
                  fillOpacity: 0.12,
                  weight: selectedId === geo.id ? 4 : 2,
                }}
                eventHandlers={{
                  click: (event) => {
                    event.originalEvent?.preventDefault();
                    setSelectedId(geo.id);
                  },
                }}
              >
                <Tooltip sticky direction="top">{geo.name}</Tooltip>
              </Polygon>
            );
          })}

          {drawMode === "polygon" && guideLine.length >= 2 && (
            <Polyline positions={guideLine} pathOptions={{ color: "#22c55e", dashArray: "10 6", weight: 2 }} />
          )}

          {drawMode === "polygon" &&
            draftPolygon.map((point, index) => (
              <CircleMarker
                key={`draft-${index}`}
                center={point}
                radius={5}
                pathOptions={{ color: index === 0 && draftPolygon.length >= 3 ? "#f59e0b" : "#22c55e", weight: 2, fillOpacity: 1 }}
                eventHandlers={{
                  click: () => {
                    if (index === 0 && draftPolygon.length >= 3) {
                      const newId = generateLocalId("local");
                      const color = COLOR_PALETTE[(localGeofences.length + deletedIds.size) % COLOR_PALETTE.length];
                      setLocalGeofences((current) => [...current, { id: newId, name: `Cerca ${current.length + 1}`, type: "polygon", points: draftPolygon, color, center: draftPolygon[0], radius: null }]);
                      setSelectedId(newId);
                      setHasUnsavedChanges(true);
                      resetDrafts();
                    }
                  },
                }}
              />
            ))}

          {drawMode === "circle" && draftCircle.center && draftRadius && (
            <LeafletCircle
              center={draftCircle.center}
              radius={draftRadius}
              pathOptions={{ color: "#38bdf8", dashArray: "8 6", weight: 2, fillOpacity: 0.08 }}
            />
          )}

          {selectedGeofence && (
            <GeofenceHandles
              geofence={selectedGeofence}
              onUpdatePolygon={(points) => handleUpdatePolygon(selectedGeofence.id, points)}
              onUpdateCircle={(payload) => handleUpdateCircle(selectedGeofence.id, payload)}
            />
          )}
        </MapContainer>
      </div>

      <div className="floating-top-bar">
        <div className="map-overlay-card w-full">
          <div className="flex w-full flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="space-y-1">
                <p className="text-[11px] uppercase tracking-[0.1em] text-white/60">Cercas</p>
                <h1 className="text-lg font-semibold text-white">Mapa como palco</h1>
                <p className="text-xs text-white/70">{helperMessage}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="map-status-pill">
                  <span className="dot" />
                  {activeGeofences.length} cercas
                </span>
                {hasUnsavedChanges && <span className="map-status-pill border-amber-400/60 bg-amber-500/10 text-amber-100">Alterações pendentes</span>}
                {drawMode && (
                  <span className="map-status-pill border-primary/50 bg-primary/10 text-cyan-100">
                    {drawMode === "polygon" ? "Desenhando polígono" : "Ajustando círculo"}
                  </span>
                )}
                {uiError && <span className="map-status-pill border-red-400/60 bg-red-500/10 text-red-100">{uiError.message}</span>}
                {fetchError && <span className="map-status-pill border-red-400/60 bg-red-500/10 text-red-100">{fetchError.message}</span>}
              </div>
            </div>

            <div className="relative flex w-full flex-wrap items-center gap-2">
              <form onSubmit={handleSearchSubmit} className="map-search-form">
                <Input
                  value={searchQuery}
                  onChange={handleSearchChange}
                  placeholder="Buscar endereço ou coordenada"
                  icon={Search}
                  className="map-search-input pr-12"
                />
                <div className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-white/70">
                  {isSearching ? "Buscando..." : geocodeError?.message || ""}
                </div>
              </form>
              {suggestions.length > 0 && (
                <div className="map-search-suggestions">
                  {suggestions.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => {
                        setSearchQuery(item.concise || item.label);
                        flyTo(item.lat, item.lng, item.boundingBox);
                        clearSuggestions();
                      }}
                      className="flex w-full items-start gap-2 px-3 py-2 text-left text-sm text-white/80 transition hover:bg-white/5"
                    >
                      <span className="mt-1 h-2 w-2 rounded-full bg-primary/80" />
                      <span>
                        <div className="font-semibold text-white">{item.concise || item.label}</div>
                        <div className="text-xs text-white/60">Lat {item.lat.toFixed(4)} · Lng {item.lng.toFixed(4)}</div>
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="floating-left-panel">
        <div className="space-y-3">
          <div className="space-y-1">
            <p className="text-[11px] uppercase tracking-[0.1em] text-white/60">Criar cerca</p>
            <h2 className="text-base font-semibold text-white">Polígono ou círculo</h2>
            <p className="text-xs text-white/60">Clique no mapa; tudo flutua sobre o mapa.</p>
          </div>

          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-[0.08em] text-white/60">Selecionar</p>
            <div className="space-y-2">
              {filteredGeofences.map((geo) => {
                const visible = !hiddenIds.has(geo.id);
                return (
                  <button
                    key={geo.id}
                    type="button"
                    onClick={() => setSelectedId(geo.id)}
                    className={`flex w-full items-center justify-between rounded-xl border px-3 py-2 text-left text-sm transition ${selectedId === geo.id ? "border-primary/50 bg-primary/10 text-white" : "border-white/10 bg-white/5 text-white/80 hover:border-white/20"}`}
                  >
                    <span className="flex items-center gap-2">
                      <span className="h-3 w-3 rounded-full" style={{ background: geo.color || "#22c55e" }} />
                      {geo.name}
                    </span>
                    <span className="flex items-center gap-2 text-[11px] text-white/60">
                      <input
                        type="checkbox"
                        checked={visible}
                        onChange={() => toggleVisibility(geo.id)}
                        className="h-3 w-3 rounded border-white/40 bg-transparent accent-primary"
                        onClick={(event) => event.stopPropagation()}
                      />
                      {geo.type === "circle" ? "Círculo" : `${geo.points?.length || 0} pts`}
                    </span>
                  </button>
                );
              })}
              {activeGeofences.length === 0 && <p className="text-xs text-white/60">Nenhuma cerca carregada.</p>}
            </div>
          </div>

          {selectedGeofence ? (
            <div className="space-y-3 rounded-xl border border-white/10 bg-white/5 p-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-white">{selectedGeofence.name}</p>
                <span className="rounded-full bg-white/10 px-2 py-1 text-[11px] text-white/70">{selectedGeofence.type === "circle" ? "Círculo" : "Polígono"}</span>
              </div>
              <Input
                label="Nome"
                value={selectedGeofence.name}
                onChange={(event) => handleRenameSelected(event.target.value)}
              />
              <div className="flex items-center justify-between text-xs text-white/60">
                <span>
                  {selectedGeofence.type === "circle"
                    ? `Raio ${(selectedGeofence.radius || 0).toFixed(0)} m`
                    : `${selectedGeofence.points?.length || 0} vértices`}
                </span>
                <Button size="sm" variant="ghost" onClick={handleRemoveSelected}>
                  Remover
                </Button>
                <Button size="sm" variant="secondary" onClick={() => markVisible([selectedGeofence.id])}>
                  Mostrar
                </Button>
              </div>
            </div>
          ) : (
            <p className="text-xs text-white/60">Selecione uma cerca ou desenhe uma nova para editar.</p>
          )}

        </div>
      </div>

      <div className="floating-toolbar">
        <button
          type="button"
          className={`map-tool-button ${drawMode === "polygon" ? "is-active" : ""}`}
          onClick={() => startDrawing("polygon")}
          title="Desenhar polígono"
        >
          <MousePointer2 size={16} />
        </button>
        <button
          type="button"
          className={`map-tool-button ${drawMode === "circle" ? "is-active" : ""}`}
          onClick={() => startDrawing("circle")}
          title="Desenhar círculo"
        >
          <CircleIcon size={16} />
        </button>
        {drawMode && (
          <button type="button" className="map-tool-button" onClick={resetDrafts} title="Encerrar desenho">
            <X size={16} />
          </button>
        )}
        <button
          type="button"
          className="map-tool-button disabled:cursor-not-allowed disabled:opacity-50"
          onClick={handleSave}
          disabled={!hasUnsavedChanges || isBusy}
          title="Salvar cercas"
        >
          {saving ? <Undo2 size={16} className="animate-spin" /> : <Save size={16} />}
        </button>
        <button
          type="button"
          className="map-tool-button disabled:cursor-not-allowed disabled:opacity-50"
          onClick={handleCancelChanges}
          disabled={!hasUnsavedChanges}
          title="Cancelar mudanças"
        >
          <Undo2 size={16} />
        </button>
        <button
          type="button"
          className="map-tool-button"
          onClick={() => importInputRef.current?.click()}
          title="Importar KML"
        >
          <FileUp size={16} />
        </button>
        <button type="button" className="map-tool-button" onClick={handleExport} title="Exportar KML">
          <Download size={16} />
        </button>
      </div>

      <input ref={importInputRef} type="file" accept=".kml" className="hidden" onChange={handleImportFile} />
    </div>
  );
}
