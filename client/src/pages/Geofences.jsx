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

function distanceBetween(a, b) {
  return L.latLng(a[0], a[1]).distanceTo(L.latLng(b[0], b[1]));
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

function FloatingFab({ disabled, saving, onSave, onCancel, onImport, onExport }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="pointer-events-auto relative">
      {open && (
        <div className="absolute bottom-16 right-0 flex flex-col gap-2 rounded-xl border border-white/10 bg-[#0f141c]/90 p-2 shadow-xl backdrop-blur">
          <Button onClick={onSave} disabled={disabled || saving} className="justify-start">
            <Save size={16} className="mr-2" />
            {saving ? "Salvando..." : "Salvar cercas"}
          </Button>
          <Button variant="secondary" onClick={onCancel} className="justify-start">
            <Undo2 size={16} className="mr-2" />
            Cancelar mudanças
          </Button>
          <Button variant="secondary" onClick={onImport} className="justify-start">
            <FileUp size={16} className="mr-2" />
            Importar KML
          </Button>
          <Button variant="ghost" onClick={onExport} className="justify-start">
            <Download size={16} className="mr-2" />
            Exportar KML
          </Button>
        </div>
      )}
      <button
        type="button"
        className="flex h-14 w-14 items-center justify-center rounded-full bg-primary text-black shadow-lg shadow-primary/40 transition hover:-translate-y-1 hover:shadow-xl"
        onClick={() => setOpen((value) => !value)}
        aria-label="Ações rápidas"
      >
        {open ? <X size={22} /> : <Save size={22} />}
      </button>
    </div>
  );
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
  const [saving, setSaving] = useState(false);
  const [uiError, setUiError] = useState(null);
  const [status, setStatus] = useState("");
  const [searchQuery, setSearchQuery] = useState("");

  const {
    geofences: remoteGeofences,
    loading,
    error: fetchError,
    refresh,
    createGeofence,
    updateGeofence,
    deleteGeofence,
  } = useGeofences({ autoRefreshMs: 0 });

  const { suggestions, isSearching, previewSuggestions, searchRegion, clearSuggestions, error: geocodeError } = useGeocodeSearch();

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
          const newId = `local-${Date.now()}`;
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
        const newId = `local-${Date.now()}`;
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

  const handleCancelChanges = useCallback(() => {
    setLocalGeofences(baselineGeofences);
    setDeletedIds(new Set());
    setHasUnsavedChanges(false);
    setStatus("");
    setSelectedId(baselineGeofences[0]?.id || null);
    resetDrafts();
  }, [baselineGeofences, resetDrafts]);

  const buildPayload = useCallback((geo) => {
    return {
      name: geo.name || "Cerca virtual",
      description: geo.description || "",
      type: geo.type,
      color: geo.color,
      points: geo.type === "polygon" ? geo.points : [],
      center: geo.center ? { lat: geo.center[0], lng: geo.center[1] } : null,
      radius: geo.type === "circle" ? geo.radius : null,
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
        const id = `kml-${Date.now()}-${index}`;
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
      previewSuggestions(value);
    },
    [previewSuggestions],
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

  const isBusy = loading || saving;

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-white">Cercas virtuais</h1>
            <p className="text-sm text-white/70">Desenhe polígonos e círculos diretamente no mapa, com importação/exportação KML.</p>
          </div>
          <div className="flex items-center gap-2 text-sm text-white/70">
            {status}
            {uiError && <span className="rounded-lg border border-red-500/50 bg-red-500/10 px-2 py-1 text-xs text-red-200">{uiError.message}</span>}
            {fetchError && <span className="rounded-lg border border-red-500/50 bg-red-500/10 px-2 py-1 text-xs text-red-200">{fetchError.message}</span>}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-white/60">
          <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1">{activeGeofences.length} cercas carregadas</span>
          {hasUnsavedChanges && <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-3 py-1 text-amber-200">Alterações pendentes</span>}
          {drawMode && <span className="rounded-full border border-primary/40 bg-primary/10 px-3 py-1 text-primary">Modo desenho ativo</span>}
        </div>
      </div>

      <div className="relative -mx-2 h-[calc(100vh-220px)] overflow-hidden rounded-2xl border border-white/10 bg-[#0b0f17] shadow-2xl">
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

          {activeGeofences.map((geo) => {
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
                      const newId = `local-${Date.now()}`;
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

        <div className="pointer-events-none absolute inset-0 flex flex-col">
          <div className="pointer-events-auto absolute left-4 top-4 flex flex-wrap gap-2">
            <Button onClick={() => startDrawing("polygon")} variant={drawMode === "polygon" ? "primary" : "secondary"} className="shadow">
              <MousePointer2 size={16} className="mr-2" />
              Desenhar polígono
            </Button>
            <Button onClick={() => startDrawing("circle")} variant={drawMode === "circle" ? "primary" : "secondary"} className="shadow">
              <CircleIcon size={16} className="mr-2" />
              Desenhar círculo
            </Button>
            {drawMode && (
              <Button variant="ghost" onClick={resetDrafts} className="shadow">
                <X size={16} className="mr-2" />
                Encerrar desenho
              </Button>
            )}
          </div>

          <div className="pointer-events-auto absolute left-1/2 top-4 w-full max-w-2xl -translate-x-1/2">
            <form onSubmit={handleSearchSubmit} className="relative">
              <Input
                value={searchQuery}
                onChange={handleSearchChange}
                placeholder="Pesquisar endereço ou cidade"
                icon={Search}
                className="bg-black/70 pr-12 backdrop-blur"
              />
              <div className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-white/70">
                {isSearching ? "Buscando..." : geocodeError?.message || ""}
              </div>
              {suggestions.length > 0 && (
                <div className="absolute z-20 mt-2 w-full overflow-hidden rounded-xl border border-white/10 bg-[#0f141c]/95 backdrop-blur">
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
            </form>
          </div>

          {selectedGeofence && (
            <div className="pointer-events-auto absolute bottom-4 left-4 w-full max-w-md rounded-2xl border border-white/10 bg-[#0f141c]/90 p-4 shadow-lg backdrop-blur">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-xs uppercase tracking-[0.08em] text-white/60">Cerca selecionada</div>
                  <div className="text-lg font-semibold text-white">{selectedGeofence.name}</div>
                  <div className="text-xs text-white/60">
                    {selectedGeofence.type === "circle"
                      ? `Círculo · raio ${(selectedGeofence.radius || 0).toFixed(0)} m`
                      : `Polígono · ${selectedGeofence.points?.length || 0} vértices`}
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" onClick={handleRemoveSelected} variant="ghost">
                    Remover
                  </Button>
                </div>
              </div>
            </div>
          )}

          <div className="pointer-events-auto absolute bottom-4 right-4">
            <FloatingFab
              disabled={!hasUnsavedChanges || isBusy}
              saving={saving}
              onSave={handleSave}
              onCancel={handleCancelChanges}
              onImport={() => importInputRef.current?.click()}
              onExport={handleExport}
            />
          </div>
        </div>
      </div>

      <input ref={importInputRef} type="file" accept=".kml" className="hidden" onChange={handleImportFile} />
    </div>
  );
}
