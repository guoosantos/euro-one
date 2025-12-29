import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Circle as LeafletCircle, CircleMarker, MapContainer, Marker, Polygon, Polyline, TileLayer, Tooltip, useMapEvents } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import {
  Circle as CircleIcon,
  Download,
  Eye,
  FileUp,
  LayoutGrid,
  MousePointer2,
  PanelRight,
  Pencil,
  RefreshCw,
  Save,
  Trash2,
  Undo2,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";

import AddressSearchInput, { useAddressSearchState } from "../components/shared/AddressSearchInput.jsx";
import { useGeofences } from "../lib/hooks/useGeofences.js";
import { downloadKml, geofencesToKml, kmlToGeofences } from "../lib/kml.js";
import { useUI } from "../lib/store.js";
import { useTenant } from "../lib/tenant-context.jsx";
import { resolveMapPreferences } from "../lib/map-config.js";
import Button from "../ui/Button";
import Input from "../ui/Input";

const DEFAULT_CENTER = [-23.55052, -46.633308];
const COLOR_PALETTE = ["#22c55e", "#38bdf8", "#f97316", "#a855f7", "#eab308", "#ef4444"];
const SEARCH_FOCUS_ZOOM = 17;
const MIN_SEARCH_ZOOM = 16;

const clampZoom = (value, maxZoom) => {
  const zoomValue = Number.isFinite(Number(value)) ? Number(value) : SEARCH_FOCUS_ZOOM;
  const safeZoom = Math.max(zoomValue, MIN_SEARCH_ZOOM);
  if (Number.isFinite(Number(maxZoom)) && Number(maxZoom) > 0) {
    return Math.min(safeZoom, Number(maxZoom));
  }
  return safeZoom;
};

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

let localIdCounter = 0;

function generateLocalId(prefix = "local") {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) {
    return `${prefix}-${uuid}`;
  }
  localIdCounter += 1;
  const entropy = `${Date.now()}-${localIdCounter}-${Math.random().toString(16).slice(2)}`;
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

function resolveGeofenceBounds(geo) {
  if (!geo) return null;
  if (geo.type === "circle" && geo.center && geo.radius) {
    return L.circle(geo.center, geo.radius).getBounds();
  }
  if (geo.points?.length) {
    return L.latLngBounds(geo.points.map((point) => L.latLng(point[0], point[1])));
  }
  return null;
}

function ToolbarButton({ icon: Icon, active = false, title, className = "", ...props }) {
  return (
    <button
      type="button"
      className={`map-tool-button ${active ? "is-active" : ""} ${className}`.trim()}
      title={title}
      {...props}
    >
      <Icon size={16} />
    </button>
  );
}

function GeofencePanel({
  open,
  geofences,
  searchTerm,
  onSearch,
  hiddenIds,
  onToggleVisibility,
  onFocus,
  onEdit,
  onDelete,
  onClose,
}) {
  if (!open) return null;

  return (
    <div className="geofence-panel">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-[11px] uppercase tracking-[0.12em] text-white/60">Cercas</p>
          <h2 className="text-base font-semibold text-white">Painel</h2>
        </div>
        <div className="flex items-center gap-1">
          <span className="map-status-pill bg-white/5 text-white/70">{geofences.length} itens</span>
          <ToolbarButton icon={PanelRight} onClick={onClose} title="Recolher painel" />
        </div>
      </div>

      <div className="mt-3 space-y-2">
        <Input
          value={searchTerm}
          onChange={(event) => onSearch(event.target.value)}
          placeholder="Buscar cerca"
          className="map-compact-input"
        />
        <div className="geofence-panel-list">
          {geofences.map((geo) => {
            const visible = !hiddenIds.has(geo.id);
            return (
              <div
                key={geo.id}
                className="geofence-panel-item"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="h-3 w-3 rounded-full" style={{ background: geo.color || "#22c55e" }} />
                    <div>
                      <p className="text-sm font-semibold text-white">{geo.name}</p>
                      <p className="text-[11px] text-white/60">
                        {geo.type === "circle" ? "Círculo" : `${geo.points?.length || 0} vértices`}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      title={visible ? "Ocultar" : "Mostrar"}
                      className={`geofence-chip ${visible ? "is-active" : ""}`}
                      onClick={() => onToggleVisibility(geo.id)}
                    >
                      {visible ? "Visível" : "Oculto"}
                    </button>
                    <ToolbarButton icon={Eye} title="Ver no mapa" onClick={() => onFocus(geo)} />
                    <ToolbarButton icon={Pencil} title="Editar" onClick={() => onEdit(geo)} />
                    <ToolbarButton icon={Trash2} title="Excluir" onClick={() => onDelete(geo)} />
                  </div>
                </div>
              </div>
            );
          })}
          {geofences.length === 0 && <p className="text-xs text-white/60">Nenhuma cerca carregada.</p>}
        </div>
      </div>
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
  const [selectedId, setSelectedId] = useState(null);
  const [hiddenIds, setHiddenIds] = useState(new Set());
  const [saving, setSaving] = useState(false);
  const [uiError, setUiError] = useState(null);
  const [status, setStatus] = useState("");
  const { tenantId, user, tenant } = useTenant();
  const mapPreferences = useMemo(() => resolveMapPreferences(tenant?.attributes), [tenant?.attributes]);
  const addressSearch = useAddressSearchState({ mapPreferences });
  const [geofenceFilter, setGeofenceFilter] = useState("");
  const [panelOpen, setPanelOpen] = useState(true);
  const [layoutMenuOpen, setLayoutMenuOpen] = useState(false);
  const [colorSeed, setColorSeed] = useState(0);
  const geofencesTopbarVisible = useUI((state) => state.geofencesTopbarVisible !== false);
  const setGeofencesTopbarVisible = useUI((state) => state.setGeofencesTopbarVisible);
  const [searchMarker, setSearchMarker] = useState(null);

  const {
    geofences: remoteGeofences,
    loading,
    error: fetchError,
    refresh,
    createGeofence,
    updateGeofence,
    deleteGeofence,
  } = useGeofences({ autoRefreshMs: 0 });

  const [localGeofences, setLocalGeofences] = useState([]);
  const [baselineGeofences, setBaselineGeofences] = useState([]);

  const activeGeofences = useMemo(() => localGeofences, [localGeofences]);

  const selectedGeofence = useMemo(
    () => activeGeofences.find((geo) => geo.id === selectedId) || null,
    [activeGeofences, selectedId],
  );

  const invalidateMapSize = useCallback(() => {
    if (!mapRef.current) return;
    setTimeout(() => {
      if (mapRef.current) {
        mapRef.current.invalidateSize();
      }
    }, 80);
  }, []);

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
    invalidateMapSize();
  }, [invalidateMapSize, panelOpen, geofencesTopbarVisible]);

  useEffect(() => {
    if (hasUnsavedChanges) return;
    setLocalGeofences(remoteGeofences);
    setBaselineGeofences(remoteGeofences);
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
      setLayoutMenuOpen(false);
      const point = [latlng.lat, latlng.lng];
      if (drawMode === "polygon") {
        if (draftPolygon.length >= 3 && distanceBetween(draftPolygon[0], point) < 12) {
          const newId = generateLocalId("local");
          const color = COLOR_PALETTE[(localGeofences.length + colorSeed) % COLOR_PALETTE.length];
          const next = [...draftPolygon];
          setLocalGeofences((current) => [...current, { id: newId, name: `Cerca ${current.length + 1}`, type: "polygon", points: next, color, center: next[0], radius: null }]);
          setColorSeed((value) => value + 1);
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
        const color = COLOR_PALETTE[(localGeofences.length + colorSeed) % COLOR_PALETTE.length];
        setLocalGeofences((current) => [
          ...current,
          { id: newId, name: `Círculo ${current.length + 1}`, type: "circle", center: draftCircle.center, radius: Math.max(25, radius), color, points: [] },
        ]);
        setColorSeed((value) => value + 1);
        setSelectedId(newId);
        setHasUnsavedChanges(true);
        resetDrafts();
        return;
      }

      setSelectedId(null);
    },
    [colorSeed, drawMode, draftCircle.center, draftPolygon, localGeofences.length, resetDrafts],
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

  const handleDeleteGeofence = useCallback(
    async (target = null) => {
      const geofence = target || selectedGeofence;
      if (!geofence) return;
      const confirmed = window.confirm(`Excluir a cerca "${geofence.name}"?`);
      if (!confirmed) return;

      const isLocal = !geofence.id || geofence.id.startsWith("local-") || geofence.id.startsWith("kml-");
      if (isLocal) {
        setLocalGeofences((current) => current.filter((geo) => geo.id !== geofence.id));
        setSelectedId((current) => (current === geofence.id ? null : current));
        setHasUnsavedChanges(true);
        return;
      }

      setSaving(true);
      setUiError(null);
      setStatus("Removendo cerca...");
      try {
        await deleteGeofence(geofence.id);
        setLocalGeofences((current) => current.filter((geo) => geo.id !== geofence.id));
        setBaselineGeofences((current) => current.filter((geo) => geo.id !== geofence.id));
        setSelectedId((current) => (current === geofence.id ? null : current));
        setStatus("Cerca excluída.");
      } catch (error) {
        setUiError(error);
        setStatus(error?.message || "Não foi possível excluir a cerca.");
      } finally {
        setSaving(false);
      }
    },
    [deleteGeofence, selectedGeofence],
  );

  const handleRemoveSelected = useCallback(() => {
    handleDeleteGeofence(selectedGeofence);
  }, [handleDeleteGeofence, selectedGeofence]);

  const draftRadius = useMemo(() => {
    if (!draftCircle.center) return null;
    const target = draftCircle.edge || hoverPoint;
    if (!target) return null;
    return Math.max(10, Math.round(distanceBetween(draftCircle.center, target)));
  }, [draftCircle.center, draftCircle.edge, hoverPoint]);

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
      center: [circle.center[0], circle.center[1]],
      centerLat: circle.center[0],
      centerLng: circle.center[1],
      radius: circle.radius,
    };
  }, []);

  const handleSave = useCallback(async () => {
    setSaving(true);
    setUiError(null);
    setStatus("Sincronizando cercas...");
    try {
      for (const geo of activeGeofences) {
        const clientId = tenantId || user?.clientId || null;
        if (!clientId) {
          throw new Error("Selecione um cliente antes de salvar a cerca.");
        }

        const payload = { ...buildPayload(geo), clientId };
        if (!geo.id || geo.id.startsWith("local-") || geo.id.startsWith("kml-")) {
          await createGeofence(payload);
        } else {
          await updateGeofence(geo.id, payload);
        }
      }

      await refresh();
      setBaselineGeofences(activeGeofences);
      setHasUnsavedChanges(false);
      setStatus("Cercas salvas com sucesso.");
      resetDrafts();
    } catch (error) {
      const message = error?.response?.data?.message || error?.message || "Falha ao salvar cercas.";
      setUiError(error);
      setStatus(message);
    } finally {
      setSaving(false);
    }
  }, [activeGeofences, buildPayload, createGeofence, refresh, resetDrafts, tenantId, updateGeofence, user?.clientId]);

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
          color: item.color || COLOR_PALETTE[(localGeofences.length + colorSeed + index) % COLOR_PALETTE.length],
        };
      });
      setLocalGeofences((current) => [...current, ...mapped]);
      setColorSeed((value) => value + mapped.length);
      setSelectedId((current) => current || mapped[0]?.id || null);
      setHasUnsavedChanges(true);
      event.target.value = "";
    },
    [colorSeed, localGeofences.length],
  );

  const focusMap = useCallback((lat, lng, zoom = SEARCH_FOCUS_ZOOM) => {
    const map = mapRef.current;
    if (!map) return false;
    if (!Number.isFinite(Number(lat)) || !Number.isFinite(Number(lng))) return false;
    const targetZoom = clampZoom(zoom, map.getMaxZoom?.());
    map.stop?.();
    map.setView([Number(lat), Number(lng)], targetZoom, { animate: true });
    return true;
  }, []);

  const focusSearchResult = useCallback(
    (payload = null) => {
      if (!payload) return;

      const lat = Number(payload.lat);
      const lng = Number(payload.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

      console.log("[GEOFENCE_ADDR_SELECT]", { lat, lng, result: payload, t: Date.now() });
      focusMap(lat, lng, payload.zoom);
      setSearchMarker({ lat, lng, label: payload.label || payload.concise || "Local encontrado" });
    },
    [focusMap],
  );

  const handleSelectAddress = useCallback(
    (payload) => {
      if (!payload) return;
      focusSearchResult(payload);
    },
    [focusSearchResult],
  );

  const handleClearSearch = useCallback(() => {
    setSearchMarker(null);
  }, []);

  const handleToggleTopbar = useCallback(() => {
    setGeofencesTopbarVisible(!geofencesTopbarVisible);
    setLayoutMenuOpen(false);
  }, [geofencesTopbarVisible, setGeofencesTopbarVisible]);

  const handleTogglePanel = useCallback(() => {
    setPanelOpen((open) => !open);
    setLayoutMenuOpen(false);
  }, []);

  const handleZoomIn = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    map.zoomIn();
  }, []);

  const handleZoomOut = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    map.zoomOut();
  }, []);

  const focusOnGeofence = useCallback(
    (geo) => {
      if (!geo || !mapRef.current) return;
      const bounds = resolveGeofenceBounds(geo);
      if (bounds) {
        mapRef.current.fitBounds(bounds, { padding: [32, 32] });
      } else if (geo.center) {
        mapRef.current.flyTo(geo.center, Math.max(mapRef.current.getZoom(), 14));
      }
      setSelectedId(geo.id);
    },
    [],
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

  const mapCenter = selectedGeofence?.center || selectedGeofence?.points?.[0] || DEFAULT_CENTER;
  const isBusy = loading || saving;
  const panelGeofences = filteredGeofences;
  const friendlyError = fetchError?.message || null;

  return (
    <div className="map-page">
      <div className="map-container">
        <MapContainer
          center={mapCenter}
          zoom={13}
          scrollWheelZoom
          zoomControl={false}
          className="h-full w-full"
          whenCreated={(map) => {
            mapRef.current = map;
            window.EURO_GEOFENCES_MAP = map;
            window.EURO_GEOFENCES_FOCUS = (lat, lng, zoom = SEARCH_FOCUS_ZOOM) => focusMap(lat, lng, zoom);
            setTimeout(() => map.invalidateSize(), 120);
          }}
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />

        <MapBridge onClick={handleMapClick} onMove={handleMouseMove} />

          {searchMarker && (
            <CircleMarker
              center={[searchMarker.lat, searchMarker.lng]}
              radius={9}
              pathOptions={{ color: "#0ea5e9", fillColor: "#38bdf8", fillOpacity: 0.35, weight: 2 }}
            />
          )}

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
                      const color = COLOR_PALETTE[(localGeofences.length + colorSeed) % COLOR_PALETTE.length];
                      setLocalGeofences((current) => [...current, { id: newId, name: `Cerca ${current.length + 1}`, type: "polygon", points: draftPolygon, color, center: draftPolygon[0], radius: null }]);
                      setColorSeed((value) => value + 1);
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

          {searchMarker && (
            <Marker position={[searchMarker.lat, searchMarker.lng]}>
              <Tooltip direction="top" sticky>
                {searchMarker.label || "Endereço encontrado"}
              </Tooltip>
            </Marker>
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

      <AddressSearchInput
        state={addressSearch}
        onSelect={handleSelectAddress}
        onClear={handleClearSearch}
        floating
      />

      <div className="floating-toolbar">
        <div className="relative">
          <ToolbarButton
            icon={LayoutGrid}
            onClick={() => setLayoutMenuOpen((open) => !open)}
            title="Layout e visibilidade"
            className={layoutMenuOpen ? "is-active" : ""}
          />
          {layoutMenuOpen && (
            <div className="layout-popover">
              <label className="layout-toggle">
                <input type="checkbox" checked={geofencesTopbarVisible} onChange={handleToggleTopbar} />
                <span>Mostrar Topbar</span>
              </label>
              <label className="layout-toggle">
                <input type="checkbox" checked={panelOpen} onChange={handleTogglePanel} />
                <span>Mostrar painel de cercas</span>
              </label>
            </div>
          )}
        </div>
        <ToolbarButton
          icon={MousePointer2}
          active={drawMode === "polygon"}
          onClick={() => startDrawing("polygon")}
          title="Desenhar polígono"
        />
        <ToolbarButton
          icon={CircleIcon}
          active={drawMode === "circle"}
          onClick={() => startDrawing("circle")}
          title="Desenhar círculo"
        />
        {drawMode && (
          <ToolbarButton icon={X} onClick={resetDrafts} title="Encerrar desenho" />
        )}
        <ToolbarButton
          icon={Save}
          className="disabled:cursor-not-allowed disabled:opacity-50"
          onClick={handleSave}
          disabled={!hasUnsavedChanges || isBusy}
          title="Salvar cercas"
        />
        <ToolbarButton
          icon={Undo2}
          className="disabled:cursor-not-allowed disabled:opacity-50"
          onClick={handleCancelChanges}
          disabled={!hasUnsavedChanges}
          title="Cancelar mudanças"
        />
        <ToolbarButton
          icon={RefreshCw}
          onClick={() => refresh()}
          title="Recarregar lista"
        />
        <ToolbarButton
          icon={FileUp}
          onClick={() => importInputRef.current?.click()}
          title="Importar KML"
        />
        <ToolbarButton icon={Download} onClick={handleExport} title="Exportar KML" />
        <ToolbarButton icon={ZoomIn} onClick={handleZoomIn} title="Aproximar mapa" />
        <ToolbarButton icon={ZoomOut} onClick={handleZoomOut} title="Afastar mapa" />
      </div>

      <div className="geofence-status-stack">
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
        {status && <span className="map-status-pill border-primary/40 bg-primary/10 text-cyan-100">{status}</span>}
        {uiError && <span className="map-status-pill border-red-400/60 bg-red-500/10 text-red-100">{uiError.message}</span>}
        {friendlyError && <span className="map-status-pill border-red-400/60 bg-red-500/10 text-red-100">{friendlyError}</span>}
      </div>

      <GeofencePanel
        open={panelOpen}
        geofences={panelGeofences}
        searchTerm={geofenceFilter}
        onSearch={setGeofenceFilter}
        hiddenIds={hiddenIds}
        onToggleVisibility={toggleVisibility}
        onFocus={focusOnGeofence}
        onEdit={(geo) => {
          setSelectedId(geo.id);
          focusOnGeofence(geo);
        }}
        onDelete={handleDeleteGeofence}
        onClose={() => setPanelOpen(false)}
      />

      {selectedGeofence && (
        <div className="geofence-inspector">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-white">{selectedGeofence.name}</p>
            <span className="rounded-full bg-white/10 px-2 py-1 text-[11px] text-white/70">
              {selectedGeofence.type === "circle" ? "Círculo" : "Polígono"}
            </span>
          </div>
          <Input
            label="Nome"
            value={selectedGeofence.name}
            onChange={(event) => handleRenameSelected(event.target.value)}
          />
          <div className="flex items-center justify-between text-xs text-white/70">
            <span>
              {selectedGeofence.type === "circle"
                ? `Raio ${(selectedGeofence.radius || 0).toFixed(0)} m`
                : `${selectedGeofence.points?.length || 0} vértices`}
            </span>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="secondary" onClick={() => markVisible([selectedGeofence.id])}>
                Mostrar
              </Button>
              <Button size="sm" variant="ghost" onClick={() => focusOnGeofence(selectedGeofence)}>
                Centralizar
              </Button>
              <Button size="sm" variant="ghost" onClick={handleRemoveSelected}>
                Remover
              </Button>
            </div>
          </div>
        </div>
      )}

      <input ref={importInputRef} type="file" accept=".kml" className="hidden" onChange={handleImportFile} />
    </div>
  );
}
