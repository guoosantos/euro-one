import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Circle as LeafletCircle, CircleMarker, Marker, Polygon, Polyline, TileLayer, Tooltip, useMapEvents } from "react-leaflet";
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
} from "lucide-react";

import AddressSearchInput, { useAddressSearchState } from "../components/shared/AddressSearchInput.jsx";
import { useGeofences } from "../lib/hooks/useGeofences.js";
import { downloadKml, geofencesToKml, kmlToGeofences } from "../lib/kml.js";
import { useUI } from "../lib/store.js";
import { useTenant } from "../lib/tenant-context.jsx";
import { resolveMapPreferences } from "../lib/map-config.js";
import useMapLifecycle from "../lib/map/useMapLifecycle.js";
import useMapController from "../lib/map/useMapController.js";
import AppMap from "../components/map/AppMap.jsx";
import MapToolbar from "../components/map/MapToolbar.jsx";
import Button from "../ui/Button";
import Input from "../ui/Input";
import Select from "../ui/Select";
import { useConfirmDialog } from "../components/ui/ConfirmDialogProvider.jsx";

const COLOR_PALETTE = ["#22c55e", "#38bdf8", "#f97316", "#a855f7", "#eab308", "#ef4444"];
const DEFAULT_CENTER = [-23.55052, -46.633308];
const DEFAULT_ZOOM = 12;
const DEFAULT_CONFIG = "entry";
const DEFAULT_ACTION = "block";
const TARGET_ACTIONS = ["unlock", "unlink_itinerary"];

function normalizeConfig(value) {
  const normalized = String(value || "").toLowerCase();
  if (["entrada", "entry", "enter", "in"].includes(normalized)) return "entry";
  if (["saida", "saída", "exit", "out"].includes(normalized)) return "exit";
  return null;
}

function deriveActionFromConfig(config) {
  if (config === "exit") return "block";
  return "block";
}

function ensureConfigDefaults(geo) {
  const config = normalizeConfig(geo?.config) || DEFAULT_CONFIG;
  const action = deriveActionFromConfig(config) || DEFAULT_ACTION;
  return { ...geo, config, action };
}

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

function normalizeLatLng(raw) {
  if (!raw) return null;
  if (Array.isArray(raw) && raw.length >= 2) {
    const lat = clampCoordinate(raw[0], -90, 90);
    const lng = clampCoordinate(raw[1], -180, 180);
    if (lat === null || lng === null) return null;
    return [lat, lng];
  }
  if (typeof raw === "string") {
    const [latRaw, lngRaw] = raw.split(",").map((value) => value.trim());
    const lat = clampCoordinate(latRaw, -90, 90);
    const lng = clampCoordinate(lngRaw, -180, 180);
    if (lat === null || lng === null) return null;
    return [lat, lng];
  }
  if (typeof raw === "object") {
    const lat = clampCoordinate(raw.lat ?? raw.latitude, -90, 90);
    const lng = clampCoordinate(raw.lng ?? raw.lon ?? raw.longitude, -180, 180);
    if (lat === null || lng === null) return null;
    return [lat, lng];
  }
  return null;
}

function resolveInitialCenter(attributes) {
  return (
    normalizeLatLng(attributes?.web?.mapCenter) ||
    normalizeLatLng(attributes?.mapCenter) ||
    normalizeLatLng(attributes?.center) ||
    null
  );
}

function resolveInitialZoom(attributes) {
  const raw = attributes?.web?.mapZoom ?? attributes?.mapZoom ?? attributes?.zoom;
  const zoom = Number(raw);
  return Number.isFinite(zoom) && zoom > 0 ? zoom : null;
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
    if (!geofence.center || !geofence.radius) return null;
    const center = geofence.center;
    const radius = geofence.radius;
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
  entityLabelPlural,
  searchPlaceholder,
  emptyText,
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
          <p className="text-[11px] uppercase tracking-[0.12em] text-white/60">{entityLabelPlural}</p>
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
          placeholder={searchPlaceholder}
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
          {geofences.length === 0 && <p className="text-xs text-white/60">{emptyText}</p>}
        </div>
      </div>
    </div>
  );
}

export default function Geofences({ variant = "geofences" }) {
  const isTargetView = variant === "targets";
  const entityLabel = isTargetView ? "Alvo" : "Cerca";
  const entityLabelPlural = isTargetView ? "Alvos" : "Cercas";
  const entityLabelLower = entityLabel.toLowerCase();
  const entityLabelPluralLower = entityLabelPlural.toLowerCase();
  const entityArticle = isTargetView ? "o" : "a";
  const emptyPanelText = isTargetView ? "Nenhum alvo carregado." : "Nenhuma cerca carregada.";
  const searchPlaceholder = `Buscar ${entityLabelLower}`;
  const savedVerb = isTargetView ? "salvos" : "salvas";
  const mapRef = useRef(null);
  const userActionRef = useRef(false);
  const importInputRef = useRef(null);
  const polygonFinalizeRef = useRef(false);
  const [isMapReady, setIsMapReady] = useState(false);
  const [mapInstance, setMapInstance] = useState(null);
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
  const { confirmDelete } = useConfirmDialog();
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
  const { onMapReady, refreshMap } = useMapLifecycle({ mapRef });
  const { registerMap, focusDevice, focusGeometry } = useMapController({ page: isTargetView ? "Targets" : "Geofences" });
  const handleMapReady = useCallback(
    (event) => {
      const map = event?.target || event;
      onMapReady(event);
      registerMap(map);
      setMapInstance(map || null);
      setIsMapReady(true);
    },
    [onMapReady, registerMap],
  );
  const initialCenter = useMemo(
    () => resolveInitialCenter(tenant?.attributes) || DEFAULT_CENTER,
    [tenant?.attributes],
  );
  const initialZoom = useMemo(
    () => resolveInitialZoom(tenant?.attributes) || mapPreferences?.selectZoom || DEFAULT_ZOOM,
    [mapPreferences?.selectZoom, tenant?.attributes],
  );

  const {
    geofences: remoteGeofences,
    loading,
    error: fetchError,
    refresh,
    createGeofence,
    updateGeofence,
    deleteGeofence,
  } = useGeofences({ autoRefreshMs: 0 });

  const scopedGeofences = useMemo(() => {
    const filtered = (Array.isArray(remoteGeofences) ? remoteGeofences : []).filter((geo) =>
      isTargetView ? geo.isTarget : !geo.isTarget,
    );
    return filtered.map((geo) => (isTargetView ? geo : ensureConfigDefaults(geo)));
  }, [isTargetView, remoteGeofences]);

  const [localGeofences, setLocalGeofences] = useState([]);
  const [baselineGeofences, setBaselineGeofences] = useState([]);

  const activeGeofences = useMemo(() => localGeofences, [localGeofences]);

  const selectedGeofence = useMemo(
    () => activeGeofences.find((geo) => geo.id === selectedId) || null,
    [activeGeofences, selectedId],
  );
  const safeSelectedGeofence = useMemo(() => {
    if (!selectedGeofence) return null;
    if (selectedGeofence.type === "circle") {
      const center = selectedGeofence.center || [selectedGeofence.latitude ?? selectedGeofence.lat, selectedGeofence.longitude ?? selectedGeofence.lng];
      const circle = sanitizeCircleGeometry({ center, radius: selectedGeofence.radius });
      if (!circle) return null;
      return { ...selectedGeofence, center: circle.center, radius: circle.radius };
    }
    const points = sanitizePolygon(selectedGeofence.points);
    if (points.length < 3) return null;
    return { ...selectedGeofence, points };
  }, [selectedGeofence]);
  useEffect(() => {
    if (!userActionRef.current) return;
    if (!safeSelectedGeofence) return;
    if (safeSelectedGeofence.type === "circle") {
      const [lat, lng] = safeSelectedGeofence.center || [];
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        focusDevice({ lat, lng }, { zoom: 15, animate: true, reason: "GEOFENCE_SELECT" });
      }
    } else if (safeSelectedGeofence.points?.length) {
      focusGeometry(safeSelectedGeofence.points, { padding: [24, 24], maxZoom: 16 }, "GEOFENCE_SELECT");
    }
    userActionRef.current = false;
  }, [focusDevice, focusGeometry, safeSelectedGeofence]);

  useEffect(() => {
    refreshMap();
  }, [panelOpen, geofencesTopbarVisible, refreshMap]);

  useEffect(() => {
    console.info("[MAP] mounted — neutral state (no center, no zoom)");
  }, []);

  useEffect(() => {
    if (hasUnsavedChanges) return;
    setLocalGeofences(scopedGeofences);
    setBaselineGeofences(scopedGeofences);
    setHiddenIds(new Set());
    setSelectedId((current) => current || scopedGeofences[0]?.id || null);
  }, [scopedGeofences, hasUnsavedChanges]);

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

  const finalizePolygon = useCallback(() => {
    if (polygonFinalizeRef.current || draftPolygon.length < 3) return;
    polygonFinalizeRef.current = true;
    const newId = generateLocalId("local");
    const color = COLOR_PALETTE[(localGeofences.length + colorSeed) % COLOR_PALETTE.length];
    const next = [...draftPolygon];
    setLocalGeofences((current) => [
      ...current,
      ensureConfigDefaults({
        id: newId,
        name: `${entityLabel} ${current.length + 1}`,
        type: "polygon",
        points: next,
        color,
        center: next[0],
        radius: null,
        isTarget: isTargetView,
      }),
    ]);
    setColorSeed((value) => value + 1);
    setSelectedId(newId);
    setHasUnsavedChanges(true);
    resetDrafts();
    setTimeout(() => {
      polygonFinalizeRef.current = false;
    }, 0);
  }, [colorSeed, draftPolygon, localGeofences.length, resetDrafts]);

  const handleMapClick = useCallback(
    (latlng) => {
      setLayoutMenuOpen(false);
      const point = [latlng.lat, latlng.lng];
      if (drawMode === "polygon") {
        if (draftPolygon.length >= 3 && distanceBetween(draftPolygon[0], point) < 12) {
          finalizePolygon();
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
          ensureConfigDefaults({
            id: newId,
            name: `Círculo ${current.length + 1}`,
            type: "circle",
            center: draftCircle.center,
            radius: Math.max(25, radius),
            color,
            points: [],
            isTarget: isTargetView,
          }),
        ]);
        setColorSeed((value) => value + 1);
        setSelectedId(newId);
        setHasUnsavedChanges(true);
        resetDrafts();
        return;
      }

      setSelectedId(null);
    },
    [drawMode, draftCircle.center, draftPolygon, finalizePolygon],
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
      await confirmDelete({
        title: `Excluir ${entityLabelLower}`,
        message: `Excluir ${entityArticle} ${entityLabelLower} "${geofence.name}"? Essa ação não pode ser desfeita.`,
        confirmLabel: "Excluir",
        onConfirm: async () => {
          const isLocal = !geofence.id || geofence.id.startsWith("local-") || geofence.id.startsWith("kml-");
          if (isLocal) {
            setLocalGeofences((current) => current.filter((geo) => geo.id !== geofence.id));
            setSelectedId((current) => (current === geofence.id ? null : current));
            setHasUnsavedChanges(true);
            return;
          }

          setSaving(true);
          setUiError(null);
          setStatus(`Removendo ${entityLabelLower}...`);
          try {
            await deleteGeofence(geofence.id);
            setLocalGeofences((current) => current.filter((geo) => geo.id !== geofence.id));
            setBaselineGeofences((current) => current.filter((geo) => geo.id !== geofence.id));
            setSelectedId((current) => (current === geofence.id ? null : current));
            setStatus(`${entityLabel} ${isTargetView ? "excluído" : "excluída"}.`);
          } catch (error) {
            setUiError(error);
            setStatus(error?.message || `Não foi possível excluir ${entityArticle} ${entityLabelLower}.`);
            throw error;
          } finally {
            setSaving(false);
          }
        },
      });
    },
    [confirmDelete, deleteGeofence, entityArticle, entityLabel, entityLabelLower, isTargetView, selectedGeofence],
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
    const name = String(geo?.name || "").trim();
    if (!name) {
      throw new Error(`Informe um nome para ${entityArticle} ${entityLabelLower}.`);
    }
    const config = normalizeConfig(geo?.config) || DEFAULT_CONFIG;
    const action = deriveActionFromConfig(config) || DEFAULT_ACTION;
    const metadata = isTargetView
      ? { targetActions: TARGET_ACTIONS }
      : { config, action };
    const existingMetadata = geo?.geometryJson?.metadata || geo?.raw?.geometryJson?.metadata || {};
    if (geo.type === "polygon") {
      const sanitized = sanitizePolygon(geo.points);
      if (sanitized.length < 3) {
        throw new Error("Polígono precisa de pelo menos 3 vértices válidos.");
      }
      const geometryJson = {
        ...(geo.geometryJson || {}),
        type: "polygon",
        points: sanitized,
        metadata: { ...existingMetadata, ...metadata },
      };
      return {
        name,
        description: geo.description || "",
        type: geo.type,
        color: geo.color,
        points: sanitized,
        center: null,
        radius: null,
        isTarget: isTargetView,
        geometryJson,
      };
    }

    const circle = sanitizeCircleGeometry(geo);
    if (!circle) {
      throw new Error("Defina centro e raio válidos para o círculo.");
    }
    const geometryJson = {
      ...(geo.geometryJson || {}),
      type: "circle",
      center: [circle.center[0], circle.center[1]],
      radius: circle.radius,
      metadata: { ...existingMetadata, ...metadata },
    };

    return {
      name,
      description: geo.description || "",
      type: geo.type,
      color: geo.color,
      points: [],
      center: [circle.center[0], circle.center[1]],
      centerLat: circle.center[0],
      centerLng: circle.center[1],
      radius: circle.radius,
      isTarget: isTargetView,
      geometryJson,
    };
  }, [entityArticle, entityLabelLower, isTargetView]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    setUiError(null);
    setStatus(`Sincronizando ${entityLabelPluralLower}...`);
    try {
      for (const geo of activeGeofences) {
        const clientId = tenantId || user?.clientId || null;
        if (!clientId) {
          throw new Error(`Selecione um cliente antes de salvar ${entityArticle} ${entityLabelLower}.`);
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
      setStatus(`${entityLabelPlural} ${savedVerb} com sucesso.`);
      resetDrafts();
    } catch (error) {
      const message = error?.response?.data?.message || error?.message || `Falha ao salvar ${entityLabelPluralLower}.`;
      setUiError(error);
      setStatus(message);
    } finally {
      setSaving(false);
    }
  }, [
    activeGeofences,
    buildPayload,
    createGeofence,
    entityArticle,
    entityLabelLower,
    entityLabelPluralLower,
    entityLabelPlural,
    refresh,
    resetDrafts,
    savedVerb,
    tenantId,
    updateGeofence,
    user?.clientId,
  ]);

  const handleExport = useCallback(() => {
    const kml = geofencesToKml(activeGeofences);
    downloadKml(isTargetView ? "targets.kml" : "geofences.kml", kml);
  }, [activeGeofences, isTargetView]);

  const handleImportFile = useCallback(
    async (event) => {
      const file = event.target.files?.[0];
      if (!file) return;
      const text = await file.text();
      const parsed = kmlToGeofences(text);
      const mapped = parsed.map((item, index) => {
        const id = generateLocalId("kml");
        const center = item.center || item.points?.[0] || null;
        return ensureConfigDefaults({
          id,
          name: item.name || `KML ${index + 1}`,
          type: item.type === "circle" ? "circle" : "polygon",
          points: item.points || [],
          center,
          radius: item.radius || null,
          color: item.color || COLOR_PALETTE[(localGeofences.length + colorSeed + index) % COLOR_PALETTE.length],
          isTarget: isTargetView,
        });
      });
      setLocalGeofences((current) => [...current, ...mapped]);
      setColorSeed((value) => value + mapped.length);
      setSelectedId((current) => current || mapped[0]?.id || null);
      setHasUnsavedChanges(true);
      event.target.value = "";
    },
    [colorSeed, localGeofences.length],
  );

  const focusSearchResult = useCallback(
    (payload = null) => {
      if (!payload) return;

      const lat = Number(payload.lat);
      const lng = Number(payload.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
      console.info("[MAP] USER_ADDRESS_SELECT", { lat, lng });
      focusDevice({ lat, lng }, { zoom: 17, animate: true, reason: "ADDRESS_SELECT" });

      setSearchMarker({ lat, lng, label: payload.label || payload.concise || "Local encontrado" });
    },
    [focusDevice],
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

  const focusOnGeofence = useCallback((geo) => {
    if (!geo) return;
    userActionRef.current = true;
    setSelectedId(geo.id);
  }, []);

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
  const safeVisibleGeofences = useMemo(() => {
    return visibleGeofences
      .map((geo) => {
        if (!geo) return null;
        if (geo.type === "circle") {
          const center = geo.center || [geo.latitude ?? geo.lat, geo.longitude ?? geo.lng];
          const circle = sanitizeCircleGeometry({ center, radius: geo.radius });
          if (!circle) return null;
          return { ...geo, center: circle.center, radius: circle.radius };
        }
        const points = sanitizePolygon(geo.points);
        if (points.length < 3) return null;
        return { ...geo, points };
      })
      .filter(Boolean);
  }, [visibleGeofences]);

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
  const panelGeofences = filteredGeofences;
  const friendlyError = fetchError?.message || null;

  return (
    <div className="map-page">
      <div className="map-container">
        <AppMap
          ref={mapRef}
          scrollWheelZoom
          zoomControl={false}
          center={initialCenter}
          zoom={initialZoom}
          invalidateKey={`${panelOpen}-${geofencesTopbarVisible}`}
          whenReady={handleMapReady}
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />

          <MapBridge onClick={handleMapClick} onMove={handleMouseMove} />

          {isMapReady && searchMarker && (
            <CircleMarker
              center={[searchMarker.lat, searchMarker.lng]}
              radius={9}
              pathOptions={{ color: "#0ea5e9", fillColor: "#38bdf8", fillOpacity: 0.35, weight: 2 }}
            />
          )}

          {isMapReady &&
            safeVisibleGeofences.map((geo) => {
            if (geo.type === "circle") {
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

          {isMapReady && drawMode === "polygon" && guideLine.length >= 2 && (
            <Polyline positions={guideLine} pathOptions={{ color: "#22c55e", dashArray: "10 6", weight: 2 }} />
          )}

          {isMapReady &&
            drawMode === "polygon" &&
            draftPolygon.map((point, index) => (
              <CircleMarker
                key={`draft-${index}`}
                center={point}
                radius={5}
                pathOptions={{ color: index === 0 && draftPolygon.length >= 3 ? "#f59e0b" : "#22c55e", weight: 2, fillOpacity: 1 }}
                eventHandlers={{
                  click: (event) => {
                    event.originalEvent?.stopPropagation();
                    if (index === 0 && draftPolygon.length >= 3) {
                      finalizePolygon();
                    }
                  },
                }}
              />
            ))}

          {isMapReady && drawMode === "circle" && draftCircle.center && draftRadius && (
            <LeafletCircle
              center={draftCircle.center}
              radius={draftRadius}
              pathOptions={{ color: "#38bdf8", dashArray: "8 6", weight: 2, fillOpacity: 0.08 }}
            />
          )}

          {isMapReady && searchMarker && (
            <Marker position={[searchMarker.lat, searchMarker.lng]}>
              <Tooltip direction="top" sticky>
                {searchMarker.label || "Endereço encontrado"}
              </Tooltip>
            </Marker>
          )}

          {isMapReady && safeSelectedGeofence && (
            <GeofenceHandles
              geofence={safeSelectedGeofence}
              onUpdatePolygon={(points) => handleUpdatePolygon(safeSelectedGeofence.id, points)}
              onUpdateCircle={(payload) => handleUpdateCircle(safeSelectedGeofence.id, payload)}
            />
          )}
        </AppMap>
      </div>

      <AddressSearchInput
        state={addressSearch}
        onSelect={handleSelectAddress}
        onClear={handleClearSearch}
        floating
      />

      <MapToolbar className="floating-toolbar" map={mapInstance}>
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
                <span>Mostrar painel de {entityLabelPluralLower}</span>
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
          title={`Salvar ${entityLabelPluralLower}`}
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
      </MapToolbar>

      <div className="geofence-status-stack">
        <span className="map-status-pill map-status-pill--emphasis">
          <span className="dot" />
          {activeGeofences.length} {entityLabelPluralLower}
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
        entityLabelPlural={entityLabelPlural}
        searchPlaceholder={searchPlaceholder}
        emptyText={emptyPanelText}
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
          {!isTargetView && (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <label className="text-xs text-white/70">
                <span className="block text-[11px] uppercase tracking-[0.12em] text-white/50">Configuração</span>
                <Select
                  value={normalizeConfig(selectedGeofence.config) || DEFAULT_CONFIG}
                  onChange={(event) => {
                    const config = normalizeConfig(event.target.value) || DEFAULT_CONFIG;
                    setLocalGeofences((current) =>
                      current.map((geo) => (geo.id === selectedGeofence.id ? ensureConfigDefaults({ ...geo, config }) : geo)),
                    );
                    setHasUnsavedChanges(true);
                  }}
                  className="mt-1 w-full"
                >
                  <option value="entry">Entrada</option>
                  <option value="exit">Saída</option>
                </Select>
              </label>
              <label className="text-xs text-white/70">
                <span className="block text-[11px] uppercase tracking-[0.12em] text-white/50">Ação</span>
                <Input
                  value={selectedGeofence.action === "unblock" ? "Desbloquear" : "Bloquear"}
                  readOnly
                  className="mt-1"
                />
              </label>
            </div>
          )}
          {isTargetView && (
            <div className="rounded-xl border border-white/10 bg-white/5 p-3 text-xs text-white/70">
              <p className="text-[11px] uppercase tracking-[0.12em] text-white/50">Ações do alvo</p>
              <ul className="mt-2 list-disc space-y-1 pl-4 text-[12px] text-white/80">
                <li>Desbloquear</li>
                <li>Desvincular itinerário do equipamento</li>
              </ul>
            </div>
          )}
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
          <div className="geofence-inspector-footer flex items-center justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={handleCancelChanges} disabled={!hasUnsavedChanges}>
              Cancelar
            </Button>
            <Button size="sm" onClick={handleSave} disabled={!hasUnsavedChanges || isBusy}>
              {saving ? "Salvando..." : "Salvar"}
            </Button>
          </div>
        </div>
      )}

      <input ref={importInputRef} type="file" accept=".kml" className="hidden" onChange={handleImportFile} />
    </div>
  );
}
