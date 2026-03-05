import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Circle as LeafletCircle, CircleMarker, Marker, Polygon, Polyline, TileLayer, Tooltip, useMapEvents } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import {
  Circle as CircleIcon,
  Download,
  Eye,
  FileUp,
  LayoutGrid,
  Layers,
  List,
  MousePointer2,
  PanelRight,
  Pencil,
  Save,
  Trash2,
  Undo2,
} from "lucide-react";

import AddressAutocomplete from "../components/AddressAutocomplete.jsx";
import { useGeofences } from "../lib/hooks/useGeofences.js";
import api from "../lib/api.js";
import { API_ROUTES } from "../lib/api-routes.js";
import { downloadKml, geofencesToKml, kmlToGeofences } from "../lib/kml.js";
import { useUI } from "../lib/store.js";
import { useTenant, setStoredMirrorOwnerId } from "../lib/tenant-context.jsx";
import { resolveMapPreferences } from "../lib/map-config.js";
import { resolveMirrorHeaders } from "../lib/mirror-params.js";
import { useTranslation } from "../lib/i18n.js";
import { isAdminGeneralClientName, normalizeAdminClientName } from "../lib/admin-general.js";
import useMapLifecycle from "../lib/map/useMapLifecycle.js";
import useMapController from "../lib/map/useMapController.js";
import { leafletDefaultIcon } from "../lib/map/leaflet-default-icon.js";
import {
  ENABLED_MAP_LAYERS,
  MAP_LAYER_FALLBACK,
  MAP_LAYER_STORAGE_KEYS,
  getValidMapLayer,
} from "../lib/mapLayers.js";
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
const ADMIN_SCOPE_STORAGE_KEY = "euro-one.admin.scope";
const ADMIN_SCOPE_ALL = "all";
const ADMIN_SCOPE_EURO = "euro";
const ADMIN_ALL_OPTION_ID = "all";
const ADMIN_GENERAL_OPTION_ID = "admin-general";

function readAdminScope() {
  if (typeof window === "undefined") return ADMIN_SCOPE_ALL;
  try {
    return window.localStorage?.getItem(ADMIN_SCOPE_STORAGE_KEY) || ADMIN_SCOPE_ALL;
  } catch (_error) {
    return ADMIN_SCOPE_ALL;
  }
}

function persistAdminScope(value) {
  if (typeof window === "undefined") return;
  try {
    if (!value) {
      window.localStorage?.removeItem(ADMIN_SCOPE_STORAGE_KEY);
      return;
    }
    window.localStorage?.setItem(ADMIN_SCOPE_STORAGE_KEY, value);
  } catch (_error) {
    // ignore
  }
}

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

function ToolbarButton({ icon: Icon, active = false, title, className = "", iconSize = 16, ...props }) {
  return (
    <button
      type="button"
      className={`map-tool-button ${active ? "is-active" : ""} ${className}`.trim()}
      title={title}
      {...props}
    >
      <Icon size={iconSize} />
    </button>
  );
}

function SidebarCard({ children, className = "" }) {
  return (
    <div className={`pointer-events-auto rounded-2xl border border-white/10 bg-[#0f141c]/90 p-4 shadow-2xl ${className}`.trim()}>
      {children}
    </div>
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
  clientOptions,
  selectedClientId,
  onClientChange,
  clientContextBadge,
  clientSelectDisabled = false,
  hiddenIds,
  onToggleVisibility,
  onFocus,
  onEdit,
  onDelete,
  canManage,
  onClose,
}) {
  const listRef = useRef(null);
  const scrollRafRef = useRef(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const [rowHeight, setRowHeight] = useState(72);
  const rowGap = 10;
  const rowSize = rowHeight + rowGap;
  const totalItems = geofences.length;

  const handleScroll = useCallback((event) => {
    const nextScrollTop = event.currentTarget.scrollTop;
    if (scrollRafRef.current) return;
    scrollRafRef.current = window.requestAnimationFrame(() => {
      scrollRafRef.current = null;
      setScrollTop(nextScrollTop);
    });
  }, []);

  const measureRow = useCallback(
    (node) => {
      if (!node) return;
      const height = node.getBoundingClientRect?.().height || node.offsetHeight || 0;
      if (height && Math.abs(height - rowHeight) > 1) {
        setRowHeight(height);
      }
    },
    [rowHeight],
  );

  useEffect(() => {
    if (!open) return undefined;
    const container = listRef.current;
    if (!container) return undefined;
    const updateViewport = () => {
      setViewportHeight(container.clientHeight || 0);
    };
    updateViewport();
    window.addEventListener("resize", updateViewport);
    return () => window.removeEventListener("resize", updateViewport);
  }, [open, totalItems]);

  useEffect(() => {
    if (!open) return;
    const container = listRef.current;
    if (!container) return;
    container.scrollTop = 0;
    setScrollTop(0);
  }, [open, searchTerm, totalItems]);

  useEffect(() => {
    return () => {
      if (scrollRafRef.current) {
        window.cancelAnimationFrame(scrollRafRef.current);
        scrollRafRef.current = null;
      }
    };
  }, []);

  if (!open) return null;

  const overscan = 6;
  const canVirtualize = totalItems > 80 && rowSize > 0 && viewportHeight > 0;
  const startIndex = canVirtualize
    ? Math.max(0, Math.floor(scrollTop / rowSize) - overscan)
    : 0;
  const endIndex = canVirtualize
    ? Math.min(totalItems - 1, Math.ceil((scrollTop + viewportHeight) / rowSize) + overscan)
    : Math.max(0, totalItems - 1);
  const visibleItems = canVirtualize ? geofences.slice(startIndex, endIndex + 1) : geofences;
  const paddingTop = canVirtualize ? startIndex * rowSize : 0;
  const paddingBottom = canVirtualize ? Math.max(0, (totalItems - endIndex - 1) * rowSize) : 0;

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
        {(Array.isArray(clientOptions) && clientOptions.length > 0) || clientContextBadge ? (
          <div className="space-y-2">
            {Array.isArray(clientOptions) && clientOptions.length > 0 ? (
              <div>
                <p className="text-[11px] uppercase tracking-[0.12em] text-white/60">Cliente</p>
                <Select
                  value={selectedClientId ?? ""}
                  onChange={(event) => onClientChange?.(event.target.value)}
                  disabled={clientSelectDisabled}
                  className="map-compact-input mt-1"
                >
                  {clientOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </Select>
              </div>
            ) : null}
            {clientContextBadge && (
              <span className="map-status-pill bg-white/5 text-white/70">{clientContextBadge}</span>
            )}
          </div>
        ) : null}
        <Input
          value={searchTerm}
          onChange={(event) => onSearch(event.target.value)}
          placeholder={searchPlaceholder}
          className="map-compact-input"
        />
        <div
          ref={listRef}
          className="geofence-panel-list"
          onScroll={handleScroll}
          style={{ paddingTop, paddingBottom }}
        >
          {visibleItems.map((geo, index) => {
            const visible = !hiddenIds.has(geo.id);
            const needsMeasure = index === 0 && canVirtualize;
            return (
              <div
                key={geo.id}
                className="geofence-panel-item"
                ref={needsMeasure ? measureRow : null}
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
                    <ToolbarButton
                      icon={Pencil}
                      title={canManage ? "Editar" : "Selecione um cliente para editar"}
                      onClick={() => onEdit(geo)}
                      disabled={!canManage}
                    />
                    <ToolbarButton
                      icon={Trash2}
                      title={canManage ? "Excluir" : "Selecione um cliente para excluir"}
                      onClick={() => onDelete(geo)}
                      disabled={!canManage}
                    />
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
  const navigate = useNavigate();
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
  const [viewMode, setViewMode] = useState("default");
  const [hiddenIds, setHiddenIds] = useState(new Set());
  const [saving, setSaving] = useState(false);
  const [uiError, setUiError] = useState(null);
  const [status, setStatus] = useState("");
  const { confirmDelete } = useConfirmDialog();
  const { t } = useTranslation();
  const {
    tenantId,
    user,
    tenant,
    tenants,
    switchClientAndReset,
    hasAdminAccess,
    canSwitchTenant,
    homeClientId,
    homeClient,
    mirrorContextMode,
    mirrorModeEnabled,
    activeMirror,
    activeMirrorOwnerClientId,
    mirrorOwners,
    isMirrorReceiver,
    contextSwitching,
  } = useTenant();
  const [adminScope, setAdminScope] = useState(() => readAdminScope());
  const mirrorOwnerClientId = activeMirror?.ownerClientId ?? activeMirrorOwnerClientId;
  const isMirrorTarget = mirrorContextMode === "target";
  const mirrorAllSelected = isMirrorTarget && String(mirrorOwnerClientId ?? "") === "all";
  const mirrorSelectedClientId =
    isMirrorTarget && !mirrorAllSelected && mirrorOwnerClientId
      ? String(mirrorOwnerClientId)
      : null;
  const mirrorOwnerIds = useMemo(() => {
    if (!Array.isArray(mirrorOwners)) return new Set();
    return new Set(mirrorOwners.map((owner) => String(owner.id)));
  }, [mirrorOwners]);
  const isMirrorSelectable = isMirrorReceiver && Array.isArray(mirrorOwners) && mirrorOwners.length > 0;
  const selectValueRaw = mirrorContextMode === "target"
    ? (activeMirrorOwnerClientId
        ? String(activeMirrorOwnerClientId)
        : (isMirrorSelectable ? "all" : String(homeClientId ?? tenantId ?? "")))
    : String(tenantId ?? "");
  const adminGeneralOption = useMemo(() => {
    if (!hasAdminAccess) return null;
    const candidate = homeClient && isAdminGeneralClientName(homeClient?.name) ? homeClient : null;
    if (!candidate) return null;
    return {
      value: ADMIN_GENERAL_OPTION_ID,
      label: normalizeAdminClientName(candidate.name) || "EURO ONE",
    };
  }, [hasAdminAccess, homeClient]);
  const selectValue = useMemo(() => {
    if (!hasAdminAccess) return selectValueRaw;
    if (tenantId !== null && tenantId !== undefined && String(tenantId) !== "") {
      return String(tenantId);
    }
    if (adminScope === ADMIN_SCOPE_EURO && adminGeneralOption) {
      return ADMIN_GENERAL_OPTION_ID;
    }
    return ADMIN_ALL_OPTION_ID;
  }, [adminGeneralOption, adminScope, hasAdminAccess, selectValueRaw, tenantId]);
  const ownedTenants = useMemo(() => {
    if (hasAdminAccess) return [];
    let base = tenants.filter((item) => !mirrorOwnerIds.has(String(item.id)));
    if (homeClient && homeClientId && !base.some((item) => String(item.id) === String(homeClientId))) {
      base = [homeClient, ...base];
    }
    if (isMirrorSelectable && homeClientId) {
      base = base.filter((item) => String(item.id) !== String(homeClientId));
    }
    return base;
  }, [hasAdminAccess, homeClient, homeClientId, isMirrorSelectable, mirrorOwnerIds, tenants]);
  const mirroredTenants = useMemo(() => {
    if (hasAdminAccess) return [];
    return Array.isArray(mirrorOwners) ? mirrorOwners : [];
  }, [hasAdminAccess, mirrorOwners]);
  const allClientsLabel = t("topbar.allClients") || "Todos os clientes";
  const mirrorAllLabel = t("topbar.mirrorAll") || "Todos os espelhados";
  const mirroredSuffix = t("topbar.mirroredSuffix") || "espelhado";
  const tenantOptions = useMemo(() => {
    if (hasAdminAccess) {
      const options = [{ value: ADMIN_ALL_OPTION_ID, label: allClientsLabel }];
      if (adminGeneralOption) {
        options.push(adminGeneralOption);
      }
      options.push(...tenants.map((item) => ({ value: String(item.id ?? ""), label: item.name })));
      return options;
    }
    const options = [];
    if (ownedTenants.length > 0) {
      options.push(...ownedTenants.map((item) => ({ value: String(item.id ?? ""), label: item.name })));
    }
    if (isMirrorSelectable && mirroredTenants.length > 0) {
      options.push({ value: "all", label: mirrorAllLabel });
      options.push(
        ...mirroredTenants.map((item) => ({
          value: String(item.id ?? ""),
          label: `${item.name} (${mirroredSuffix})`,
        })),
      );
    }
    return options;
  }, [
    adminGeneralOption,
    allClientsLabel,
    hasAdminAccess,
    isMirrorSelectable,
    mirrorAllLabel,
    mirroredSuffix,
    mirroredTenants,
    ownedTenants,
    tenants,
  ]);
  const clientOptions = useMemo(
    () =>
      tenantOptions
        .map((option) => ({
          value: String(option.value ?? ""),
          label: option.label || String(option.value ?? ""),
        }))
        .filter((option) => option.value),
    [tenantOptions],
  );
  const selectedClientId = selectValue;
  const showClientSelect = canSwitchTenant && clientOptions.length > 1;
  const mirrorHeaders = useMemo(
    () => resolveMirrorHeaders({ mirrorModeEnabled, mirrorOwnerClientId }),
    [mirrorModeEnabled, mirrorOwnerClientId],
  );
  const mirrorAllHeaders = useMemo(
    () =>
      mirrorAllSelected
        ? resolveMirrorHeaders({ mirrorModeEnabled, mirrorOwnerClientId: "all", mirrorContextMode: "target" })
        : undefined,
    [mirrorAllSelected, mirrorModeEnabled],
  );
  const geofenceParams = useMemo(() => {
    const base = { isTarget: isTargetView ? "true" : "false" };
    if (mirrorAllSelected) {
      base.lite = "true";
    }
    return base;
  }, [isTargetView, mirrorAllSelected]);
  const handleClientChange = useCallback((nextValue) => {
    const nextId = nextValue || null;
    if (hasAdminAccess) {
      if (nextId === ADMIN_ALL_OPTION_ID) {
        setAdminScope(ADMIN_SCOPE_ALL);
        persistAdminScope(ADMIN_SCOPE_ALL);
        setStoredMirrorOwnerId(null);
        switchClientAndReset({
          nextTenantId: null,
          nextOwnerClientId: null,
          nextMirrorMode: "self",
        });
        return;
      }
      if (nextId === ADMIN_GENERAL_OPTION_ID) {
        setAdminScope(ADMIN_SCOPE_EURO);
        persistAdminScope(ADMIN_SCOPE_EURO);
        setStoredMirrorOwnerId(null);
        switchClientAndReset({
          nextTenantId: homeClientId ?? null,
          nextOwnerClientId: null,
          nextMirrorMode: "self",
        });
        return;
      }
      setAdminScope(ADMIN_SCOPE_ALL);
      persistAdminScope(ADMIN_SCOPE_ALL);
      setStoredMirrorOwnerId(null);
      switchClientAndReset({
        nextTenantId: nextId,
        nextOwnerClientId: null,
        nextMirrorMode: "self",
      });
      return;
    }
    if (isMirrorSelectable) {
      if (nextId === "all") {
        setStoredMirrorOwnerId("all");
        switchClientAndReset({
          nextTenantId: homeClientId ?? tenantId,
          nextOwnerClientId: "all",
          nextMirrorMode: "target",
        });
        return;
      }
      if (!nextId || String(nextId) === String(homeClientId ?? "")) {
        switchClientAndReset({
          nextTenantId: nextId,
          nextOwnerClientId: null,
          nextMirrorMode: "self",
        });
        return;
      }
      if (mirrorOwnerIds.has(String(nextId))) {
        setStoredMirrorOwnerId(String(nextId));
        switchClientAndReset({
          nextTenantId: nextId,
          nextOwnerClientId: String(nextId),
          nextMirrorMode: "target",
        });
        return;
      }
      switchClientAndReset({
        nextTenantId: nextId,
        nextOwnerClientId: null,
        nextMirrorMode: "self",
      });
      return;
    }
    switchClientAndReset({ nextTenantId: nextId, nextOwnerClientId: null });
  }, [
    hasAdminAccess,
    homeClientId,
    isMirrorSelectable,
    mirrorOwnerIds,
    switchClientAndReset,
    tenantId,
  ]);
  useEffect(() => {
    if (!hasAdminAccess) return;
    setAdminScope(readAdminScope());
  }, [hasAdminAccess, tenantId]);
  const resolvedClientId = useMemo(() => {
    if (isMirrorTarget) {
      if (mirrorAllSelected) return null;
      return mirrorSelectedClientId || null;
    }
    if (hasAdminAccess && selectedClientId === ADMIN_ALL_OPTION_ID) return null;
    return tenantId || user?.clientId || null;
  }, [hasAdminAccess, isMirrorTarget, mirrorAllSelected, mirrorSelectedClientId, selectedClientId, tenantId, user?.clientId]);
  const mirrorOwnerClientIds = useMemo(
    () => (Array.isArray(mirrorOwners) ? mirrorOwners.map((entry) => String(entry.id)).filter(Boolean) : []),
    [mirrorOwners],
  );
  const shouldWaitForMirror = mirrorAllSelected && !mirrorAllHeaders;
  const isAdminAllSelected = hasAdminAccess && selectedClientId === ADMIN_ALL_OPTION_ID;
  const canManageGeofences = !isAdminAllSelected;
  const clientContextBadge = useMemo(() => {
    if (isMirrorTarget) {
      if (mirrorAllSelected) return null;
      const ownerName = mirrorOwners?.find((entry) => String(entry.id) === String(mirrorSelectedClientId))?.name;
      const label = ownerName || mirrorSelectedClientId;
      return label ? `Cliente: ${label}` : null;
    }
    if (hasAdminAccess && selectedClientId === ADMIN_ALL_OPTION_ID) {
      return "Visualizando: TODOS";
    }
    const match = clientOptions.find((option) => option.value === String(selectedClientId ?? ""));
    if (match?.label) return `Cliente: ${match.label}`;
    const fixedLabel = tenant?.name || user?.clientName || user?.clientId || tenantId || null;
    return fixedLabel ? `Cliente: ${fixedLabel}` : null;
  }, [
    clientOptions,
    hasAdminAccess,
    isMirrorTarget,
    mirrorAllSelected,
    mirrorOwners,
    mirrorSelectedClientId,
    selectedClientId,
    tenant?.name,
    tenantId,
    user?.clientId,
    user?.clientName,
  ]);
  const mapPreferences = useMemo(() => resolveMapPreferences(tenant?.attributes), [tenant?.attributes]);
  const [mapLayerKey, setMapLayerKey] = useState(() => getValidMapLayer());
  const [mapLayerMenuOpen, setMapLayerMenuOpen] = useState(false);
  const mapLayerButtonRef = useRef(null);
  const mapLayerStorageKey = isTargetView ? MAP_LAYER_STORAGE_KEYS.targets : MAP_LAYER_STORAGE_KEYS.geofences;
  const mapLayer = useMemo(
    () => ENABLED_MAP_LAYERS.find((layer) => layer.key === mapLayerKey) || MAP_LAYER_FALLBACK,
    [mapLayerKey],
  );
  const tileUrl = mapLayer?.url || "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
  const tileAttribution =
    mapLayer?.attribution || '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';
  const tileSubdomains = mapLayer?.subdomains ?? "abc";
  const tileMaxZoom = mapLayer?.maxZoom;
  const [addressValue, setAddressValue] = useState({ formattedAddress: "" });
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

  const mapLayerOptions = useMemo(() => {
    const candidates = ENABLED_MAP_LAYERS.filter((layer) => layer?.url);
    const pickedKeys = new Set();
    const pick = (keys) =>
      candidates.find((layer) => keys.some((key) => layer.key.includes(key))) || null;

    const options = [
      { id: "satellite", label: "Satélite", layer: pick(["google-satellite", "satellite", "hybrid", "google-hybrid"]) },
      { id: "streets", label: "Ruas / Padrão", layer: pick(["google-road", "openstreetmap", "osm", "carto-light"]) },
      { id: "terrain", label: "Terreno", layer: pick(["opentopomap", "topo", "terrain"]) },
      { id: "dark", label: "Escuro", layer: pick(["carto-dark", "dark"]) },
    ]
      .filter((item) => item.layer)
      .filter((item) => {
        if (!item.layer) return false;
        if (pickedKeys.has(item.layer.key)) return false;
        pickedKeys.add(item.layer.key);
        return true;
      });

    if (!options.length && candidates.length) {
      return candidates.slice(0, 5).map((layer) => ({ id: layer.key, label: layer.label, layer }));
    }

    return options;
  }, []);

  useEffect(() => {
    try {
      const storedLayer = localStorage.getItem(mapLayerStorageKey);
      setMapLayerKey(getValidMapLayer(storedLayer));
    } catch (_error) {
      // ignore
    }
  }, [mapLayerStorageKey]);

  useEffect(() => {
    try {
      localStorage.setItem(mapLayerStorageKey, mapLayerKey);
    } catch (_error) {
      // ignore
    }
  }, [mapLayerKey, mapLayerStorageKey]);

  useEffect(() => {
    if (!mapLayerMenuOpen) return;
    const handleClick = (event) => {
      if (!mapLayerButtonRef.current) return;
      if (mapLayerButtonRef.current.contains(event.target)) return;
      setMapLayerMenuOpen(false);
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [mapLayerMenuOpen]);

  const {
    geofences: remoteGeofences,
    loading,
    error: fetchError,
    refresh,
    createGeofence,
    updateGeofence,
    deleteGeofence,
  } = useGeofences({
    autoRefreshMs: 0,
    enabled: !shouldWaitForMirror,
    clientId: mirrorAllSelected ? null : resolvedClientId,
    params: geofenceParams,
    headers: mirrorAllSelected ? mirrorAllHeaders : mirrorHeaders,
    resolveHeadersForClient: mirrorAllSelected
      ? (clientId) => resolveMirrorHeaders({ mirrorModeEnabled, mirrorOwnerClientId: clientId })
      : undefined,
  });
  const accessDenied = Number(fetchError?.status) === 403;

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
  const fetchDetailsRef = useRef(new Set());
  const needsGeofenceDetails = useCallback((geo) => {
    if (!geo || !geo.id) return false;
    if (geo.type === "circle") return false;
    return !Array.isArray(geo.points) || geo.points.length < 3;
  }, []);
  const applyGeofenceDetails = useCallback((details) => {
    if (!details?.id) return;
    const id = String(details.id);
    setLocalGeofences((current) =>
      current.map((geo) => (String(geo.id) === id ? { ...geo, ...details } : geo)),
    );
    setBaselineGeofences((current) =>
      current.map((geo) => (String(geo.id) === id ? { ...geo, ...details } : geo)),
    );
  }, []);
  const fetchGeofenceDetails = useCallback(
    async (geo) => {
      if (!geo?.id) return null;
      const id = String(geo.id);
      if (fetchDetailsRef.current.has(id)) return geo;
      fetchDetailsRef.current.add(id);
      try {
        const detailHeaders = geo.clientId
          ? resolveMirrorHeaders({
              mirrorModeEnabled,
              mirrorOwnerClientId: geo.clientId,
              mirrorContextMode: "target",
            })
          : mirrorHeaders;
        const response = await api.get(`${API_ROUTES.geofences}/${geo.id}`, detailHeaders ? { headers: detailHeaders } : undefined);
        const payload = response?.data?.geofence || response?.data || null;
        if (!payload) return geo;
        const normalized = isTargetView ? payload : ensureConfigDefaults(payload);
        applyGeofenceDetails(normalized);
        return normalized;
      } catch (_error) {
        return geo;
      } finally {
        fetchDetailsRef.current.delete(id);
      }
    },
    [applyGeofenceDetails, isTargetView, mirrorHeaders, mirrorModeEnabled],
  );
  const ensureGeofenceDetails = useCallback(
    async (geo) => {
      if (!needsGeofenceDetails(geo)) return geo;
      return fetchGeofenceDetails(geo);
    },
    [fetchGeofenceDetails, needsGeofenceDetails],
  );
  const canEditSelected = viewMode === "editing" || viewMode === "creating";
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
    const nextSelected =
      selectedId && scopedGeofences.some((geo) => geo.id === selectedId) ? selectedId : null;
    setSelectedId(nextSelected);
    if (!nextSelected) {
      setViewMode("default");
    } else if (viewMode === "default") {
      setViewMode("viewing");
    }
  }, [hasUnsavedChanges, scopedGeofences, selectedId, viewMode]);

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
    setSelectedId(null);
    setViewMode("creating");
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
    setViewMode("creating");
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
        setViewMode("creating");
        setHasUnsavedChanges(true);
        resetDrafts();
        return;
      }

      setSelectedId(null);
      setViewMode("default");
    },
    [drawMode, draftCircle.center, draftPolygon, finalizePolygon],
  );

  const handleMouseMove = useCallback(
    (latlng) => {
      if (!drawMode) return;
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
      if (!canEditSelected) return;
      setLocalGeofences((current) =>
        current.map((geo) => (geo.id === id ? { ...geo, points: nextPoints, center: nextPoints[0] } : geo)),
      );
      setHasUnsavedChanges(true);
    },
    [canEditSelected],
  );

  const handleUpdateCircle = useCallback(
    (id, payload) => {
      if (!canEditSelected) return;
      setLocalGeofences((current) =>
        current.map((geo) => (geo.id === id ? { ...geo, ...payload, points: [] } : geo)),
      );
      setHasUnsavedChanges(true);
    },
    [canEditSelected],
  );

  const handleDeleteGeofence = useCallback(
    async (target = null) => {
      const geofence = target || selectedGeofence;
      if (!geofence) return;
      await confirmDelete({
        title: `Excluir ${entityLabel}`,
        message: `Tem certeza que deseja excluir ${entityArticle} ${entityLabelLower} "${geofence.name}"? Essa ação não pode ser desfeita.`,
        confirmLabel: "Excluir",
        onConfirm: async () => {
          const isLocal = !geofence.id || geofence.id.startsWith("local-") || geofence.id.startsWith("kml-");
          if (isLocal) {
            setLocalGeofences((current) => current.filter((geo) => geo.id !== geofence.id));
            setSelectedId((current) => (current === geofence.id ? null : current));
            setViewMode((current) => (current === "editing" || current === "creating" ? "default" : current));
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
            setViewMode("default");
            await refresh();
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
    [confirmDelete, deleteGeofence, entityArticle, entityLabel, entityLabelLower, isTargetView, refresh, selectedGeofence],
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
      if (!selectedId || !canEditSelected) return;
      setLocalGeofences((current) => current.map((geo) => (geo.id === selectedId ? { ...geo, name: value } : geo)));
      setHasUnsavedChanges(true);
    },
    [canEditSelected, selectedId],
  );

  const handleCancelChanges = useCallback(() => {
    setLocalGeofences(baselineGeofences);
    setHiddenIds(new Set());
    setHasUnsavedChanges(false);
    setStatus("");
    setSelectedId((current) => {
      const keep = baselineGeofences.some((geo) => geo.id === current);
      return keep ? current : null;
    });
    resetDrafts();
    setViewMode((current) => (current === "editing" || current === "creating" ? "viewing" : current));
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
      if (isAdminAllSelected) {
        throw new Error(`Selecione um cliente específico antes de salvar ${entityLabelPluralLower}.`);
      }
      for (const geo of activeGeofences) {
        const isNew = !geo.id || geo.id.startsWith("local-") || geo.id.startsWith("kml-");
        const clientId = resolvedClientId || tenantId || user?.clientId || null;

        const payload = buildPayload(geo);
        if (isNew) {
          if (mirrorAllSelected) {
            if (mirrorOwnerClientIds.length === 0) {
              throw new Error(`Nenhum cliente espelhado disponível para salvar ${entityLabelPluralLower}.`);
            }
            await Promise.all(
              mirrorOwnerClientIds.map((ownerId) => createGeofence({ ...payload, clientId: ownerId })),
            );
          } else {
            if (!clientId) {
              throw new Error(`Selecione um cliente antes de salvar ${entityArticle} ${entityLabelLower}.`);
            }
            await createGeofence({ ...payload, clientId });
          }
        } else {
          const clientId = geo.clientId || resolvedClientId || tenantId || user?.clientId || null;
          if (!clientId) {
            throw new Error(`Selecione um cliente antes de salvar ${entityArticle} ${entityLabelLower}.`);
          }
          await updateGeofence(geo.id, { ...payload, clientId });
        }
      }

      await refresh();
      setBaselineGeofences(activeGeofences);
      setHasUnsavedChanges(false);
      setStatus(`${entityLabelPlural} ${savedVerb} com sucesso.`);
      resetDrafts();
      setSelectedId(null);
      setViewMode("default");
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
    isAdminAllSelected,
    mirrorAllSelected,
    mirrorOwnerClientIds,
    refresh,
    resetDrafts,
    savedVerb,
    tenantId,
    resolvedClientId,
    setViewMode,
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

      setSearchMarker({ lat, lng, label: payload.formattedAddress || payload.label || "Local encontrado" });
    },
    [focusDevice],
  );

  const handleAddressChange = useCallback((value) => {
    setAddressValue(value || { formattedAddress: "" });
  }, []);

  const handleSelectAddress = useCallback(
    (payload) => {
      if (!payload) return;
      setAddressValue(payload);
      focusSearchResult(payload);
    },
    [focusSearchResult],
  );

  const handleClearSearch = useCallback(() => {
    setAddressValue({ formattedAddress: "" });
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

  const centerGeofence = useCallback(
    (geo) => {
      if (!geo) return;
      if (geo.type === "circle") {
        const center = geo.center || [geo.latitude ?? geo.lat, geo.longitude ?? geo.lng];
        const circle = sanitizeCircleGeometry({ center, radius: geo.radius });
        if (!circle) return;
        const [lat, lng] = circle.center || [];
        if (Number.isFinite(lat) && Number.isFinite(lng)) {
          focusDevice({ lat, lng }, { zoom: 15, animate: true, reason: "GEOFENCE_SELECT" });
        }
        return;
      }
      const points = sanitizePolygon(geo.points);
      if (!points.length) return;
      focusGeometry(points, { padding: [24, 24], maxZoom: 16 }, "GEOFENCE_SELECT");
    },
    [focusDevice, focusGeometry],
  );

  const focusOnGeofence = useCallback(
    async (geo) => {
      if (!geo) return;
      const resolved = await ensureGeofenceDetails(geo);
      if (!resolved) return;
      resetDrafts();
      setSelectedId(resolved.id);
      setViewMode("viewing");
      centerGeofence(resolved);
    },
    [centerGeofence, ensureGeofenceDetails, resetDrafts],
  );
  const handleEditGeofence = useCallback(
    async (geo) => {
      if (!geo) return;
      const resolved = await ensureGeofenceDetails(geo);
      if (!resolved) return;
      resetDrafts();
      setSelectedId(resolved.id);
      setViewMode("editing");
      centerGeofence(resolved);
    },
    [centerGeofence, ensureGeofenceDetails, resetDrafts],
  );

  const guideLine = useMemo(() => {
    if (drawMode !== "polygon") return [];
    const points = [...draftPolygon];
    if (hoverPoint) points.push(hoverPoint);
    return points;
  }, [drawMode, draftPolygon, hoverPoint]);

  const mapGeofences = useMemo(
    () => {
      if (!selectedId || !safeSelectedGeofence) return [];
      if (hiddenIds.has(selectedId)) return [];
      return [safeSelectedGeofence];
    },
    [hiddenIds, safeSelectedGeofence, selectedId],
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

  if (accessDenied) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center px-4 py-10">
        <div className="w-full max-w-xl rounded-2xl border border-white/10 bg-white/5 p-6 text-white">
          <h2 className="text-lg font-semibold">Sem acesso a este módulo</h2>
          <p className="mt-2 text-sm text-white/60">
            {fetchError?.message || "Você não tem acesso a este conteúdo no cliente atual."}
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Button size="sm" variant="secondary" onClick={() => navigate(-1)}>
              Voltar
            </Button>
            <Button size="sm" onClick={() => navigate("/home")}>
              Trocar cliente
            </Button>
          </div>
        </div>
      </div>
    );
  }

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
            attribution={tileAttribution}
            url={tileUrl}
            subdomains={tileSubdomains}
            maxZoom={tileMaxZoom}
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
            mapGeofences.map((geo) => {
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
                      setViewMode("viewing");
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
                    setViewMode("viewing");
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
            <Marker position={[searchMarker.lat, searchMarker.lng]} icon={leafletDefaultIcon}>
              <Tooltip direction="top" sticky>
                {searchMarker.label || "Endereço encontrado"}
              </Tooltip>
            </Marker>
          )}

          {isMapReady && safeSelectedGeofence && canEditSelected && (
            <GeofenceHandles
              geofence={safeSelectedGeofence}
              onUpdatePolygon={(points) => handleUpdatePolygon(safeSelectedGeofence.id, points)}
              onUpdateCircle={(payload) => handleUpdateCircle(safeSelectedGeofence.id, payload)}
            />
          )}
        </AppMap>
      </div>

      <div className="pointer-events-none absolute inset-0 z-20">
        <div className="pointer-events-auto absolute left-4 top-4 flex w-fit max-w-[calc(100vw-2rem)] max-h-[calc(100vh-2rem)] flex-col items-start gap-3 overflow-y-auto pr-1">
          <SidebarCard className="w-[640px] max-w-[calc(100vw-2rem)] md:w-[680px] lg:w-[720px]">
            <div className="flex flex-nowrap items-center gap-3 overflow-x-auto pb-1">
              <div className="flex min-w-[280px] flex-1 items-center gap-2">
                <AddressAutocomplete
                  label={null}
                  value={addressValue}
                  onChange={handleAddressChange}
                  onSelect={handleSelectAddress}
                  onClear={handleClearSearch}
                  variant="toolbar"
                  portalSuggestions
                  containerClassName="flex-1 min-w-0"
                  placeholder="Buscar endereço"
                  mapPreferences={mapPreferences}
                />
                <div className="flex shrink-0 items-center gap-1">
                  <ToolbarButton
                    icon={List}
                    title="Minhas Cercas"
                    iconSize={18}
                    active={panelOpen}
                    onClick={handleTogglePanel}
                  />
                  <ToolbarButton
                    icon={MousePointer2}
                    title="Desenhar polígono"
                    iconSize={18}
                    active={drawMode === "polygon"}
                    onClick={() => (drawMode === "polygon" ? resetDrafts() : startDrawing("polygon"))}
                    disabled={isAdminAllSelected}
                  />
                  <ToolbarButton
                    icon={CircleIcon}
                    title="Desenhar círculo"
                    iconSize={18}
                    active={drawMode === "circle"}
                    onClick={() => (drawMode === "circle" ? resetDrafts() : startDrawing("circle"))}
                    disabled={isAdminAllSelected}
                  />
                </div>
              </div>
              <div className="flex min-w-max shrink-0 items-center gap-2">
                <ToolbarButton
                  icon={FileUp}
                  title="Importar KML"
                  iconSize={18}
                  onClick={() => importInputRef.current?.click()}
                  disabled={isAdminAllSelected}
                />
                <ToolbarButton icon={Download} title="Exportar KML" iconSize={18} onClick={handleExport} />
                <ToolbarButton
                  icon={Save}
                  title={isAdminAllSelected ? "Selecione um cliente para salvar" : "Salvar Cerca"}
                  iconSize={18}
                  onClick={handleSave}
                  disabled={!hasUnsavedChanges || isBusy || isAdminAllSelected}
                />
                <ToolbarButton
                  icon={Undo2}
                  title="Cancelar alterações"
                  iconSize={18}
                  onClick={handleCancelChanges}
                  disabled={!hasUnsavedChanges}
                />
              </div>
            </div>
          </SidebarCard>
        </div>

        <MapToolbar
          className="floating-toolbar pointer-events-auto"
          map={mapInstance}
          zoomControls={
            <div ref={mapLayerButtonRef} className="map-layer-control">
              <button
                type="button"
                className={`map-tool-button map-toolbar-zoom-button ${mapLayerMenuOpen ? "is-active" : ""}`.trim()}
                onClick={() => setMapLayerMenuOpen((open) => !open)}
                title="Selecionar mapa"
                aria-label="Selecionar mapa"
              >
                <Layers style={{ width: 16, height: 16 }} />
              </button>
              {mapLayerMenuOpen && (
                <div className="map-layer-popover">
                  <p className="map-layer-popover-title">Selecionar mapa</p>
                  <div className="map-layer-options">
                    {mapLayerOptions.map((option) => {
                      const isActive = option.layer?.key === mapLayer?.key;
                      return (
                        <button
                          key={option.id}
                          type="button"
                          className={`map-layer-option ${isActive ? "is-active" : ""}`.trim()}
                          onClick={() => {
                            if (option.layer?.key) {
                              setMapLayerKey(option.layer.key);
                            }
                            setMapLayerMenuOpen(false);
                          }}
                        >
                          <span className="map-layer-option-label">{option.label}</span>
                          {option.layer?.description ? (
                            <span className="map-layer-option-subtitle">{option.layer.description}</span>
                          ) : null}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          }
        >
          <div className="relative">
            <ToolbarButton
              icon={LayoutGrid}
              onClick={() => setLayoutMenuOpen((open) => !open)}
              title="Layout e visibilidade"
              className={layoutMenuOpen ? "is-active" : ""}
              iconSize={12}
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
        </MapToolbar>
      </div>

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
        clientOptions={showClientSelect ? clientOptions : []}
        selectedClientId={selectedClientId}
        onClientChange={handleClientChange}
        clientContextBadge={clientContextBadge}
        clientSelectDisabled={contextSwitching || !canSwitchTenant}
        canManage={canManageGeofences}
        hiddenIds={hiddenIds}
        onToggleVisibility={toggleVisibility}
        onFocus={focusOnGeofence}
        onEdit={handleEditGeofence}
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
            readOnly={!canEditSelected}
          />
          {!isTargetView && (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <label className="text-xs text-white/70">
                <span className="block text-[11px] uppercase tracking-[0.12em] text-white/50">Configuração</span>
                <Select
                  value={normalizeConfig(selectedGeofence.config) || DEFAULT_CONFIG}
                  onChange={(event) => {
                    if (!canEditSelected) return;
                    const config = normalizeConfig(event.target.value) || DEFAULT_CONFIG;
                    setLocalGeofences((current) =>
                      current.map((geo) => (geo.id === selectedGeofence.id ? ensureConfigDefaults({ ...geo, config }) : geo)),
                    );
                    setHasUnsavedChanges(true);
                  }}
                  disabled={!canEditSelected}
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
              <Button size="sm" variant="secondary" onClick={() => toggleVisibility(selectedGeofence.id)}>
                {hiddenIds.has(selectedGeofence.id) ? "Mostrar" : "Ocultar"}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => centerGeofence(selectedGeofence)}>
                Centralizar
              </Button>
              <Button size="sm" variant="ghost" onClick={handleRemoveSelected}>
                Remover
              </Button>
            </div>
          </div>
          <div className="geofence-inspector-footer flex items-center justify-end gap-2">
            {canEditSelected ? (
              <>
                <Button size="sm" variant="ghost" onClick={handleCancelChanges} disabled={!hasUnsavedChanges}>
                  Cancelar
                </Button>
                <Button size="sm" onClick={handleSave} disabled={!hasUnsavedChanges || isBusy || isAdminAllSelected}>
                  {saving ? "Salvando..." : "Salvar"}
                </Button>
              </>
            ) : (
              <Button size="sm" variant="secondary" onClick={() => setViewMode("editing")}>
                Editar
              </Button>
            )}
          </div>
        </div>
      )}

      <input ref={importInputRef} type="file" accept=".kml" className="hidden" onChange={handleImportFile} />
    </div>
  );
}
