import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CircleMarker, MapContainer, Marker, Polyline, TileLayer, useMap, useMapEvents } from "react-leaflet";
import "leaflet/dist/leaflet.css";

import useDevices from "../lib/hooks/useDevices";
import useGeocodeSearch from "../lib/hooks/useGeocodeSearch.js";
import Button from "../ui/Button";
import Input from "../ui/Input";
import Select from "../ui/Select";
import { API_ROUTES } from "../lib/api-routes.js";
import api from "../lib/api.js";
import { deduplicatePath, downloadKml, exportRoutesToKml, parseKmlPlacemarks, simplifyPath } from "../lib/kml.js";

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
  const others = waypoints.filter((item) => item.type !== "stop");
  const reindexed = stops.map((stop, index) => ({ ...stop, order: index }));
  return [...others, ...reindexed];
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
  return { origin, destination, stops };
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
        className="mt-1 w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white focus:border-primary focus:outline-none"
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

export default function RoutesPage() {
  const mapRef = useRef(null);
  const fileInputRef = useRef(null);
  const [routes, setRoutes] = useState([]);
  const [draftRoute, setDraftRoute] = useState(withWaypoints(emptyRoute()));
  const [baselineRoute, setBaselineRoute] = useState(withWaypoints(emptyRoute()));
  const [activeRouteId, setActiveRouteId] = useState(null);
  const [loadingRoutes, setLoadingRoutes] = useState(false);
  const [saving, setSaving] = useState(false);
  const [isRouting, setIsRouting] = useState(false);
  const [mapAddsStops, setMapAddsStops] = useState(false);
  const [historyForm, setHistoryForm] = useState({ deviceId: "", from: "", to: "" });
  const [loadingHistory, setLoadingHistory] = useState(false);

  const { devices } = useDevices();
  const deviceOptions = useMemo(
    () =>
      (Array.isArray(devices) ? devices : []).map((device) => ({
        value: device.traccarId || device.deviceId || device.id || device.uniqueId,
        label: device.name || device.uniqueId || device.id,
      })),
    [devices],
  );

  const waypoints = useMemo(() => normalizeStopOrders(draftRoute.metadata?.waypoints || []), [draftRoute.metadata?.waypoints]);
  const { origin, destination, stops } = useMemo(() => splitWaypoints(waypoints), [waypoints]);

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

  const handleNewRoute = () => {
    const fresh = withWaypoints(emptyRoute());
    setDraftRoute(fresh);
    setBaselineRoute(fresh);
    setActiveRouteId(null);
  };

  const updateWaypoint = useCallback(
    (type, payload, index = 0) => {
      if (!payload) return;
      setDraftRoute((current) => {
        const existing = Array.isArray(current.metadata?.waypoints) ? current.metadata.waypoints : [];
        const filtered = existing.filter((item) => item.type !== type || (type === "stop" && item.order !== index));
        const nextWaypoint = normalizeStopOrders([
          ...filtered,
          {
            ...payload,
            id: payload.id || uid(),
            type,
            order: type === "stop" ? index : payload.order,
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

  const handleAddStopFromMap = (coords) => {
    const [lat, lng] = coords;
    updateWaypoint("stop", { lat, lng, label: `Parada (${lat.toFixed(4)}, ${lng.toFixed(4)})` }, stops.length);
  };

  const buildRouteFromWaypoints = async () => {
    const ordered = [origin, ...stops, destination].filter(Boolean);
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
      setDraftRoute((current) => ({
        ...current,
        points: simplified,
        metadata: {
          ...(current.metadata || {}),
          source: current.metadata?.source || "osrm",
          waypoints: normalizeStopOrders(ordered.map((item) => ({ ...item, id: item.id || uid() }))),
        },
      }));
    } catch (error) {
      console.error(error);
      alert(error?.message || "Falha ao gerar rota.");
    } finally {
      setIsRouting(false);
    }
  };

  const handleHistoryRoute = async (event) => {
    event.preventDefault();
    if (!historyForm.deviceId || !historyForm.from || !historyForm.to) return;
    setLoadingHistory(true);
    try {
      const params = {
        deviceId: historyForm.deviceId,
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
        name: draftRoute.name || `Histórico ${historyForm.deviceId}`,
        points: simplified,
        metadata: {
          ...(draftRoute.metadata || {}),
          source: "history",
          history: { deviceId: historyForm.deviceId, from: params.from, to: params.to },
        },
      });
      setDraftRoute(historyRoute);
      const saved = await persistRoute(historyRoute);
      if (saved) {
        setBaselineRoute(saved);
      }
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
    <div className="relative -mx-6 -mt-4 h-[calc(100vh-96px)] overflow-hidden">
      <MapContainer
        center={mapCenter}
        zoom={draftRoute.points?.length ? 13 : 5}
        className="absolute inset-0 h-full w-full"
        whenCreated={(mapInstance) => {
          mapRef.current = mapInstance;
        }}
      >
        <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="OpenStreetMap" />
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
        {stops.map((stop) => (
          <Marker key={stop.id} position={[stop.lat, stop.lng]} />
        ))}
        <FitToRoute points={draftRoute.points} />
      </MapContainer>

      <div className="pointer-events-none absolute inset-0">
        <div className="pointer-events-auto absolute left-6 top-6 w-full max-w-xl space-y-3 rounded-2xl border border-white/10 bg-neutral-900/70 p-4 backdrop-blur">
          <div className="flex items-center justify-between gap-2">
            <div>
              <p className="text-xs uppercase tracking-wide text-primary">Modo: carro (OSRM)</p>
              <h2 className="text-xl font-semibold text-white">Construtor de rotas</h2>
              <p className="text-sm text-white/70">Defina origem, paradas e destino e gere uma rota aderente à malha viária.</p>
            </div>
            <Button onClick={handleNewRoute} size="sm">
              Nova rota
            </Button>
          </div>

          <Input
            label="Nome"
            value={draftRoute.name}
            onChange={(event) => setDraftRoute((current) => ({ ...current, name: event.target.value }))}
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
              <p className="text-sm font-semibold text-white">Paradas intermediárias</p>
              <Button size="sm" variant="secondary" onClick={() => updateWaypoint("stop", { lat: DEFAULT_CENTER[0], lng: DEFAULT_CENTER[1], label: "Parada" }, stops.length)}>
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

          <form className="space-y-2 rounded-xl border border-primary/20 bg-primary/10 p-3" onSubmit={handleHistoryRoute}>
            <p className="text-sm font-semibold text-white">Gerar a partir do histórico</p>
            <Select
              value={historyForm.deviceId}
              onChange={(event) => setHistoryForm((current) => ({ ...current, deviceId: event.target.value }))}
            >
              <option value="">Selecione um dispositivo</option>
              {deviceOptions.map((device) => (
                <option key={device.value} value={device.value}>
                  {device.label}
                </option>
              ))}
            </Select>
            <div className="grid gap-2 md:grid-cols-2">
              <Input
                label="Início"
                type="datetime-local"
                value={historyForm.from}
                onChange={(event) => setHistoryForm((current) => ({ ...current, from: event.target.value }))}
              />
              <Input
                label="Fim"
                type="datetime-local"
                value={historyForm.to}
                onChange={(event) => setHistoryForm((current) => ({ ...current, to: event.target.value }))}
              />
            </div>
            <Button type="submit" disabled={loadingHistory || !historyForm.deviceId}>
              {loadingHistory ? "Buscando histórico..." : "Gerar rota do histórico"}
            </Button>
          </form>
        </div>

        <div className="pointer-events-auto absolute right-6 top-6 w-full max-w-xs space-y-2 rounded-2xl border border-white/10 bg-neutral-900/70 p-3 backdrop-blur">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-white">Rotas salvas</p>
            {loadingRoutes && <span className="text-[11px] text-white/60">Carregando...</span>}
          </div>
          {routes.length === 0 && <p className="text-xs text-white/60">Nenhuma rota salva ainda.</p>}
          <div className="space-y-2">
            {routes.map((route) => (
              <button
                key={route.id}
                type="button"
                className={`w-full rounded-xl border px-3 py-2 text-left ${
                  activeRouteId === route.id ? "border-primary/50 bg-primary/10" : "border-white/10 bg-white/5"
                }`}
                onClick={() => handleSelectRoute(route)}
              >
                <p className="text-sm font-semibold text-white">{route.name}</p>
                <p className="text-[11px] text-white/60">{route.points?.length || 0} pontos</p>
              </button>
            ))}
          </div>
        </div>

        <div className="pointer-events-auto absolute bottom-6 right-6 flex flex-col gap-3">
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Salvando..." : "Salvar"}
          </Button>
          <Button variant="ghost" onClick={handleCancel}>
            Cancelar
          </Button>
          <label className="flex items-center justify-center gap-2 rounded-full bg-white/10 px-4 py-2 text-sm text-white shadow-lg hover:bg-white/20">
            <input
              ref={fileInputRef}
              type="file"
              accept=".kml"
              className="hidden"
              onChange={handleImportKml}
            />
            Importar KML
          </label>
          <Button variant="secondary" onClick={handleExportKml}>
            Exportar KML
          </Button>
        </div>
      </div>
    </div>
  );
}
