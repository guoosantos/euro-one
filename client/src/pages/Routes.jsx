import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CircleMarker, MapContainer, Marker, Polyline, TileLayer, useMap, useMapEvents } from "react-leaflet";
import { Clock3, Download, FileUp, PanelRight, Play, Route, Save, Undo2, X } from "lucide-react";
import "leaflet/dist/leaflet.css";

import useVehicles, { normalizeVehicleDevices } from "../lib/hooks/useVehicles.js";
import useGeocodeSearch from "../lib/hooks/useGeocodeSearch.js";
import Button from "../ui/Button";
import Input from "../ui/Input";
import Select from "../ui/Select";
import { API_ROUTES } from "../lib/api-routes.js";
import api from "../lib/api.js";
import { deduplicatePath, downloadKml, exportRoutesToKml, parseKmlPlacemarks, simplifyPath } from "../lib/kml.js";
import { toDeviceKey } from "../lib/hooks/useDevices.helpers.js";
import useVehicleSelection from "../lib/hooks/useVehicleSelection.js";
import useMapLifecycle from "../lib/map/useMapLifecycle.js";
import MapZoomControls from "../components/map/MapZoomControls.jsx";

const DEFAULT_CENTER = [-23.55052, -46.633308];
const GRAPH_HOPPER_URL = (import.meta?.env?.VITE_GRAPHHOPPER_URL || import.meta?.env?.VITE_GRAPH_HOPPER_URL || "").replace(/\/$/, "");
const GRAPH_HOPPER_KEY = import.meta?.env?.VITE_GRAPHHOPPER_KEY || import.meta?.env?.VITE_GRAPH_HOPPER_KEY || "";

const emptyRoute = () => ({
  id: null,
  name: "Nova rota",
  mode: "car",
  points: [],
  metadata: { waypoints: [] },
});

function uid(prefix = "wpt") {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function normaliseWaypoint(raw, fallbackLabel) {
  if (!raw) return null;
  const lat = Number(raw.lat ?? raw.latitude ?? (Array.isArray(raw) ? raw[0] : null));
  const lng = Number(raw.lng ?? raw.lon ?? raw.longitude ?? (Array.isArray(raw) ? raw[1] : null));
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return {
    id: raw.id || raw.key || uid(),
    type: raw.type || "stop",
    lat,
    lng,
    order: Number.isFinite(raw.order) ? Number(raw.order) : undefined,
    label: raw.label || fallbackLabel || `${lat.toFixed(4)}, ${lng.toFixed(4)}`,
  };
}

function normalizeStopOrders(waypoints) {
  const stops = waypoints.filter((item) => item.type === "stop").sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const checkpoints = waypoints
    .filter((item) => item.type === "checkpoint")
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const others = waypoints.filter((item) => item.type !== "stop" && item.type !== "checkpoint");
  const reindexedStops = stops.map((stop, index) => ({ ...stop, order: index }));
  const reindexedCheckpoints = checkpoints.map((checkpoint, index) => ({ ...checkpoint, order: index }));
  return [...others, ...reindexedStops, ...reindexedCheckpoints];
}

function deriveWaypoints(metadataWaypoints, points) {
  const normalised = Array.isArray(metadataWaypoints)
    ? metadataWaypoints
        .map((item, index) => ({ ...normaliseWaypoint(item), order: Number.isFinite(item?.order) ? Number(item.order) : index }))
        .filter(Boolean)
    : [];

  const hasEndpoints = normalised.some((item) => item.type === "origin") && normalised.some((item) => item.type === "destination");
  if (hasEndpoints) {
    return normalizeStopOrders(normalised);
  }

  if (Array.isArray(points) && points.length >= 2) {
    const middleStops = points.slice(1, -1).map((coords, index) => ({
      id: uid(),
      type: "stop",
      lat: Number(coords[0]),
      lng: Number(coords[1]),
      order: index,
      label: `Parada ${index + 1}`,
    }));
    return normalizeStopOrders([
      { id: uid(), type: "origin", order: 0, lat: Number(points[0][0]), lng: Number(points[0][1]), label: "Origem" },
      ...middleStops,
      {
        id: uid(),
        type: "destination",
        order: middleStops.length + 1,
        lat: Number(points[points.length - 1][0]),
        lng: Number(points[points.length - 1][1]),
        label: "Destino",
      },
    ]);
  }

  return normalizeStopOrders(normalised);
}

function withWaypoints(route) {
  const safeRoute = route || {};
  const points = Array.isArray(safeRoute.points)
    ? safeRoute.points
        .map((pair) => {
          if (!Array.isArray(pair) || pair.length < 2) return null;
          const lat = Number(pair[0]);
          const lng = Number(pair[1]);
          return Number.isFinite(lat) && Number.isFinite(lng) ? [lat, lng] : null;
        })
        .filter(Boolean)
    : [];
  const metadata = safeRoute.metadata && typeof safeRoute.metadata === "object" ? { ...safeRoute.metadata } : {};
  const waypoints = deriveWaypoints(metadata.waypoints, points);
  return {
    ...safeRoute,
    mode: safeRoute.mode || "car",
    points,
    metadata: { ...metadata, waypoints },
  };
}

function splitWaypoints(waypoints) {
  const origin = waypoints.find((item) => item.type === "origin") || null;
  const destination = waypoints.find((item) => item.type === "destination") || null;
  const stops = waypoints.filter((item) => item.type === "stop").sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const checkpoints = waypoints
    .filter((item) => item.type === "checkpoint")
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  return { origin, destination, stops, checkpoints };
}

async function buildOsrmPath(waypoints) {
  if (!Array.isArray(waypoints) || waypoints.length < 2) return [];
  const coordinates = waypoints.map((point) => `${point.lng},${point.lat}`).join(";");
  const url = new URL(`https://router.project-osrm.org/route/v1/driving/${coordinates}`);
  url.searchParams.set("overview", "full");
  url.searchParams.set("geometries", "geojson");
  url.searchParams.set("annotations", "false");

  const response = await fetch(url.toString());
  if (!response.ok) {
    throw new Error("OSRM indisponível para gerar rota agora.");
  }
  const payload = await response.json().catch(() => null);
  const geometry = payload?.routes?.[0]?.geometry;
  const coords = geometry?.coordinates || payload?.routes?.[0]?.geometry?.coordinates || [];
  if (!Array.isArray(coords) || !coords.length) return [];
  return coords.map(([lon, lat]) => [lat, lon]);
}

async function buildGraphHopperPath(waypoints) {
  if (!GRAPH_HOPPER_URL || !GRAPH_HOPPER_KEY) return null;
  const url = new URL(`${GRAPH_HOPPER_URL}/route`);
  url.searchParams.set("profile", "car");
  url.searchParams.set("points_encoded", "false");
  url.searchParams.set("locale", "pt-BR");
  url.searchParams.set("key", GRAPH_HOPPER_KEY);
  waypoints.forEach((point) => {
    url.searchParams.append("point", `${point.lat},${point.lng}`);
  });

  const response = await fetch(url.toString());
  if (!response.ok) return null;
  const payload = await response.json().catch(() => null);
  const coords = payload?.paths?.[0]?.points?.coordinates;
  if (!Array.isArray(coords) || !coords.length) return null;
  return coords.map(([lon, lat]) => [lat, lon]);
}

function extractPositionsFromPayload(payload) {
  const container = payload?.data ?? payload;
  const base = Array.isArray(container?.positions)
    ? container.positions
    : Array.isArray(container?.route)
      ? container.route
      : Array.isArray(container)
        ? container
        : Array.isArray(container?.data)
          ? container.data
          : [];

  return base
    .map((pos) => [Number(pos.latitude ?? pos.lat), Number(pos.longitude ?? pos.lon ?? pos.lng)])
    .filter((pair) => pair.every((value) => Number.isFinite(value)));
}

function FitToRoute({ points }) {
  const map = useMap();
  useEffect(() => {
    if (!map) return;
    if (Array.isArray(points) && points.length > 1) {
      map.fitBounds(points, { padding: [32, 32] });
    } else if (Array.isArray(points) && points.length === 1) {
      map.setView(points[0], 14);
    }
  }, [map, points]);
  return null;
}

function MapClickHandler({ enabled, onAdd }) {
  useMapEvents({
    click(event) {
      if (!enabled) return;
      onAdd([event.latlng.lat, event.latlng.lng]);
    },
  });
  return null;
}

function WaypointInput({ label, placeholder, value, onChange }) {
  const [query, setQuery] = useState(value?.label || "");
  const { suggestions, isSearching, clearSuggestions, searchRegion, error } = useGeocodeSearch();
  const debounceRef = useRef(null);

  useEffect(() => {
    setQuery(value?.label || "");
  }, [value?.id]);

  useEffect(() => {
    if (query && query.length >= 3) {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => searchRegion(query), 250);
    } else {
      clearSuggestions();
    }
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, clearSuggestions, searchRegion]);

  const parseManual = useCallback(() => {
    if (!query) return null;
    const parts = query.split(/[,;\s]+/).map((part) => Number(part.trim())).filter((num) => Number.isFinite(num));
    if (parts.length >= 2) {
      return { lat: parts[0], lng: parts[1], label: query };
    }
    return null;
  }, [query]);

  const handleSelect = useCallback(
    (candidate) => {
      const payload = {
        id: value?.id || candidate.id || uid(),
        type: value?.type || "stop",
        lat: candidate.lat,
        lng: candidate.lng,
        label: candidate.concise || candidate.label || query,
        order: value?.order,
      };
      onChange(payload);
      setQuery(payload.label || "");
      clearSuggestions();
    },
    [clearSuggestions, onChange, query, value?.id, value?.order, value?.type],
  );

  const handleBlur = () => {
    const manual = parseManual();
    if (manual) {
      onChange({ ...manual, id: value?.id || uid(), type: value?.type || "stop", order: value?.order });
    }
  };

  return (
    <div className="relative">
      <label className="text-xs font-semibold text-white/70">{label}</label>
      <input
        className="mt-1 w-full rounded-xl border border-white/10 bg-white/5 px-3 py-1.5 text-[13px] text-white focus:border-primary focus:outline-none"
        placeholder={placeholder}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onBlur={handleBlur}
      />
      {error && <p className="mt-1 text-xs text-red-400">{error.message}</p>}
      {(suggestions.length > 0 || isSearching) && (
        <div className="absolute z-10 mt-1 w-full rounded-xl border border-white/10 bg-neutral-900/95 p-2 shadow-lg">
          {isSearching && <p className="px-2 py-1 text-xs text-white/60">Buscando endereços...</p>}
          {suggestions.map((item) => (
            <button
              key={item.id}
              type="button"
              className="block w-full rounded-lg px-2 py-1 text-left text-sm text-white hover:bg-white/5"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => handleSelect(item)}
            >
              <span className="block text-white">{item.concise || item.label}</span>
              <span className="block text-[11px] text-white/60">{item.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function RoutePanel({
  open,
  routes,
  activeRouteId,
  searchTerm,
  onSearch,
  onSelect,
  onDelete,
  onExport,
  onClose,
  loading,
}) {
  if (!open) return null;

  return (
    <div className="geofence-panel">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-[11px] uppercase tracking-[0.12em] text-white/60">Rotas</p>
          <h2 className="text-base font-semibold text-white">Embarcadas</h2>
        </div>
        <div className="flex items-center gap-1">
          <span className="map-status-pill bg-white/5 text-white/70">{routes.length} itens</span>
          <button type="button" className="map-tool-button" onClick={onClose} title="Recolher painel">
            <X size={16} />
          </button>
        </div>
      </div>

      <div className="mt-3 space-y-2">
        <Input
          value={searchTerm}
          onChange={(event) => onSearch(event.target.value)}
          placeholder="Buscar rota"
          className="map-compact-input"
        />
        <div className="geofence-panel-list">
          {routes.map((route) => (
            <button
              key={route.id || route.name}
              type="button"
              className={`geofence-panel-item text-left transition ${
                activeRouteId === route.id ? "border-primary/50 bg-primary/10" : "hover:border-white/20"
              }`}
              onClick={() => onSelect(route)}
            >
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold text-white">{route.name || "Rota sem nome"}</p>
                  <p className="text-[11px] text-white/60">{route.points?.length || 0} pontos</p>
                </div>
                {route.updatedAt && (
                  <span className="text-[11px] text-white/60">
                    {new Date(route.updatedAt).toLocaleDateString()}
                  </span>
                )}
              </div>
              <div className="mt-2 flex gap-2">
                <Button
                  size="xs"
                  variant="secondary"
                  onClick={(event) => {
                    event.stopPropagation();
                    onDelete(route.id);
                  }}
                >
                  Excluir
                </Button>
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={(event) => {
                    event.stopPropagation();
                    onExport(route);
                  }}
                >
                  Exportar
                </Button>
              </div>
            </button>
          ))}
          {routes.length === 0 && !loading && <p className="text-xs text-white/60">Nenhuma rota salva ainda.</p>}
          {loading && <p className="text-xs text-white/60">Carregando...</p>}
        </div>
      </div>
    </div>
  );
}

export default function RoutesPage() {
  const mapRef = useRef(null);
  const { onMapReady } = useMapLifecycle({ mapRef });
  const fileInputRef = useRef(null);
  const [routes, setRoutes] = useState([]);
  const [draftRoute, setDraftRoute] = useState(withWaypoints(emptyRoute()));
  const [baselineRoute, setBaselineRoute] = useState(withWaypoints(emptyRoute()));
  const [activeRouteId, setActiveRouteId] = useState(null);
  const [panelOpen, setPanelOpen] = useState(true);
  const [routeFilter, setRouteFilter] = useState("");
  const [loadingRoutes, setLoadingRoutes] = useState(false);
  const [saving, setSaving] = useState(false);
  const [isRouting, setIsRouting] = useState(false);
  const [mapAddsStops, setMapAddsStops] = useState(false);
  const [mode, setMode] = useState("manual");
  const [modePanelOpen, setModePanelOpen] = useState(true);
  const [historyForm, setHistoryForm] = useState({ vehicleId: "", from: "", to: "" });
  const [loadingHistory, setLoadingHistory] = useState(false);

  const {
    vehicles,
    vehicleOptions,
    loading: loadingVehicles,
    error: vehiclesError,
  } = useVehicles();
  const { selectedVehicleId: vehicleId, selectedTelemetryDeviceId: deviceIdFromStore } = useVehicleSelection({
    syncQuery: true,
  });
  const historyVehicle = useMemo(
    () => vehicles.find((vehicle) => String(vehicle.id) === String(historyForm.vehicleId)) || null,
    [historyForm.vehicleId, vehicles],
  );
  const historyDeviceId = deviceIdFromStore || historyVehicle?.primaryDeviceId || "";
  const vehicleByDeviceId = useMemo(() => {
    const map = new Map();
    vehicles.forEach((vehicle) => {
      normalizeVehicleDevices(vehicle).forEach((device) => {
        const key = toDeviceKey(device?.id ?? device?.deviceId ?? device?.uniqueId ?? device?.traccarId);
        if (key) map.set(String(key), vehicle);
      });
    });
    return map;
  }, [vehicles]);

  const filteredRoutes = useMemo(() => {
    const term = routeFilter.trim().toLowerCase();
    if (!term) return routes;
    return routes.filter((route) => route.name?.toLowerCase().includes(term));
  }, [routeFilter, routes]);

  useEffect(() => {
    if (!historyForm.vehicleId && vehicleOptions.length === 1) {
      setHistoryForm((current) => ({ ...current, vehicleId: String(vehicleOptions[0].value) }));
    }
  }, [historyForm.vehicleId, vehicleOptions]);

  useEffect(() => {
    if (!vehicleId) return;
    if (historyForm.vehicleId !== String(vehicleId)) {
      setHistoryForm((current) => ({ ...current, vehicleId: String(vehicleId) }));
    }
  }, [historyForm.vehicleId, vehicleId]);

  const waypoints = useMemo(() => normalizeStopOrders(draftRoute.metadata?.waypoints || []), [draftRoute.metadata?.waypoints]);
  const { origin, destination, stops, checkpoints } = useMemo(() => splitWaypoints(waypoints), [waypoints]);

  const loadRoutes = useCallback(async () => {
    setLoadingRoutes(true);
    try {
      const response = await api.get(API_ROUTES.routes);
      const list = response?.data?.data || response?.data?.routes || response?.data || [];
      const normalised = (Array.isArray(list) ? list : []).map(withWaypoints);
      setRoutes(normalised);
      if (normalised[0] && !activeRouteId) {
        setDraftRoute(normalised[0]);
        setBaselineRoute(normalised[0]);
        setActiveRouteId(normalised[0].id);
      }
    } catch (error) {
      console.error("[routes] Falha ao carregar rotas", error);
    } finally {
      setLoadingRoutes(false);
    }
  }, [activeRouteId]);

  useEffect(() => {
    void loadRoutes();
  }, [loadRoutes]);

  const persistRoute = useCallback(
    async (routePayload = draftRoute) => {
      const payload = withWaypoints({
        ...routePayload,
        metadata: {
          ...(routePayload.metadata || {}),
          waypoints: normalizeStopOrders(routePayload.metadata?.waypoints || waypoints || []),
        },
      });
      if (!payload.points || payload.points.length < 2) {
        throw new Error("A rota precisa de pelo menos dois pontos.");
      }
      setSaving(true);
      try {
        const response = payload.id
          ? await api.put(`${API_ROUTES.routes}/${payload.id}`, payload)
          : await api.post(API_ROUTES.routes, payload);
        const saved = withWaypoints(response?.data?.data || response?.data?.route || response?.data || payload);
        setRoutes((prev) => {
          const others = prev.filter((item) => String(item.id) !== String(saved.id));
          return saved.id ? [saved, ...others] : prev;
        });
        setDraftRoute(saved);
        setBaselineRoute(saved);
        setActiveRouteId(saved.id || null);
        return saved;
      } finally {
        setSaving(false);
      }
    },
    [draftRoute, waypoints],
  );

  const handleSave = async () => {
    try {
      await persistRoute();
    } catch (error) {
      console.error(error);
      alert(error?.message || "Não foi possível salvar a rota");
    }
  };

  const handleCancel = () => {
    setDraftRoute(baselineRoute);
    setMapAddsStops(false);
  };

  const handleSelectRoute = (route) => {
    const normalized = withWaypoints(route);
    setDraftRoute(normalized);
    setBaselineRoute(normalized);
    setActiveRouteId(normalized.id || null);
  };

  const handleDeleteRoute = async (id) => {
    if (!id) return;
    if (!window.confirm("Excluir esta rota?")) return;
    try {
      await api.delete(`${API_ROUTES.routes}/${id}`);
      setRoutes((current) => current.filter((item) => String(item.id) !== String(id)));
      if (activeRouteId === id) {
        handleNewRoute();
      }
    } catch (error) {
      console.error(error);
      alert(error?.message || "Não foi possível remover a rota.");
    }
  };

  const handleExportSingle = (route) => {
    if (!route) return;
    const kml = exportRoutesToKml([route]);
    downloadKml(`${route.name || "rota"}.kml`, kml);
  };

  const handleNewRoute = () => {
    const fresh = withWaypoints(emptyRoute());
    setDraftRoute(fresh);
    setBaselineRoute(fresh);
    setActiveRouteId(null);
  };

  const toggleMode = useCallback(() => {
    setMode((current) => (current === "manual" ? "history" : "manual"));
    setModePanelOpen(true);
  }, []);

  const updateWaypoint = useCallback(
    (type, payload, index = 0) => {
      if (!payload) return;
      setDraftRoute((current) => {
        const existing = Array.isArray(current.metadata?.waypoints) ? current.metadata.waypoints : [];
        const isOrderedType = type === "stop" || type === "checkpoint";
        const filtered = existing.filter((item) => item.type !== type || (isOrderedType && item.order !== index));
        const nextWaypoint = normalizeStopOrders([
          ...filtered,
          {
            ...payload,
            id: payload.id || uid(),
            type,
            order: isOrderedType ? index : payload.order,
          },
        ]);
        return { ...current, metadata: { ...(current.metadata || {}), waypoints: nextWaypoint } };
      });
    },
    [],
  );

  const removeStop = useCallback((index) => {
    setDraftRoute((current) => {
      const waypointsList = Array.isArray(current.metadata?.waypoints) ? current.metadata.waypoints : [];
      const filtered = normalizeStopOrders(waypointsList.filter((item) => !(item.type === "stop" && item.order === index)));
      return { ...current, metadata: { ...(current.metadata || {}), waypoints: filtered } };
    });
  }, []);

  const removeCheckpoint = useCallback((index) => {
    setDraftRoute((current) => {
      const waypointsList = Array.isArray(current.metadata?.waypoints) ? current.metadata.waypoints : [];
      const filtered = normalizeStopOrders(waypointsList.filter((item) => !(item.type === "checkpoint" && item.order === index)));
      return { ...current, metadata: { ...(current.metadata || {}), waypoints: filtered } };
    });
  }, []);

  const handleAddStopFromMap = (coords) => {
    const [lat, lng] = coords;
    updateWaypoint("stop", { lat, lng, label: `Parada (${lat.toFixed(4)}, ${lng.toFixed(4)})` }, stops.length);
  };

  const buildRouteFromWaypoints = async () => {
    const ordered = [origin, ...checkpoints, ...stops, destination].filter(Boolean);
    if (ordered.length < 2) {
      alert("Defina origem e destino para gerar a rota.");
      return;
    }
    setIsRouting(true);
    try {
      let path = [];
      try {
        path = await buildOsrmPath(ordered);
      } catch (osrmError) {
        console.warn("OSRM indisponível, tentando GraphHopper", osrmError);
      }
      if (!path?.length) {
        const graphhopperPath = await buildGraphHopperPath(ordered);
        if (graphhopperPath?.length) path = graphhopperPath;
      }
      if (!path?.length) {
        path = ordered.map((point) => [point.lat, point.lng]);
      }
      const simplified = simplifyPath(deduplicatePath(path), 0.00005);
      const nextRoute = {
        ...draftRoute,
        points: simplified,
        metadata: {
          ...(draftRoute.metadata || {}),
          source: draftRoute.metadata?.source || "osrm",
          waypoints: normalizeStopOrders(ordered.map((item) => ({ ...item, id: item.id || uid() }))),
        },
      };
      setDraftRoute(nextRoute);
      handleExportSingle(nextRoute);
    } catch (error) {
      console.error(error);
      alert(error?.message || "Falha ao gerar rota.");
    } finally {
      setIsRouting(false);
    }
  };

  const handleHistoryRoute = async (event) => {
    event.preventDefault();
    if (!historyDeviceId || !historyForm.from || !historyForm.to) {
      alert("Selecione um veículo com equipamento vinculado e informe o período.");
      return;
    }
    setLoadingHistory(true);
    try {
      const params = {
        deviceId: historyDeviceId,
        vehicleId: historyForm.vehicleId || vehicleByDeviceId.get(String(historyDeviceId))?.id,
        from: new Date(historyForm.from).toISOString(),
        to: new Date(historyForm.to).toISOString(),
      };
      let positions = [];
      try {
        const response = await api.get("reports/route", { params });
        positions = extractPositionsFromPayload(response?.data);
      } catch (firstError) {
        console.warn("Fallback para /traccar/reports/route", firstError);
      }
      if (!positions.length) {
        try {
          const response = await api.get(API_ROUTES.reports.route, { params });
          positions = extractPositionsFromPayload(response?.data);
        } catch (secondError) {
          console.warn("Falha no fallback /traccar/reports/route", secondError);
        }
      }
      if (!positions.length) {
        throw new Error("Nenhum ponto encontrado para o período informado.");
      }
      const simplified = simplifyPath(deduplicatePath(positions), 0.00005);
      const historyRoute = withWaypoints({
        ...draftRoute,
        name: draftRoute.name || `Histórico ${historyVehicle?.plate || historyVehicle?.name || historyDeviceId}`,
        points: simplified,
        metadata: {
          ...(draftRoute.metadata || {}),
          source: "history",
          history: {
            vehicleId: historyForm.vehicleId || vehicleByDeviceId.get(String(historyDeviceId))?.id,
            deviceId: historyDeviceId,
            from: params.from,
            to: params.to,
          },
        },
      });
      setDraftRoute(historyRoute);
      const saved = await persistRoute(historyRoute);
      if (saved) {
        setBaselineRoute(saved);
      }
      handleExportSingle(historyRoute);
    } catch (error) {
      console.error(error);
      alert(error?.message || "Não foi possível gerar a rota do histórico.");
    } finally {
      setLoadingHistory(false);
    }
  };

  const handleImportKml = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    const placemarks = parseKmlPlacemarks(text).filter((item) => item.type === "polyline");
    if (!placemarks.length) {
      alert("Nenhuma rota encontrada no KML");
      return;
    }
    for (const item of placemarks) {
      const route = withWaypoints({
        ...emptyRoute(),
        name: item.name || "Rota importada",
        points: item.points,
        metadata: { source: "kml" },
      });
      try {
        const saved = await persistRoute(route);
        if (saved) {
          setDraftRoute(saved);
          setBaselineRoute(saved);
        }
      } catch (importError) {
        console.error("Falha ao salvar rota importada", importError);
      }
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleExportKml = () => {
    const exportable = draftRoute.points?.length
      ? [...routes.filter((item) => String(item.id) !== String(draftRoute.id)), draftRoute]
      : routes;
    const kml = exportRoutesToKml(exportable);
    downloadKml("routes.kml", kml);
  };

  const mapCenter = useMemo(() => draftRoute.points?.[0] || routes[0]?.points?.[0] || DEFAULT_CENTER, [draftRoute.points, routes]);

  return (
    <div className="map-page">
      <div className="map-container">
        <MapContainer
          ref={mapRef}
          center={mapCenter}
          zoom={draftRoute.points?.length ? 13 : 5}
          className="h-full w-full"
          zoomControl={false}
          whenReady={onMapReady}
        >
          <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="OpenStreetMap" />
          <MapZoomControls variant="classic" />
          <MapClickHandler enabled={mapAddsStops} onAdd={handleAddStopFromMap} />
          {routes
            .filter((route) => !draftRoute.id || route.id !== draftRoute.id)
            .map((route) => (
              <Polyline key={route.id} positions={route.points} pathOptions={{ color: "#475569", weight: 3, opacity: 0.4 }} />
            ))}
          {draftRoute.points?.length ? (
            <Polyline positions={draftRoute.points} pathOptions={{ color: "#22d3ee", weight: 5 }} />
          ) : null}
          {origin ? (
            <CircleMarker center={[origin.lat, origin.lng]} radius={8} pathOptions={{ color: "#22d3ee", fillColor: "#22d3ee" }} />
          ) : null}
          {destination ? (
            <CircleMarker
              center={[destination.lat, destination.lng]}
              radius={8}
              pathOptions={{ color: "#f97316", fillColor: "#f97316" }}
            />
          ) : null}
          {checkpoints.map((checkpoint) => (
            <CircleMarker
              key={checkpoint.id}
              center={[checkpoint.lat, checkpoint.lng]}
              radius={7}
              pathOptions={{ color: "#f59e0b", fillColor: "#f59e0b" }}
            />
          ))}
          {stops.map((stop) => (
            <Marker key={stop.id} position={[stop.lat, stop.lng]} />
          ))}
          <FitToRoute points={draftRoute.points} />
        </MapContainer>
      </div>
      <div className="geofence-status-stack">
        <span className="map-status-pill">
          <span className="dot" />
          {routes.length} rotas
        </span>
        {mapAddsStops && <span className="map-status-pill border-primary/50 bg-primary/10 text-cyan-100">Clique no mapa para adicionar paradas</span>}
        {saving && <span className="map-status-pill border-primary/50 bg-primary/10 text-cyan-100">Salvando...</span>}
      </div>

      <RoutePanel
        open={panelOpen}
        routes={filteredRoutes}
        activeRouteId={activeRouteId}
        searchTerm={routeFilter}
        onSearch={setRouteFilter}
        onSelect={handleSelectRoute}
        onDelete={handleDeleteRoute}
        onExport={handleExportSingle}
        onClose={() => setPanelOpen(false)}
        loading={loadingRoutes}
      />

      {modePanelOpen && (
        <div className="geofence-inspector">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-[11px] uppercase tracking-[0.1em] text-white/60">Rotas embarcadas</p>
              <h2 className="text-sm font-semibold text-white">{mode === "manual" ? "Modo manual" : "Modo histórico"}</h2>
              <p className="text-[11px] text-white/60">
                {mode === "manual" ? "Desenhe por endereços e pontos obrigatórios." : "Gere a rota a partir do histórico do veículo."}
              </p>
            </div>
            <button type="button" className="map-tool-button" onClick={() => setModePanelOpen(false)} title="Fechar painel">
              <X size={16} />
            </button>
          </div>

          {mode === "manual" ? (
            <div className="mt-3 space-y-3">
              <Input
                label="Nome"
                value={draftRoute.name}
                onChange={(event) => setDraftRoute((current) => ({ ...current, name: event.target.value }))}
                className="map-compact-input"
              />

              <div className="grid gap-3 md:grid-cols-2">
                <WaypointInput
                  label="Origem"
                  placeholder="Endereço ou lat,long"
                  value={origin}
                  onChange={(value) => updateWaypoint("origin", value)}
                />
                <WaypointInput
                  label="Destino"
                  placeholder="Endereço ou lat,long"
                  value={destination}
                  onChange={(value) => updateWaypoint("destination", value)}
                />
              </div>

              <div className="space-y-2 rounded-xl border border-white/10 bg-white/5 p-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold text-white">Pontos obrigatórios</p>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => updateWaypoint("checkpoint", { lat: DEFAULT_CENTER[0], lng: DEFAULT_CENTER[1], label: "Ponto obrigatório" }, checkpoints.length)}
                  >
                    Adicionar ponto
                  </Button>
                </div>
                {checkpoints.length === 0 && <p className="text-xs text-white/60">Nenhum ponto obrigatório adicionado.</p>}
                {checkpoints.map((checkpoint, index) => (
                  <div key={checkpoint.id} className="flex items-center gap-2">
                    <WaypointInput
                      label={`Obrigatório ${index + 1}`}
                      placeholder="Endereço ou lat,long"
                      value={{ ...checkpoint, order: index }}
                      onChange={(value) => updateWaypoint("checkpoint", value, index)}
                    />
                    <Button size="sm" variant="ghost" onClick={() => removeCheckpoint(index)}>
                      Remover
                    </Button>
                  </div>
                ))}
              </div>

              <div className="space-y-2 rounded-xl border border-white/10 bg-white/5 p-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold text-white">Paradas intermediárias</p>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => updateWaypoint("stop", { lat: DEFAULT_CENTER[0], lng: DEFAULT_CENTER[1], label: "Parada" }, stops.length)}
                  >
                    Adicionar parada
                  </Button>
                </div>
                {stops.length === 0 && <p className="text-xs text-white/60">Nenhuma parada adicionada.</p>}
                {stops.map((stop, index) => (
                  <div key={stop.id} className="flex items-center gap-2">
                    <WaypointInput
                      label={`Parada ${index + 1}`}
                      placeholder="Endereço ou lat,long"
                      value={{ ...stop, order: index }}
                      onChange={(value) => updateWaypoint("stop", value, index)}
                    />
                    <Button size="sm" variant="ghost" onClick={() => removeStop(index)}>
                      Remover
                    </Button>
                  </div>
                ))}
                <label className="flex cursor-pointer items-center gap-2 text-xs text-white/70">
                  <input
                    type="checkbox"
                    className="rounded border-white/30 bg-transparent"
                    checked={mapAddsStops}
                    onChange={(event) => setMapAddsStops(event.target.checked)}
                  />
                  Clique no mapa para adicionar paradas.
                </label>
              </div>

              <div className="flex flex-wrap gap-3">
                <Button onClick={buildRouteFromWaypoints} disabled={isRouting}>
                  {isRouting ? "Gerando rota..." : "Gerar rota"}
                </Button>
                <Button variant="secondary" onClick={handleSave} disabled={saving}>
                  {saving ? "Salvando..." : "Salvar rota"}
                </Button>
                <Button variant="ghost" onClick={handleCancel}>
                  Cancelar alterações
                </Button>
              </div>
            </div>
          ) : (
            <form className="mt-3 space-y-2" onSubmit={handleHistoryRoute}>
              <Select
                value={historyForm.vehicleId}
                onChange={(event) => setHistoryForm((current) => ({ ...current, vehicleId: event.target.value }))}
              >
                <option value="">Selecione um veículo</option>
                {vehicleOptions.map((vehicle) => (
                  <option key={vehicle.value} value={vehicle.value}>
                    {vehicle.label} {vehicle.hasDevice ? "" : "— Sem equipamento vinculado"}
                  </option>
                ))}
              </Select>
              {loadingVehicles && <p className="text-xs text-white/60">Carregando veículos…</p>}
              {vehiclesError && <p className="text-xs text-red-300">{vehiclesError.message}</p>}
              {historyForm.vehicleId && !historyDeviceId && (
                <p className="text-xs text-amber-200/80">Sem equipamento vinculado para este veículo.</p>
              )}
              <div className="grid gap-2 md:grid-cols-2">
                <Input
                  label="Início"
                  type="datetime-local"
                  value={historyForm.from}
                  onChange={(event) => setHistoryForm((current) => ({ ...current, from: event.target.value }))}
                  className="map-compact-input"
                />
                <Input
                  label="Fim"
                  type="datetime-local"
                  value={historyForm.to}
                  onChange={(event) => setHistoryForm((current) => ({ ...current, to: event.target.value }))}
                  className="map-compact-input"
                />
              </div>
              <Button type="submit" disabled={loadingHistory || !historyDeviceId}>
                {loadingHistory ? "Buscando histórico..." : "Gerar rota do histórico"}
              </Button>
            </form>
          )}
        </div>
      )}

      <div className="floating-toolbar">
        <button
          type="button"
          className={`map-tool-button ${panelOpen ? "is-active" : ""}`}
          onClick={() => setPanelOpen((open) => !open)}
          title={panelOpen ? "Recolher lista" : "Mostrar lista"}
        >
          <PanelRight size={16} />
        </button>
        <button
          type="button"
          className={`map-tool-button ${modePanelOpen ? "is-active" : ""}`}
          onClick={toggleMode}
          title={mode === "manual" ? "Modo histórico" : "Modo manual"}
        >
          {mode === "manual" ? <Clock3 size={16} /> : <Route size={16} />}
        </button>
        <button type="button" className="map-tool-button" onClick={handleNewRoute} title="Nova rota">
          <Route size={16} />
        </button>
        <button type="button" className="map-tool-button" onClick={buildRouteFromWaypoints} title="Gerar rota">
          {isRouting ? <Play size={16} className="animate-pulse" /> : <Play size={16} />}
        </button>
        <button
          type="button"
          className="map-tool-button disabled:cursor-not-allowed disabled:opacity-50"
          onClick={handleSave}
          disabled={saving}
          title="Salvar rota"
        >
          {saving ? <Undo2 size={16} className="animate-spin" /> : <Save size={16} />}
        </button>
        <button type="button" className="map-tool-button" onClick={handleCancel} title="Cancelar alterações">
          <Undo2 size={16} />
        </button>
        <button type="button" className="map-tool-button" onClick={() => fileInputRef.current?.click()} title="Importar KML">
          <FileUp size={16} />
        </button>
        <button type="button" className="map-tool-button" onClick={handleExportKml} title="Exportar KML">
          <Download size={16} />
        </button>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept=".kml"
        className="hidden"
        onChange={handleImportKml}
      />
    </div>
  );
}
