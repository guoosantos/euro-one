import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Circle, MapContainer, Polygon, Polyline, TileLayer, useMap } from "react-leaflet";
import { latLngBounds } from "leaflet";
import {
  Download,
  Map as MapIcon,
  Pencil,
  Plus,
  Route,
  Save,
  Target,
  Trash2,
  X,
} from "lucide-react";

import useGeofences from "../lib/hooks/useGeofences.js";
import useVehicles from "../lib/hooks/useVehicles.js";
import api from "../lib/api.js";
import { API_ROUTES } from "../lib/api-routes.js";
import { ENABLED_MAP_LAYERS, MAP_LAYER_FALLBACK } from "../lib/mapLayers.js";
import { useTenant } from "../lib/tenant-context.jsx";
import Button from "../ui/Button";
import Input from "../ui/Input";
import LTextArea from "../ui/LTextArea.jsx";
import PageHeader from "../ui/PageHeader.jsx";

const HISTORY_PAGE_SIZE = 10;

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "—";
  return `${Number(bytes).toLocaleString("pt-BR")} B`;
}

function formatDateTime(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString();
}

function resolveLastEmbark(itinerary) {
  return itinerary?.lastEmbark || itinerary?.lastEmbarked || itinerary?.embark || null;
}

function resolveVehicleStatus(vehicle) {
  return vehicle?.status || vehicle?.state || vehicle?.condition || "—";
}

function resolveVehicleLastUpdate(vehicle) {
  return (
    vehicle?.lastUpdate ||
    vehicle?.lastSeen ||
    vehicle?.lastTransmission ||
    vehicle?.updatedAt ||
    vehicle?.updated_at ||
    null
  );
}

function resolveSelectionValidation({ hasVehicles, hasItineraries }) {
  if (hasVehicles && hasItineraries) return null;
  if (!hasVehicles && !hasItineraries) {
    return "Selecione pelo menos 1 veículo e 1 itinerário.";
  }
  if (!hasVehicles) {
    return "Selecione pelo menos 1 veículo.";
  }
  return "Selecione pelo menos 1 itinerário.";
}

function resolveStatusBadgeClass(label) {
  const normalized = String(label || "").toLowerCase();
  if (normalized.includes("falh") || normalized.includes("erro")) return "border-red-500/40 bg-red-500/15 text-red-100";
  if (normalized.includes("pendente") || normalized.includes("enviado")) {
    return "border-amber-500/40 bg-amber-500/15 text-amber-100";
  }
  if (normalized.includes("conclu")) {
    return "border-emerald-500/40 bg-emerald-500/15 text-emerald-100";
  }
  return "border-white/10 bg-white/5 text-white/70";
}

function resolveApiError(error, fallback) {
  if (!error) return fallback;
  const response = error?.response || {};
  const payload = response?.data || {};
  const status = error?.status || response?.status || null;
  const serverMessage = payload?.error || payload?.message || payload?.errorMessage || null;
  const baseMessage = serverMessage || error?.message || fallback;
  if (!status) return baseMessage;
  return `${baseMessage} (HTTP ${status})`;
}

function resolveEmbarkErrorMessage(error) {
  const code = error?.response?.data?.code || error?.code || "";
  const status = error?.response?.status || error?.status || 0;
  const message = String(error?.response?.data?.message || error?.message || "").toLowerCase();
  if (code.includes("XDM") || status === 502 || status === 503) {
    return "Não foi possível comunicar com o XDM. Tente novamente.";
  }
  if (code.includes("NO_PERMISSION") || message.includes("permiss")) {
    return "Falha ao aplicar no equipamento. Verifique credenciais/configuração.";
  }
  return resolveApiError(error, "Não foi possível concluir a operação.");
}

function normalizeIdList(list = []) {
  if (!Array.isArray(list)) return [];
  return list.map((item) => String(item)).filter(Boolean);
}

function resolveTechnicalDetails(error) {
  if (!error) return null;
  const responseData = error?.response?.data;
  if (responseData) {
    try {
      return JSON.stringify(responseData, null, 2);
    } catch (stringifyError) {
      console.error("[itineraries] Falha ao serializar erro técnico", stringifyError);
    }
  }
  return String(error?.message || error) || null;
}

function resolveHybridLayer() {
  return (
    ENABLED_MAP_LAYERS.find((layer) => layer.key === "google-hybrid") ||
    ENABLED_MAP_LAYERS.find((layer) => layer.key === "hybrid") ||
    MAP_LAYER_FALLBACK
  );
}

function buildCircleBounds({ center, radiusMeters }) {
  if (!center || !Number.isFinite(radiusMeters) || radiusMeters <= 0) return null;
  const [lat, lng] = center;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const latRadius = radiusMeters / 111320;
  const lngRadius = radiusMeters / (111320 * Math.cos((lat * Math.PI) / 180));
  return latLngBounds(
    [lat - latRadius, lng - lngRadius],
    [lat + latRadius, lng + lngRadius],
  );
}

function collectGeometryBounds(items = []) {
  const points = [];
  items.forEach((item) => {
    const geometry = item?.geometry;
    if (!geometry) return;
    if (Array.isArray(geometry.points) && geometry.points.length) {
      geometry.points.forEach((point) => {
        if (Array.isArray(point) && point.length >= 2) {
          const lat = Number(point[0]);
          const lng = Number(point[1]);
          if (Number.isFinite(lat) && Number.isFinite(lng)) {
            points.push([lat, lng]);
          }
        }
      });
      return;
    }
    if (geometry.center && geometry.radiusMeters) {
      const bounds = buildCircleBounds({
        center: geometry.center,
        radiusMeters: geometry.radiusMeters,
      });
      if (bounds) {
        points.push(bounds.getSouthWest(), bounds.getNorthEast());
      }
    }
  });
  if (!points.length) return null;
  return latLngBounds(points);
}

function buildItineraryItemDetails(itinerary, geofences, routes) {
  if (!itinerary) return [];
  const items = Array.isArray(itinerary.items) ? itinerary.items : [];
  return items.map((item) => {
    const type = item?.type || "";
    const id = item?.id ? String(item.id) : null;
    const geofence = type === "geofence" || type === "target" ? geofences.find((geo) => String(geo.id) === id) : null;
    const route = type === "route" ? routes.find((routeItem) => String(routeItem.id) === id) : null;
    const isTarget = Boolean(geofence?.isTarget) || type === "target";
    const typeLabel =
      type === "route"
        ? "Rota"
        : isTarget
          ? "Alvo"
          : geofence?.config === "exit"
            ? "Saída"
            : geofence?.config === "entry"
              ? "Entrada"
              : "Cerca";
    const circleCenter =
      geofence?.type === "circle"
        ? [geofence.latitude ?? geofence.center?.[0], geofence.longitude ?? geofence.center?.[1]]
        : null;
    const geometryPoints = type === "route" ? route?.points || [] : geofence?.points || [];
    const baseColor = geofence?.color || route?.color || "#38bdf8";
    const geometry =
      geofence?.type === "circle"
        ? {
            points: [],
            center: circleCenter,
            radiusMeters: geofence?.radius || null,
            color: baseColor,
            isRoute: false,
          }
        : {
            points: geometryPoints,
            center: null,
            radiusMeters: null,
            color: baseColor,
            isRoute: type === "route",
          };
    return {
      id,
      type,
      name: geofence?.name || route?.name || "Item",
      typeLabel,
      statusLabel: item?.xdmGeozoneId ? "Aplicado no XDM" : "Pendente no XDM",
      geometry,
    };
  });
}

function MapFitBounds({ items }) {
  const map = useMap();
  useEffect(() => {
    if (!map) return;
    const bounds = collectGeometryBounds(items);
    if (!bounds || !bounds.isValid()) return;
    map.fitBounds(bounds, { padding: [24, 24] });
  }, [map, items]);
  return null;
}

function MapGeometryLayer({ item }) {
  const geometry = item?.geometry;
  if (!geometry) return null;
  const color = geometry.color || "#38bdf8";
  if (geometry.center && geometry.radiusMeters) {
    return (
      <Circle
        center={geometry.center}
        radius={geometry.radiusMeters}
        pathOptions={{ color, fillColor: color, fillOpacity: 0.2, weight: 2 }}
      />
    );
  }
  if (Array.isArray(geometry.points) && geometry.points.length) {
    if (geometry.isRoute) {
      return <Polyline positions={geometry.points} pathOptions={{ color, weight: 3 }} />;
    }
    return (
      <Polygon
        positions={geometry.points}
        pathOptions={{ color, fillColor: color, fillOpacity: 0.2, weight: 2 }}
      />
    );
  }
  return null;
}

function MapPreviewModal({ open, title, items = [], onClose }) {
  const mapLayer = useMemo(() => resolveHybridLayer(), []);
  const [mapReady, setMapReady] = useState(false);
  const initialCenter = useMemo(() => {
    const firstItem = items.find((item) => item?.geometry?.center || item?.geometry?.points?.length);
    if (firstItem?.geometry?.center) return firstItem.geometry.center;
    if (firstItem?.geometry?.points?.length) return firstItem.geometry.points[0];
    return [-23.55, -46.63];
  }, [items]);

  useEffect(() => {
    if (!open) return;
    setMapReady(false);
  }, [open, items]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 px-4 py-6">
      <div className="relative flex w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#0f141c] shadow-3xl">
        <div className="flex items-center justify-between border-b border-white/10 px-6 py-4">
          <div>
            <p className="text-xs uppercase tracking-[0.12em] text-white/50">Mapa híbrido</p>
            <h3 className="text-lg font-semibold text-white">{title}</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-white/10 bg-white/5 p-2 text-white/70 transition hover:border-white/30 hover:text-white"
            aria-label="Fechar"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="h-[420px] w-full">
          {items.length ? (
            <div className="relative h-full w-full">
              {!mapReady && (
                <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/40 text-sm text-white/70">
                  Carregando mapa…
                </div>
              )}
              <MapContainer
                center={initialCenter}
                zoom={13}
                scrollWheelZoom
                className="h-full w-full"
                whenReady={() => setMapReady(true)}
              >
                <TileLayer
                  url={mapLayer?.url || MAP_LAYER_FALLBACK.url}
                  attribution={mapLayer?.attribution || MAP_LAYER_FALLBACK.attribution}
                  maxZoom={mapLayer?.maxZoom || 20}
                  subdomains={mapLayer?.subdomains}
                />
                <MapFitBounds items={items} />
                {items.map((item) => (
                  <MapGeometryLayer key={`${item.id}-${item.type}`} item={item} />
                ))}
              </MapContainer>
            </div>
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-white/60">
              Não há geometria disponível para este item.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ItineraryDetailModal({ open, itinerary, items, onClose, onExportKml, onOpenMap }) {
  const mapLayer = useMemo(() => resolveHybridLayer(), []);
  const [mapReady, setMapReady] = useState(false);
  const initialCenter = useMemo(() => {
    const firstItem = items.find((item) => item?.geometry?.center || item?.geometry?.points?.length);
    if (firstItem?.geometry?.center) return firstItem.geometry.center;
    if (firstItem?.geometry?.points?.length) return firstItem.geometry.points[0];
    return [-23.55, -46.63];
  }, [items]);

  useEffect(() => {
    if (!open) return;
    setMapReady(false);
  }, [open, items]);

  if (!open || !itinerary) return null;

  return (
    <div className="fixed inset-0 z-[9998] flex items-center justify-center bg-black/60 px-4 py-6">
      <div className="relative flex w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#0f141c] shadow-3xl">
        <div className="flex items-start justify-between gap-4 border-b border-white/10 px-6 py-5">
          <div>
            <p className="text-xs uppercase tracking-[0.12em] text-white/50">Detalhes do itinerário</p>
            <h2 className="text-xl font-semibold text-white">{itinerary.name}</h2>
            <p className="text-sm text-white/60">{itinerary.description || "Sem descrição"}</p>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="secondary" onClick={() => onExportKml?.(itinerary.id)} icon={Download}>
              Exportar KML
            </Button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-full border border-white/10 bg-white/5 p-2 text-white/70 transition hover:border-white/30 hover:text-white"
              aria-label="Fechar"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
        <div className="grid gap-4 overflow-y-auto px-6 py-5 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
          <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
            <div className="mb-3 flex items-center justify-between">
              <p className="text-sm font-semibold text-white">Mapa híbrido</p>
              <span className="text-xs text-white/60">{items.length} itens</span>
            </div>
            <div className="h-[360px] overflow-hidden rounded-xl border border-white/10">
              {items.length ? (
                <div className="relative h-full w-full">
                  {!mapReady && (
                    <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/40 text-sm text-white/70">
                      Carregando mapa…
                    </div>
                  )}
                  <MapContainer
                    center={initialCenter}
                    zoom={13}
                    scrollWheelZoom
                    className="h-full w-full"
                    whenReady={() => setMapReady(true)}
                  >
                    <TileLayer
                      url={mapLayer?.url || MAP_LAYER_FALLBACK.url}
                      attribution={mapLayer?.attribution || MAP_LAYER_FALLBACK.attribution}
                      maxZoom={mapLayer?.maxZoom || 20}
                      subdomains={mapLayer?.subdomains}
                    />
                    <MapFitBounds items={items} />
                    {items.map((item) => (
                      <MapGeometryLayer key={`${item.id}-${item.type}`} item={item} />
                    ))}
                  </MapContainer>
                </div>
              ) : (
                <div className="flex h-full items-center justify-center text-sm text-white/60">
                  Sem geometria para exibir.
                </div>
              )}
            </div>
          </div>
          <div className="space-y-3">
            <div className="rounded-2xl border border-white/10 bg-black/30 p-4 text-sm text-white/70">
              <p className="text-[11px] uppercase tracking-[0.12em] text-white/50">Status XDM</p>
              <p className="text-base font-semibold text-white">{itinerary.xdmSyncStatus || "Sem status"}</p>
              {itinerary.xdmLastSyncError && (
                <p className="mt-2 text-xs text-red-200">{itinerary.xdmLastSyncError}</p>
              )}
            </div>
            <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
              <p className="text-sm font-semibold text-white">Cercas / Rotas / Alvos / Entrada</p>
              <div className="mt-3 space-y-2">
                {items.length === 0 && <p className="text-xs text-white/60">Nenhum item vinculado.</p>}
                {items.map((item) => (
                  <div key={`${item.id}-${item.type}`} className="rounded-xl border border-white/10 bg-black/40 px-3 py-2">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-white">{item.name}</p>
                        <p className="text-xs text-white/60">{item.typeLabel}</p>
                      </div>
                      <span className="text-[11px] text-white/60">{item.statusLabel}</span>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                      <Button size="xs" variant="ghost" onClick={() => onOpenMap?.(item)} icon={MapIcon}>
                        Ver no mapa (Híbrido)
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ItineraryModal({
  open,
  onClose,
  title,
  description,
  saving,
  onSave,
  onDelete,
  form,
  onChange,
  postSavePrompt,
  onEmbarkNow,
  onContinueEditing,
  onClosePrompt,
  activeTab,
  onTabChange,
  geofences,
  routes,
  targetGeofences,
  onLinkItem,
  onRemoveItem,
  vehicles,
  itineraries,
  embarkState,
  disembarkState,
  onEmbarkSubmit,
  onDisembarkSubmit,
}) {
  const [selectedGeofenceId, setSelectedGeofenceId] = useState(null);
  const [selectedRouteId, setSelectedRouteId] = useState(null);
  const [selectedTargetId, setSelectedTargetId] = useState(null);
  const [embarkTab, setEmbarkTab] = useState("vehicles");
  const [disembarkTab, setDisembarkTab] = useState("vehicles");

  useEffect(() => {
    if (!open) return;
    setSelectedGeofenceId(null);
    setSelectedRouteId(null);
    setSelectedTargetId(null);
    setEmbarkTab("vehicles");
    setDisembarkTab("vehicles");
  }, [open]);

  if (!open) return null;

  const canEmbark = embarkState.selectedVehicleIds.length > 0 && embarkState.selectedItineraryIds.length > 0;
  const canDisembark = disembarkState.selectedVehicleIds.length > 0 && disembarkState.selectedItineraryIds.length > 0;
  const embarkValidationMessage = resolveSelectionValidation({
    hasVehicles: embarkState.selectedVehicleIds.length > 0,
    hasItineraries: embarkState.selectedItineraryIds.length > 0,
  });
  const disembarkValidationMessage = resolveSelectionValidation({
    hasVehicles: disembarkState.selectedVehicleIds.length > 0,
    hasItineraries: disembarkState.selectedItineraryIds.length > 0,
  });

  const linkedItems = form.items || [];
  const linkedSet = new Set(linkedItems.map((item) => `${item.type}:${item.id}`));
  const clientGeofences = geofences.filter((geo) => !geo.isTarget);
  const selectedGeofence = clientGeofences.find((geo) => String(geo.id) === String(selectedGeofenceId)) || null;
  const selectedRoute = routes.find((route) => String(route.id) === String(selectedRouteId)) || null;
  const selectedTarget = targetGeofences.find((target) => String(target.id) === String(selectedTargetId)) || null;

  const renderLinkStatus = (type, id) => {
    if (!id) return null;
    return linkedSet.has(`${type}:${id}`) ? (
      <span className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-[10px] uppercase tracking-[0.12em] text-emerald-200">
        Já vinculada
      </span>
    ) : (
      <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] uppercase tracking-[0.12em] text-white/60">
        Disponível
      </span>
    );
  };

  return (
    <div className="fixed inset-0 z-[9998] flex items-center justify-center bg-black/60 px-4 py-6">
      <div className="relative flex w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#0f141c] shadow-3xl">
        <div className="flex items-start justify-between gap-4 border-b border-white/10 px-6 py-5">
          <div>
            <p className="text-xs uppercase tracking-[0.12em] text-white/50">Editor de itinerários</p>
            <h2 className="text-xl font-semibold text-white">{title}</h2>
            {description && <p className="text-sm text-white/60">{description}</p>}
          </div>
          <div className="flex items-center gap-2">
            {onDelete && (
              <Button size="sm" variant="ghost" onClick={onDelete} icon={Trash2}>
                Excluir
              </Button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="rounded-full border border-white/10 bg-white/5 p-2 text-white/70 transition hover:border-white/30 hover:text-white"
              aria-label="Fechar"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="border-b border-white/10 px-6 py-3">
          <div className="flex flex-wrap gap-2 text-[11px] uppercase tracking-[0.1em] text-white/60">
            {[
              { key: "detalhes", label: "Detalhes" },
              { key: "cercas", label: "Cercas" },
              { key: "rotas", label: "Rotas" },
              { key: "alvos", label: "Alvos" },
              { key: "itens", label: "Itens vinculados" },
              { key: "embarcar", label: "Embarcar itinerário" },
              { key: "desembarcar", label: "Desembarcar itinerário" },
            ].map((tab) => (
              <button
                key={tab.key}
                onClick={() => onTabChange(tab.key)}
                className={`rounded-md px-3 py-2 transition ${
                  activeTab === tab.key
                    ? "border border-primary/40 bg-primary/20 text-white"
                    : "border border-transparent hover:border-white/20"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        <div className="max-h-[70vh] flex-1 overflow-y-auto px-6 py-5">
          {activeTab === "detalhes" && (
            <div className="space-y-4">
              <Input
                placeholder="Nome do itinerário"
                value={form.name}
                onChange={(event) => onChange({ ...form, name: event.target.value })}
              />
              <LTextArea
                placeholder="Descrição"
                value={form.description}
                onChange={(event) => onChange({ ...form, description: event.target.value })}
                rows={3}
              />
              {postSavePrompt && (
                <div className="space-y-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-50">
                  <div className="space-y-1">
                    <p className="text-xs uppercase tracking-[0.12em] text-emerald-100/70">
                      Itinerário salvo
                    </p>
                    <p className="text-base font-semibold text-white">{postSavePrompt.name}</p>
                    <p className="text-sm text-emerald-100/80">
                      Deseja embarcar este itinerário agora ou continuar ajustando?
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button size="sm" onClick={onEmbarkNow}>
                      Embarcar agora
                    </Button>
                    <Button size="sm" variant="secondary" onClick={onContinueEditing}>
                      Continuar editando
                    </Button>
                    <Button size="sm" variant="ghost" onClick={onClosePrompt}>
                      Fechar
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}

          {activeTab === "cercas" && (
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
              <div className="space-y-2 rounded-xl border border-white/10 bg-white/5 p-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold text-white">Cercas disponíveis</p>
                  <span className="text-[11px] text-white/60">{clientGeofences.length} disponíveis</span>
                </div>
                <div className="max-h-64 space-y-1 overflow-y-auto">
                  {clientGeofences.map((geo) => (
                    <button
                      key={geo.id}
                      type="button"
                      className={`flex w-full items-center justify-between rounded-lg px-2 py-2 text-left text-sm transition ${
                        String(selectedGeofenceId) === String(geo.id)
                          ? "bg-primary/10 text-white"
                          : "text-white/80 hover:bg-white/5"
                      }`}
                      onClick={() => setSelectedGeofenceId(geo.id)}
                    >
                      <span className="flex items-center gap-2">
                        <span className="h-2 w-2 rounded-full" style={{ background: geo.color || "#22c55e" }} />
                        {geo.name}
                      </span>
                      <span className="text-[11px] text-white/50">{geo.type === "circle" ? "Círculo" : `${geo.points?.length || 0} pts`}</span>
                    </button>
                  ))}
                  {clientGeofences.length === 0 && <p className="text-xs text-white/60">Nenhuma cerca disponível.</p>}
                </div>
              </div>

              <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                {selectedGeofence ? (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-semibold text-white">{selectedGeofence.name}</p>
                        <p className="text-xs text-white/60">{selectedGeofence.description || "Sem descrição"}</p>
                      </div>
                      {renderLinkStatus("geofence", selectedGeofence.id)}
                    </div>
                    <div className="grid gap-3 text-xs text-white/70 sm:grid-cols-2">
                      <div>
                        <p className="text-[11px] uppercase tracking-[0.12em] text-white/50">Tipo</p>
                        <p>{selectedGeofence.type === "circle" ? "Círculo" : "Polígono"}</p>
                      </div>
                      <div>
                        <p className="text-[11px] uppercase tracking-[0.12em] text-white/50">Configuração</p>
                        <p>{selectedGeofence.config === "exit" ? "Saída" : "Entrada"}</p>
                      </div>
                    </div>
                    <Button
                      onClick={() => onLinkItem({ type: "geofence", id: selectedGeofence.id })}
                      disabled={linkedSet.has(`geofence:${selectedGeofence.id}`)}
                    >
                      Vincular
                    </Button>
                  </div>
                ) : (
                  <p className="text-sm text-white/60">Selecione uma cerca para ver detalhes.</p>
                )}
              </div>
            </div>
          )}

          {activeTab === "rotas" && (
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
              <div className="space-y-2 rounded-xl border border-white/10 bg-white/5 p-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold text-white">Rotas disponíveis</p>
                  <span className="text-[11px] text-white/60">{routes.length} disponíveis</span>
                </div>
                <div className="max-h-64 space-y-1 overflow-y-auto">
                  {routes.map((route) => (
                    <button
                      key={route.id}
                      type="button"
                      className={`flex w-full items-center justify-between rounded-lg px-2 py-2 text-left text-sm transition ${
                        String(selectedRouteId) === String(route.id)
                          ? "bg-primary/10 text-white"
                          : "text-white/80 hover:bg-white/5"
                      }`}
                      onClick={() => setSelectedRouteId(route.id)}
                    >
                      <span className="flex items-center gap-2">
                        <Route size={14} />
                        {route.name}
                      </span>
                      <span className="text-[11px] text-white/50">{route.points?.length || 0} pts</span>
                    </button>
                  ))}
                  {routes.length === 0 && <p className="text-xs text-white/60">Nenhuma rota disponível.</p>}
                </div>
              </div>

              <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                {selectedRoute ? (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-semibold text-white">{selectedRoute.name}</p>
                        <p className="text-xs text-white/60">Atualizada em {formatDateTime(selectedRoute.updatedAt)}</p>
                      </div>
                      {renderLinkStatus("route", selectedRoute.id)}
                    </div>
                    <div className="grid gap-3 text-xs text-white/70 sm:grid-cols-2">
                      <div>
                        <p className="text-[11px] uppercase tracking-[0.12em] text-white/50">Pontos</p>
                        <p>{selectedRoute.points?.length || 0} pontos</p>
                      </div>
                      <div>
                        <p className="text-[11px] uppercase tracking-[0.12em] text-white/50">Modo</p>
                        <p>{selectedRoute.mode || "car"}</p>
                      </div>
                    </div>
                    <Button
                      onClick={() => onLinkItem({ type: "route", id: selectedRoute.id })}
                      disabled={linkedSet.has(`route:${selectedRoute.id}`)}
                    >
                      Vincular
                    </Button>
                  </div>
                ) : (
                  <p className="text-sm text-white/60">Selecione uma rota para ver detalhes.</p>
                )}
              </div>
            </div>
          )}

          {activeTab === "alvos" && (
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
              <div className="space-y-2 rounded-xl border border-white/10 bg-white/5 p-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold text-white">Alvos disponíveis</p>
                  <span className="text-[11px] text-white/60">{targetGeofences.length} disponíveis</span>
                </div>
                <div className="max-h-64 space-y-1 overflow-y-auto">
                  {targetGeofences.map((target) => (
                    <button
                      key={target.id}
                      type="button"
                      className={`flex w-full items-center justify-between rounded-lg px-2 py-2 text-left text-sm transition ${
                        String(selectedTargetId) === String(target.id)
                          ? "bg-primary/10 text-white"
                          : "text-white/80 hover:bg-white/5"
                      }`}
                      onClick={() => setSelectedTargetId(target.id)}
                    >
                      <span className="flex items-center gap-2">
                        <Target size={14} />
                        {target.name || `Alvo ${target.id}`}
                      </span>
                      <span className="text-[11px] text-white/50">{target.type === "circle" ? "Círculo" : `${target.points?.length || 0} pts`}</span>
                    </button>
                  ))}
                  {targetGeofences.length === 0 && <p className="text-xs text-white/60">Nenhum alvo disponível.</p>}
                </div>
              </div>

              <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                {selectedTarget ? (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-semibold text-white">{selectedTarget.name}</p>
                        <p className="text-xs text-white/60">{selectedTarget.description || "Sem descrição"}</p>
                      </div>
                      {renderLinkStatus("target", selectedTarget.id)}
                    </div>
                    <div className="grid gap-3 text-xs text-white/70 sm:grid-cols-2">
                      <div>
                        <p className="text-[11px] uppercase tracking-[0.12em] text-white/50">Tipo</p>
                        <p>{selectedTarget.type === "circle" ? "Círculo" : "Polígono"}</p>
                      </div>
                      <div>
                        <p className="text-[11px] uppercase tracking-[0.12em] text-white/50">Vértices</p>
                        <p>{selectedTarget.points?.length || 0}</p>
                      </div>
                    </div>
                    <Button
                      onClick={() => onLinkItem({ type: "target", id: selectedTarget.id })}
                      disabled={linkedSet.has(`target:${selectedTarget.id}`)}
                    >
                      Vincular
                    </Button>
                  </div>
                ) : (
                  <p className="text-sm text-white/60">Selecione um alvo para ver detalhes.</p>
                )}
              </div>
            </div>
          )}

          {activeTab === "itens" && (
            <div className="space-y-3">
              <div className="space-y-2">
                {(form.items || []).map((item) => {
                  const key = `${item.type}:${item.id}`;
                  const label =
                    item.type === "geofence"
                      ? geofences.find((geo) => String(geo.id) === String(item.id))?.name || `Cerca ${item.id}`
                      : item.type === "route"
                        ? routes.find((route) => String(route.id) === String(item.id))?.name || `Rota ${item.id}`
                        : targetGeofences.find((target) => String(target.id) === String(item.id))?.name || `Alvo ${item.id}`;
                  const Icon = item.type === "geofence" ? MapIcon : item.type === "route" ? Route : Target;
                  return (
                    <div
                      key={key}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm text-white"
                    >
                      <span className="flex items-center gap-2">
                        <Icon size={14} />
                        {label}
                      </span>
                      <button
                        type="button"
                        className="text-xs text-red-200 hover:text-red-100"
                        onClick={() => onRemoveItem(item)}
                      >
                        Remover vínculo
                      </button>
                    </div>
                  );
                })}
                {(form.items || []).length === 0 && <p className="text-xs text-white/60">Nenhum item adicionado.</p>}
              </div>
            </div>
          )}

          {activeTab === "embarcar" && (
            <EmbarkContent
              vehicles={vehicles}
              itineraries={itineraries}
              vehicleQuery={embarkState.vehicleQuery}
              onVehicleQueryChange={embarkState.onVehicleQueryChange}
              itineraryQuery={embarkState.itineraryQuery}
              onItineraryQueryChange={embarkState.onItineraryQueryChange}
              bufferMeters={embarkState.bufferMeters}
              onBufferMetersChange={embarkState.onBufferMetersChange}
              selectedVehicleIds={embarkState.selectedVehicleIds}
              onToggleVehicle={embarkState.onToggleVehicle}
              selectedItineraryIds={embarkState.selectedItineraryIds}
              onToggleItinerary={embarkState.onToggleItinerary}
              onRemoveVehicle={embarkState.onRemoveVehicle}
              resultSummary={embarkState.resultSummary}
              activeTab={embarkTab}
              onTabChange={setEmbarkTab}
              showSummary={false}
              embedded
              validationMessage={canEmbark ? null : embarkValidationMessage}
            />
          )}

          {activeTab === "desembarcar" && (
            <DisembarkContent
              vehicles={vehicles}
              itineraries={itineraries}
              vehicleQuery={disembarkState.vehicleQuery}
              onVehicleQueryChange={disembarkState.onVehicleQueryChange}
              itineraryQuery={disembarkState.itineraryQuery}
              onItineraryQueryChange={disembarkState.onItineraryQueryChange}
              selectedVehicleIds={disembarkState.selectedVehicleIds}
              onToggleVehicle={disembarkState.onToggleVehicle}
              onRemoveVehicle={disembarkState.onRemoveVehicle}
              selectedItineraryIds={disembarkState.selectedItineraryIds}
              onToggleItinerary={disembarkState.onToggleItinerary}
              cleanupDeleteGroup={disembarkState.cleanupDeleteGroup}
              onCleanupDeleteGroupChange={disembarkState.onCleanupDeleteGroupChange}
              cleanupDeleteGeozones={disembarkState.cleanupDeleteGeozones}
              onCleanupDeleteGeozonesChange={disembarkState.onCleanupDeleteGeozonesChange}
              resultSummary={disembarkState.resultSummary}
              activeTab={disembarkTab}
              onTabChange={setDisembarkTab}
              showSummary={false}
              embedded
              validationMessage={canDisembark ? null : disembarkValidationMessage}
            />
          )}
        </div>

        <div className="flex items-center justify-end border-t border-white/10 px-6 py-4">
          {activeTab === "embarcar" || activeTab === "desembarcar" ? (
            <div className="flex items-center gap-2">
              <Button size="sm" variant="secondary" onClick={onSave} disabled={saving} icon={Save}>
                {saving ? "Salvando..." : "Salvar"}
              </Button>
              {activeTab === "embarcar" ? (
                <Button size="sm" onClick={onEmbarkSubmit} disabled={embarkState.sending || !canEmbark}>
                  {embarkState.sending ? "Embarcando..." : "Embarcar"}
                </Button>
              ) : (
                <Button size="sm" onClick={onDisembarkSubmit} disabled={disembarkState.sending || !canDisembark}>
                  {disembarkState.sending ? "Desembarcando..." : "Desembarcar"}
                </Button>
              )}
            </div>
          ) : (
            <Button onClick={onSave} disabled={saving} icon={Save}>
              {saving ? "Salvando..." : "Salvar"}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function EmbarkContent({
  vehicles,
  itineraries,
  vehicleQuery,
  onVehicleQueryChange,
  itineraryQuery,
  onItineraryQueryChange,
  bufferMeters,
  onBufferMetersChange,
  selectedVehicleIds,
  onToggleVehicle,
  selectedItineraryIds,
  onToggleItinerary,
  onRemoveVehicle,
  resultSummary,
  activeTab,
  onTabChange,
  showSummary = true,
  embedded = false,
  validationMessage,
  technicalDetails,
}) {
  const filteredVehicles = vehicles.filter((vehicle) => {
    const term = vehicleQuery.trim().toLowerCase();
    if (!term) return true;
    return [vehicle.name, vehicle.plate, vehicle.brand, vehicle.model]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(term));
  });

  const filteredItineraries = itineraries.filter((itinerary) => {
    const term = itineraryQuery.trim().toLowerCase();
    if (!term) return true;
    return String(itinerary.name || "")
      .toLowerCase()
      .includes(term);
  });

  const selectedVehicles = vehicles.filter((vehicle) => selectedVehicleIds.includes(String(vehicle.id)));
  const selectedItineraries = itineraries.filter((itinerary) => selectedItineraryIds.includes(String(itinerary.id)));

  const [vehicleDropdownOpen, setVehicleDropdownOpen] = useState(false);
  const [itineraryDropdownOpen, setItineraryDropdownOpen] = useState(false);
  const vehicleDropdownRef = useRef(null);
  const itineraryDropdownRef = useRef(null);

  useEffect(() => {
    const handleClick = (event) => {
      if (vehicleDropdownRef.current && !vehicleDropdownRef.current.contains(event.target)) {
        setVehicleDropdownOpen(false);
      }
      if (itineraryDropdownRef.current && !itineraryDropdownRef.current.contains(event.target)) {
        setItineraryDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const tabsClassName = embedded ? "border-b border-white/10 pb-3" : "border-b border-white/10 px-6 py-3";
  const contentClassName = embedded ? "space-y-6" : "max-h-[70vh] flex-1 space-y-6 overflow-y-auto px-6 py-5";

  return (
    <>
      <div className={tabsClassName}>
        <div className="flex flex-wrap gap-2 text-[11px] uppercase tracking-[0.1em] text-white/60">
          {[
            { key: "vehicles", label: "Veículos" },
            { key: "itineraries", label: "Itinerários" },
          ].map((tab) => (
            <button
              key={tab.key}
              onClick={() => onTabChange(tab.key)}
              className={`rounded-md px-3 py-2 transition ${
                activeTab === tab.key
                  ? "border border-primary/40 bg-primary/20 text-white"
                  : "border border-transparent hover:border-white/20"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div className={contentClassName}>
        {validationMessage && (
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs text-amber-100">
            {validationMessage}
          </div>
        )}
        {activeTab === "vehicles" && (
          <div className="space-y-3">
            <div className="space-y-2" ref={vehicleDropdownRef}>
              <Input
                placeholder="Buscar veículo"
                value={vehicleQuery}
                onChange={(event) => {
                  onVehicleQueryChange(event.target.value);
                  setVehicleDropdownOpen(true);
                }}
                onFocus={() => setVehicleDropdownOpen(true)}
              />
              {vehicleDropdownOpen && (
                <div className="rounded-xl border border-white/10 bg-white/5 p-3">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-semibold text-white">Veículos disponíveis</p>
                    <span className="text-[11px] text-white/60">{selectedVehicleIds.length} selecionados</span>
                  </div>
                  <div className="mt-2 max-h-56 space-y-2 overflow-y-auto">
                    {filteredVehicles.map((vehicle) => {
                      const isSelected = selectedVehicleIds.includes(String(vehicle.id));
                      return (
                        <button
                          key={vehicle.id}
                          type="button"
                          className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm transition ${
                            isSelected ? "bg-primary/10 text-white" : "text-white/80 hover:bg-white/5"
                          }`}
                          onClick={() => onToggleVehicle(String(vehicle.id))}
                        >
                          <span>
                            {vehicle.name || "Veículo"}
                            {vehicle.plate ? ` · ${vehicle.plate}` : ""}
                          </span>
                          <span className="text-[11px] text-white/50">{isSelected ? "Selecionado" : "Adicionar"}</span>
                        </button>
                      );
                    })}
                    {filteredVehicles.length === 0 && (
                      <p className="text-xs text-white/60">Nenhum veículo encontrado.</p>
                    )}
                  </div>
                </div>
              )}
            </div>
            <div className="space-y-2">
              <p className="text-sm font-semibold text-white">Veículos selecionados</p>
              {selectedVehicles.length === 0 && <p className="text-xs text-white/60">Nenhum veículo selecionado.</p>}
              {selectedVehicles.map((vehicle) => (
                <div key={vehicle.id} className="rounded-xl border border-white/10 bg-black/30 p-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-semibold text-white">{vehicle.name || "Veículo"}</p>
                      <p className="text-xs text-white/60">{vehicle.plate || "—"}</p>
                    </div>
                    <button
                      type="button"
                      className="text-xs text-red-200 hover:text-red-100"
                      onClick={() => onRemoveVehicle(String(vehicle.id))}
                    >
                      Remover
                    </button>
                  </div>
                  <div className="mt-3 grid gap-2 text-xs text-white/70 sm:grid-cols-2">
                    <div>
                      <p className="text-[11px] uppercase tracking-[0.12em] text-white/50">Marca</p>
                      <p>{vehicle.brand || "—"}</p>
                    </div>
                    <div>
                      <p className="text-[11px] uppercase tracking-[0.12em] text-white/50">Modelo</p>
                      <p>{vehicle.model || "—"}</p>
                    </div>
                    <div>
                      <p className="text-[11px] uppercase tracking-[0.12em] text-white/50">Status</p>
                      <p>{resolveVehicleStatus(vehicle)}</p>
                    </div>
                    <div>
                      <p className="text-[11px] uppercase tracking-[0.12em] text-white/50">Última transmissão</p>
                      <p>{formatDateTime(resolveVehicleLastUpdate(vehicle))}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === "itineraries" && (
          <div className="space-y-3">
            <Input
              label="Largura do corredor (m)"
              type="number"
              min="10"
              step="10"
              value={bufferMeters ?? 150}
              onChange={(event) => {
                const rawValue = event.target.value;
                const parsed = rawValue === "" ? null : Number(rawValue);
                onBufferMetersChange(Number.isFinite(parsed) && parsed > 0 ? parsed : 150);
              }}
            />
            <div className="space-y-2" ref={itineraryDropdownRef}>
              <Input
                placeholder="Buscar itinerário"
                value={itineraryQuery}
                onChange={(event) => {
                  onItineraryQueryChange(event.target.value);
                  setItineraryDropdownOpen(true);
                }}
                onFocus={() => setItineraryDropdownOpen(true)}
              />
              {itineraryDropdownOpen && (
                <div className="rounded-xl border border-white/10 bg-white/5 p-3">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-semibold text-white">Itinerários disponíveis</p>
                    <span className="text-[11px] text-white/60">{selectedItineraryIds.length} selecionados</span>
                  </div>
                  <div className="mt-2 max-h-64 space-y-2 overflow-y-auto">
                    {filteredItineraries.map((itinerary) => (
                      <label key={itinerary.id} className="flex cursor-pointer items-center gap-2 text-sm text-white/80">
                        <input
                          type="checkbox"
                          className="h-4 w-4"
                          checked={selectedItineraryIds.includes(String(itinerary.id))}
                          onChange={() => onToggleItinerary(String(itinerary.id))}
                        />
                        <span>{itinerary.name}</span>
                      </label>
                    ))}
                    {filteredItineraries.length === 0 && (
                      <p className="text-xs text-white/60">Nenhum itinerário encontrado.</p>
                    )}
                  </div>
                </div>
              )}
            </div>
            <div className="space-y-2">
              <p className="text-sm font-semibold text-white">Itinerários selecionados</p>
              {selectedItineraries.length === 0 && <p className="text-xs text-white/60">Nenhum itinerário selecionado.</p>}
              {selectedItineraries.map((itinerary) => (
                <div key={itinerary.id} className="flex items-center justify-between rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white/80">
                  <span>{itinerary.name}</span>
                  <button
                    type="button"
                    className="text-xs text-red-200 hover:text-red-100"
                    onClick={() => onToggleItinerary(String(itinerary.id))}
                  >
                    Remover
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {showSummary && resultSummary && (
          <div className="space-y-2 rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-xs text-white/70">
            <p>{resultSummary}</p>
            {technicalDetails && (
              <details className="text-[11px] text-white/70">
                <summary className="cursor-pointer text-white/80">Ver detalhes técnicos</summary>
                <pre className="mt-2 whitespace-pre-wrap text-white/60">{technicalDetails}</pre>
              </details>
            )}
          </div>
        )}
      </div>
    </>
  );
}

function EmbarkModal({
  open,
  onClose,
  vehicles,
  itineraries,
  vehicleQuery,
  onVehicleQueryChange,
  itineraryQuery,
  onItineraryQueryChange,
  bufferMeters,
  onBufferMetersChange,
  selectedVehicleIds,
  onToggleVehicle,
  selectedItineraryIds,
  onToggleItinerary,
  onRemoveVehicle,
  sending,
  onSubmit,
  resultSummary,
  technicalDetails,
}) {
  const [activeTab, setActiveTab] = useState("vehicles");
  const hasVehicles = selectedVehicleIds.length > 0;
  const hasItineraries = selectedItineraryIds.length > 0;
  const validationMessage = resolveSelectionValidation({
    hasVehicles,
    hasItineraries,
  });
  const canSubmit = hasVehicles && hasItineraries;

  useEffect(() => {
    if (!open) return;
    setActiveTab("vehicles");
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[9998] flex items-center justify-center bg-black/60 px-4 py-6">
      <div className="relative flex w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#0f141c] shadow-3xl">
        <div className="flex items-start justify-between gap-4 border-b border-white/10 px-6 py-5">
          <div>
            <p className="text-xs uppercase tracking-[0.12em] text-white/50">Embarque de itinerários</p>
            <h2 className="text-xl font-semibold text-white">Enviar embarque</h2>
            <p className="text-sm text-white/60">Selecione veículos e itinerários para embarcar em lote.</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-white/10 bg-white/5 p-2 text-white/70 transition hover:border-white/30 hover:text-white"
            aria-label="Fechar"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <EmbarkContent
          vehicles={vehicles}
          itineraries={itineraries}
          vehicleQuery={vehicleQuery}
          onVehicleQueryChange={onVehicleQueryChange}
          itineraryQuery={itineraryQuery}
          onItineraryQueryChange={onItineraryQueryChange}
          bufferMeters={bufferMeters}
          onBufferMetersChange={onBufferMetersChange}
          selectedVehicleIds={selectedVehicleIds}
          onToggleVehicle={onToggleVehicle}
          selectedItineraryIds={selectedItineraryIds}
          onToggleItinerary={onToggleItinerary}
          onRemoveVehicle={onRemoveVehicle}
          resultSummary={resultSummary}
          technicalDetails={technicalDetails}
          activeTab={activeTab}
          onTabChange={setActiveTab}
          validationMessage={validationMessage}
        />

        <div className="flex items-center justify-end border-t border-white/10 px-6 py-4">
          <Button onClick={onSubmit} disabled={sending || !canSubmit}>
            {sending ? "Embarcando..." : "Embarcar"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function DisembarkContent({
  vehicles,
  itineraries,
  vehicleQuery,
  onVehicleQueryChange,
  itineraryQuery,
  onItineraryQueryChange,
  selectedVehicleIds,
  onToggleVehicle,
  onRemoveVehicle,
  selectedItineraryIds,
  onToggleItinerary,
  cleanupDeleteGroup,
  onCleanupDeleteGroupChange,
  cleanupDeleteGeozones,
  onCleanupDeleteGeozonesChange,
  resultSummary,
  activeTab,
  onTabChange,
  showSummary = true,
  embedded = false,
  validationMessage,
  technicalDetails,
}) {
  const filteredVehicles = vehicles.filter((vehicle) => {
    const term = vehicleQuery.trim().toLowerCase();
    if (!term) return true;
    return [vehicle.name, vehicle.plate, vehicle.brand, vehicle.model]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(term));
  });

  const filteredItineraries = itineraries.filter((itinerary) => {
    const term = itineraryQuery.trim().toLowerCase();
    if (!term) return true;
    return String(itinerary.name || "")
      .toLowerCase()
      .includes(term);
  });

  const selectedVehicles = vehicles.filter((vehicle) => selectedVehicleIds.includes(String(vehicle.id)));
  const selectedItineraries = itineraries.filter((itinerary) => selectedItineraryIds.includes(String(itinerary.id)));

  const [vehicleDropdownOpen, setVehicleDropdownOpen] = useState(false);
  const [itineraryDropdownOpen, setItineraryDropdownOpen] = useState(false);
  const vehicleDropdownRef = useRef(null);
  const itineraryDropdownRef = useRef(null);

  useEffect(() => {
    const handleClick = (event) => {
      if (vehicleDropdownRef.current && !vehicleDropdownRef.current.contains(event.target)) {
        setVehicleDropdownOpen(false);
      }
      if (itineraryDropdownRef.current && !itineraryDropdownRef.current.contains(event.target)) {
        setItineraryDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const tabsClassName = embedded ? "border-b border-white/10 pb-3" : "border-b border-white/10 px-6 py-3";
  const contentClassName = embedded ? "space-y-6" : "max-h-[70vh] flex-1 space-y-6 overflow-y-auto px-6 py-5";

  return (
    <>
      <div className={tabsClassName}>
        <div className="flex flex-wrap gap-2 text-[11px] uppercase tracking-[0.1em] text-white/60">
          {[
            { key: "vehicles", label: "Veículos" },
            { key: "itineraries", label: "Itinerários" },
          ].map((tab) => (
            <button
              key={tab.key}
              onClick={() => onTabChange(tab.key)}
              className={`rounded-md px-3 py-2 transition ${
                activeTab === tab.key
                  ? "border border-primary/40 bg-primary/20 text-white"
                  : "border border-transparent hover:border-white/20"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div className={contentClassName}>
        {validationMessage && (
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs text-amber-100">
            {validationMessage}
          </div>
        )}
        {activeTab === "vehicles" && (
          <div className="space-y-3">
            <div className="space-y-2" ref={vehicleDropdownRef}>
              <Input
                placeholder="Buscar veículo"
                value={vehicleQuery}
                onChange={(event) => {
                  onVehicleQueryChange(event.target.value);
                  setVehicleDropdownOpen(true);
                }}
                onFocus={() => setVehicleDropdownOpen(true)}
              />
              {vehicleDropdownOpen && (
                <div className="rounded-xl border border-white/10 bg-white/5 p-3">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-semibold text-white">Veículos disponíveis</p>
                    <span className="text-[11px] text-white/60">{selectedVehicleIds.length} selecionados</span>
                  </div>
                  <div className="mt-2 max-h-56 space-y-2 overflow-y-auto">
                    {filteredVehicles.map((vehicle) => {
                      const isSelected = selectedVehicleIds.includes(String(vehicle.id));
                      return (
                        <button
                          key={vehicle.id}
                          type="button"
                          className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm transition ${
                            isSelected ? "bg-primary/10 text-white" : "text-white/80 hover:bg-white/5"
                          }`}
                          onClick={() => onToggleVehicle(String(vehicle.id))}
                        >
                          <span>
                            {vehicle.name || "Veículo"}
                            {vehicle.plate ? ` · ${vehicle.plate}` : ""}
                          </span>
                          <span className="text-[11px] text-white/50">{isSelected ? "Selecionado" : "Adicionar"}</span>
                        </button>
                      );
                    })}
                    {filteredVehicles.length === 0 && (
                      <p className="text-xs text-white/60">Nenhum veículo encontrado.</p>
                    )}
                  </div>
                </div>
              )}
            </div>

            <div className="space-y-2">
              <p className="text-sm font-semibold text-white">Veículos selecionados</p>
              {selectedVehicles.length === 0 && <p className="text-xs text-white/60">Nenhum veículo selecionado.</p>}
              {selectedVehicles.map((vehicle) => (
                <div key={vehicle.id} className="rounded-xl border border-white/10 bg-black/30 p-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-semibold text-white">{vehicle.name || "Veículo"}</p>
                      <p className="text-xs text-white/60">{vehicle.plate || "—"}</p>
                    </div>
                    <button
                      type="button"
                      className="text-xs text-red-200 hover:text-red-100"
                      onClick={() => onRemoveVehicle(String(vehicle.id))}
                    >
                      Remover
                    </button>
                  </div>
                  <div className="mt-3 grid gap-2 text-xs text-white/70 sm:grid-cols-2">
                    <div>
                      <p className="text-[11px] uppercase tracking-[0.12em] text-white/50">Marca</p>
                      <p>{vehicle.brand || "—"}</p>
                    </div>
                    <div>
                      <p className="text-[11px] uppercase tracking-[0.12em] text-white/50">Modelo</p>
                      <p>{vehicle.model || "—"}</p>
                    </div>
                    <div>
                      <p className="text-[11px] uppercase tracking-[0.12em] text-white/50">Status</p>
                      <p>{resolveVehicleStatus(vehicle)}</p>
                    </div>
                    <div>
                      <p className="text-[11px] uppercase tracking-[0.12em] text-white/50">Última transmissão</p>
                      <p>{formatDateTime(resolveVehicleLastUpdate(vehicle))}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === "itineraries" && (
          <div className="space-y-3">
            <div className="space-y-2" ref={itineraryDropdownRef}>
              <Input
                placeholder="Buscar itinerário"
                value={itineraryQuery}
                onChange={(event) => {
                  onItineraryQueryChange(event.target.value);
                  setItineraryDropdownOpen(true);
                }}
                onFocus={() => setItineraryDropdownOpen(true)}
              />
              {itineraryDropdownOpen && (
                <div className="rounded-xl border border-white/10 bg-white/5 p-3">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-semibold text-white">Itinerários disponíveis</p>
                    <span className="text-[11px] text-white/60">{selectedItineraryIds.length} selecionados</span>
                  </div>
                  <div className="mt-2 max-h-64 space-y-2 overflow-y-auto">
                    {filteredItineraries.map((itinerary) => (
                      <label key={itinerary.id} className="flex cursor-pointer items-center gap-2 text-sm text-white/80">
                        <input
                          type="checkbox"
                          className="h-4 w-4"
                          checked={selectedItineraryIds.includes(String(itinerary.id))}
                          onChange={() => onToggleItinerary(String(itinerary.id))}
                        />
                        <span>{itinerary.name}</span>
                      </label>
                    ))}
                    {filteredItineraries.length === 0 && (
                      <p className="text-xs text-white/60">Nenhum itinerário encontrado.</p>
                    )}
                  </div>
                </div>
              )}
            </div>
            <div className="space-y-2">
              <p className="text-sm font-semibold text-white">Itinerários selecionados</p>
              {selectedItineraries.length === 0 && <p className="text-xs text-white/60">Nenhum itinerário selecionado.</p>}
              {selectedItineraries.map((itinerary) => (
                <div key={itinerary.id} className="flex items-center justify-between rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white/80">
                  <span>{itinerary.name}</span>
                  <button
                    type="button"
                    className="text-xs text-red-200 hover:text-red-100"
                    onClick={() => onToggleItinerary(String(itinerary.id))}
                  >
                    Remover
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="space-y-3 rounded-xl border border-white/10 bg-white/5 p-4">
          <p className="text-sm font-semibold text-white">Limpeza no XDM (opcional)</p>
          <label className="flex items-center gap-2 text-sm text-white/70">
            <input type="checkbox" className="h-4 w-4" checked disabled />
            Remover geozone group do veículo (desembarque)
          </label>
          <label className="flex items-center gap-2 text-sm text-white/70">
            <input
              type="checkbox"
              className="h-4 w-4"
              checked={cleanupDeleteGroup}
              onChange={(event) => onCleanupDeleteGroupChange(event.target.checked)}
            />
            Excluir Geozone Group no XDM
          </label>
          <label className="flex items-center gap-2 text-sm text-white/70">
            <input
              type="checkbox"
              className="h-4 w-4"
              checked={cleanupDeleteGeozones}
              onChange={(event) => onCleanupDeleteGeozonesChange(event.target.checked)}
            />
            Excluir Cercas / Rotas / Alvos no XDM (somente se não usados por outros itinerários)
          </label>
        </div>

        {showSummary && resultSummary && (
          <div className="space-y-2 rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-xs text-white/70">
            <p>{resultSummary}</p>
            {technicalDetails && (
              <details className="text-[11px] text-white/70">
                <summary className="cursor-pointer text-white/80">Ver detalhes técnicos</summary>
                <pre className="mt-2 whitespace-pre-wrap text-white/60">{technicalDetails}</pre>
              </details>
            )}
          </div>
        )}
      </div>
    </>
  );
}

function DisembarkModal({
  open,
  onClose,
  vehicles,
  itineraries,
  vehicleQuery,
  onVehicleQueryChange,
  itineraryQuery,
  onItineraryQueryChange,
  selectedVehicleIds,
  onToggleVehicle,
  onRemoveVehicle,
  selectedItineraryIds,
  onToggleItinerary,
  cleanupDeleteGroup,
  onCleanupDeleteGroupChange,
  cleanupDeleteGeozones,
  onCleanupDeleteGeozonesChange,
  sending,
  onSubmit,
  resultSummary,
  technicalDetails,
}) {
  const [activeTab, setActiveTab] = useState("vehicles");
  const hasVehicles = selectedVehicleIds.length > 0;
  const hasItineraries = selectedItineraryIds.length > 0;
  const validationMessage = resolveSelectionValidation({
    hasVehicles,
    hasItineraries,
  });
  const canSubmit = hasVehicles && hasItineraries;

  useEffect(() => {
    if (!open) return;
    setActiveTab("vehicles");
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[9998] flex items-center justify-center bg-black/60 px-4 py-6">
      <div className="relative flex w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#0f141c] shadow-3xl">
        <div className="flex items-start justify-between gap-4 border-b border-white/10 px-6 py-5">
          <div>
            <p className="text-xs uppercase tracking-[0.12em] text-white/50">Desembarque de itinerários</p>
            <h2 className="text-xl font-semibold text-white">Enviar desembarque</h2>
            <p className="text-sm text-white/60">Selecione veículos e itinerários para desembarcar em lote.</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-white/10 bg-white/5 p-2 text-white/70 transition hover:border-white/30 hover:text-white"
            aria-label="Fechar"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <DisembarkContent
          vehicles={vehicles}
          itineraries={itineraries}
          vehicleQuery={vehicleQuery}
          onVehicleQueryChange={onVehicleQueryChange}
          itineraryQuery={itineraryQuery}
          onItineraryQueryChange={onItineraryQueryChange}
          selectedVehicleIds={selectedVehicleIds}
          onToggleVehicle={onToggleVehicle}
          onRemoveVehicle={onRemoveVehicle}
          selectedItineraryIds={selectedItineraryIds}
          onToggleItinerary={onToggleItinerary}
          cleanupDeleteGroup={cleanupDeleteGroup}
          onCleanupDeleteGroupChange={onCleanupDeleteGroupChange}
          cleanupDeleteGeozones={cleanupDeleteGeozones}
          onCleanupDeleteGeozonesChange={onCleanupDeleteGeozonesChange}
          resultSummary={resultSummary}
          technicalDetails={technicalDetails}
          activeTab={activeTab}
          onTabChange={setActiveTab}
          validationMessage={validationMessage}
        />

        <div className="flex items-center justify-end border-t border-white/10 px-6 py-4">
          <Button onClick={onSubmit} disabled={sending || !canSubmit}>
            {sending ? "Desembarcando..." : "Desembarcar"}
          </Button>
        </div>
      </div>
    </div>
  );
}

export default function Itineraries() {
  const { geofences } = useGeofences({ autoRefreshMs: 0 });
  const { tenants, tenantId } = useTenant();
  const { vehicles } = useVehicles();
  const [routes, setRoutes] = useState([]);
  const [itineraries, setItineraries] = useState([]);
  const [historyEntries, setHistoryEntries] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [form, setForm] = useState({ name: "", description: "", items: [] });
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [editorTab, setEditorTab] = useState("detalhes");
  const [activeTab, setActiveTab] = useState("embarcado");
  const [editorOpen, setEditorOpen] = useState(false);
  const [embarkOpen, setEmbarkOpen] = useState(false);
  const [disembarkOpen, setDisembarkOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [historyPage, setHistoryPage] = useState(1);
  const [kmlSizes, setKmlSizes] = useState(() => new Map());
  const [embarkVehicleQuery, setEmbarkVehicleQuery] = useState("");
  const [embarkItineraryQuery, setEmbarkItineraryQuery] = useState("");
  const [selectedEmbarkVehicleIds, setSelectedEmbarkVehicleIds] = useState([]);
  const [selectedEmbarkItineraryIds, setSelectedEmbarkItineraryIds] = useState([]);
  const [editorEmbarkVehicleQuery, setEditorEmbarkVehicleQuery] = useState("");
  const [editorEmbarkItineraryQuery, setEditorEmbarkItineraryQuery] = useState("");
  const [selectedEditorEmbarkVehicleIds, setSelectedEditorEmbarkVehicleIds] = useState([]);
  const [selectedEditorEmbarkItineraryIds, setSelectedEditorEmbarkItineraryIds] = useState([]);
  const [embarkSending, setEmbarkSending] = useState(false);
  const [embarkSummary, setEmbarkSummary] = useState(null);
  const [embarkErrorDetails, setEmbarkErrorDetails] = useState(null);
  const [embarkBufferMeters, setEmbarkBufferMeters] = useState(150);
  const [editorEmbarkSummary, setEditorEmbarkSummary] = useState(null);
  const [editorEmbarkBufferMeters, setEditorEmbarkBufferMeters] = useState(150);
  const [disembarkSending, setDisembarkSending] = useState(false);
  const [disembarkVehicleQuery, setDisembarkVehicleQuery] = useState("");
  const [disembarkItineraryQuery, setDisembarkItineraryQuery] = useState("");
  const [selectedDisembarkVehicleIds, setSelectedDisembarkVehicleIds] = useState([]);
  const [selectedDisembarkItineraryIds, setSelectedDisembarkItineraryIds] = useState([]);
  const [editorDisembarkVehicleQuery, setEditorDisembarkVehicleQuery] = useState("");
  const [editorDisembarkItineraryQuery, setEditorDisembarkItineraryQuery] = useState("");
  const [selectedEditorDisembarkVehicleIds, setSelectedEditorDisembarkVehicleIds] = useState([]);
  const [selectedEditorDisembarkItineraryIds, setSelectedEditorDisembarkItineraryIds] = useState([]);
  const [disembarkSummary, setDisembarkSummary] = useState(null);
  const [disembarkErrorDetails, setDisembarkErrorDetails] = useState(null);
  const [editorDisembarkSummary, setEditorDisembarkSummary] = useState(null);
  const [cleanupDeleteGroup, setCleanupDeleteGroup] = useState(false);
  const [cleanupDeleteGeozones, setCleanupDeleteGeozones] = useState(false);
  const [editorCleanupDeleteGroup, setEditorCleanupDeleteGroup] = useState(false);
  const [editorCleanupDeleteGeozones, setEditorCleanupDeleteGeozones] = useState(false);
  const [toast, setToast] = useState(null);
  const toastTimeoutRef = useRef(null);
  const [deleteConflict, setDeleteConflict] = useState(null);
  const [deleteConflictSending, setDeleteConflictSending] = useState(false);
  const [postSavePrompt, setPostSavePrompt] = useState(null);
  const [embarkDetails, setEmbarkDetails] = useState([]);
  const [embarkDetailsLoading, setEmbarkDetailsLoading] = useState(false);
  const [embarkDetailsQuery, setEmbarkDetailsQuery] = useState("");
  const [selectedEmbarkDetailVehicleId, setSelectedEmbarkDetailVehicleId] = useState(null);
  const [vehicleHistory, setVehicleHistory] = useState([]);
  const [vehicleHistoryLoading, setVehicleHistoryLoading] = useState(false);
  const [vehicleDetailTab, setVehicleDetailTab] = useState("detalhes");
  const [mapPreview, setMapPreview] = useState(null);
  const [detailItinerary, setDetailItinerary] = useState(null);

  const clientNameById = useMemo(
    () => new Map((tenants || []).map((client) => [String(client.id), client.name])),
    [tenants],
  );
  const targetGeofences = useMemo(() => geofences.filter((geo) => geo.isTarget), [geofences]);

  useEffect(() => () => {
    if (toastTimeoutRef.current) {
      clearTimeout(toastTimeoutRef.current);
    }
  }, []);

  const showToast = useCallback((message, type = "success", action = null) => {
    if (toastTimeoutRef.current) {
      clearTimeout(toastTimeoutRef.current);
    }
    setToast({ message, type, action });
    toastTimeoutRef.current = setTimeout(() => setToast(null), 3500);
  }, []);

  const loadRoutes = useCallback(async () => {
    try {
      const response = await api.get(API_ROUTES.routes);
      const list = response?.data?.routes || response?.data?.data || [];
      setRoutes(list);
    } catch (error) {
      console.error("[itineraries] Falha ao carregar rotas salvas", error);
      showToast(resolveApiError(error, "Não foi possível carregar as rotas salvas."), "warning");
    }
  }, [showToast]);

  const loadItineraries = useCallback(async () => {
    setLoading(true);
    try {
      const response = await api.get(API_ROUTES.itineraries);
      const list = response?.data?.data || [];
      setItineraries(list);
    } catch (error) {
      console.error("[itineraries] Falha ao carregar itinerários", error);
      showToast(resolveApiError(error, "Não foi possível carregar os itinerários."), "warning");
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const response = await api.get(API_ROUTES.itineraryEmbarkHistory, {
        params: tenantId ? { clientId: tenantId } : undefined,
      });
      const list = response?.data?.data || response?.data?.history || [];
      setHistoryEntries(Array.isArray(list) ? list : []);
    } catch (error) {
      console.error("[itineraries] Falha ao carregar histórico de embarques", error);
      showToast(resolveApiError(error, "Não foi possível carregar o histórico de embarques."), "warning");
    } finally {
      setHistoryLoading(false);
    }
  }, [showToast, tenantId]);

  const loadEmbarkDetails = useCallback(async () => {
    setEmbarkDetailsLoading(true);
    try {
      const response = await api.get(API_ROUTES.itineraryEmbarkVehicles, {
        params: tenantId ? { clientId: tenantId } : undefined,
      });
      const list = response?.data?.data || response?.data?.vehicles || [];
      setEmbarkDetails(Array.isArray(list) ? list : []);
    } catch (error) {
      console.error("[itineraries] Falha ao carregar detalhes de embarque por veículo", error);
      showToast(resolveApiError(error, "Não foi possível carregar os detalhes dos veículos."), "warning");
    } finally {
      setEmbarkDetailsLoading(false);
    }
  }, [showToast, tenantId]);

  const loadVehicleHistory = useCallback(
    async (vehicleId) => {
      if (!vehicleId) {
        setVehicleHistory([]);
        return;
      }
      setVehicleHistoryLoading(true);
      try {
        const response = await api.get(API_ROUTES.itineraryEmbarkVehicleHistory(vehicleId), {
          params: tenantId ? { clientId: tenantId } : undefined,
        });
        const list = response?.data?.data || response?.data?.history || [];
        setVehicleHistory(Array.isArray(list) ? list : []);
      } catch (error) {
        console.error("[itineraries] Falha ao carregar histórico do veículo", error);
        showToast(resolveApiError(error, "Não foi possível carregar o histórico do veículo."), "warning");
      } finally {
        setVehicleHistoryLoading(false);
      }
    },
    [showToast, tenantId],
  );

  useEffect(() => {
    void loadRoutes();
    void loadItineraries();
  }, [loadRoutes, loadItineraries]);

  useEffect(() => {
    if (activeTab !== "historico") return;
    void loadHistory();
  }, [activeTab, loadHistory]);

  useEffect(() => {
    if (activeTab !== "veiculos") return;
    void loadEmbarkDetails();
  }, [activeTab, loadEmbarkDetails]);

  useEffect(() => {
    if (activeTab !== "veiculos") return;
    void loadVehicleHistory(selectedEmbarkDetailVehicleId);
  }, [activeTab, loadVehicleHistory, selectedEmbarkDetailVehicleId]);

  useEffect(() => {
    if (activeTab !== "historico") return;
    const hasPending = historyEntries.some((entry) => {
      const statusCode = entry.statusCode || entry.status || "";
      const normalized = String(statusCode).toUpperCase();
      return ["DEPLOYING", "SYNCING", "QUEUED"].includes(normalized) || entry.statusLabel === "Em andamento";
    });
    if (!hasPending) return;
    const interval = setInterval(() => {
      void loadHistory();
    }, 8000);
    return () => clearInterval(interval);
  }, [activeTab, historyEntries, loadHistory]);

  useEffect(() => {
    if (activeTab === "historico") {
      setHistoryPage(1);
    }
  }, [activeTab, query]);


  const resetForm = () => {
    setForm({ name: "", description: "", items: [] });
    setSelectedId(null);
    setPostSavePrompt(null);
  };

  const resetEmbarkForm = useCallback(() => {
    setEmbarkVehicleQuery("");
    setEmbarkItineraryQuery("");
    setSelectedEmbarkVehicleIds([]);
    setSelectedEmbarkItineraryIds([]);
    setEmbarkSummary(null);
    setEmbarkErrorDetails(null);
    setEmbarkBufferMeters(150);
  }, []);

  const resetDisembarkForm = useCallback(() => {
    setDisembarkVehicleQuery("");
    setDisembarkItineraryQuery("");
    setSelectedDisembarkVehicleIds([]);
    setSelectedDisembarkItineraryIds([]);
    setDisembarkSummary(null);
    setDisembarkErrorDetails(null);
    setCleanupDeleteGroup(false);
    setCleanupDeleteGeozones(false);
  }, []);

  const resetEditorEmbarkForm = useCallback(() => {
    setEditorEmbarkVehicleQuery("");
    setEditorEmbarkItineraryQuery("");
    setSelectedEditorEmbarkVehicleIds([]);
    setSelectedEditorEmbarkItineraryIds([]);
    setEditorEmbarkSummary(null);
    setEditorEmbarkBufferMeters(150);
  }, []);

  const resetEditorDisembarkForm = useCallback(() => {
    setEditorDisembarkVehicleQuery("");
    setEditorDisembarkItineraryQuery("");
    setSelectedEditorDisembarkVehicleIds([]);
    setSelectedEditorDisembarkItineraryIds([]);
    setEditorDisembarkSummary(null);
    setEditorCleanupDeleteGroup(false);
    setEditorCleanupDeleteGeozones(false);
  }, []);

  const openEditor = (itinerary = null) => {
    if (itinerary) {
      setSelectedId(itinerary.id);
      setForm({
        name: itinerary.name || "",
        description: itinerary.description || "",
        items: itinerary.items || [],
      });
      setPostSavePrompt(null);
    } else {
      resetForm();
    }
    resetEditorEmbarkForm();
    resetEditorDisembarkForm();
    setEditorTab("detalhes");
    setEditorOpen(true);
  };

  useEffect(() => {
    if (!editorOpen || !selectedId) return;
    setSelectedEditorEmbarkItineraryIds([String(selectedId)]);
    setSelectedEditorDisembarkItineraryIds([String(selectedId)]);
  }, [editorOpen, selectedId]);

  useEffect(() => {
    if (!editorOpen || !selectedId) return;
    if (editorTab === "embarcar") {
      setSelectedEditorEmbarkItineraryIds([String(selectedId)]);
    }
    if (editorTab === "desembarcar") {
      setSelectedEditorDisembarkItineraryIds([String(selectedId)]);
    }
  }, [editorOpen, editorTab, selectedId]);

  const handleLinkItem = useCallback(
    (item) => {
      if (!item) return;
      setForm((current) => {
        const exists = (current.items || []).some(
          (entry) => entry.type === item.type && String(entry.id) === String(item.id),
        );
        if (exists) {
          showToast("Item já vinculado.", "warning");
          return current;
        }
        return {
          ...current,
          items: [...(current.items || []), { type: item.type, id: String(item.id) }],
        };
      });
      const label = item.type === "geofence" ? "Cerca" : item.type === "route" ? "Rota" : "Alvo";
      showToast(`${label} vinculada com sucesso.`);
    },
    [showToast],
  );

  const handleRemoveItem = useCallback((item) => {
    if (!item) return;
    setForm((current) => {
      const nextItems = (current.items || []).filter(
        (entry) => !(entry.type === item.type && String(entry.id) === String(item.id)),
      );
      return { ...current, items: nextItems };
    });
  }, []);

  const saveItinerary = async ({ closeModal = true } = {}) => {
    if (!form.name.trim()) {
      showToast("Informe um nome para o itinerário.", "warning");
      return null;
    }
    const isNew = !selectedId;
    setSaving(true);
    try {
      const payload = { ...form, items: form.items || [] };
      const response = selectedId
        ? await api.put(`${API_ROUTES.itineraries}/${selectedId}`, payload)
        : await api.post(API_ROUTES.itineraries, payload);
      const saved = response?.data?.data || payload;
      await loadItineraries();
      setSelectedId(saved.id || selectedId);
      showToast("Itinerário salvo com sucesso.");
      if (isNew) {
        setEditorTab("detalhes");
        setPostSavePrompt({
          id: String(saved.id || selectedId || ""),
          name: saved.name || form.name || "Itinerário",
        });
      } else if (closeModal) {
        setEditorOpen(false);
      }
      return saved;
    } catch (error) {
      console.error(error);
      showToast(resolveApiError(error, "Não foi possível salvar o itinerário."), "warning");
      return null;
    } finally {
      setSaving(false);
    }
  };

  const handleSave = async () => {
    await saveItinerary();
  };

  const handleDelete = async (id) => {
    if (!id) return;
    const existing = itineraries.find((item) => item.id === id);
    if (!window.confirm("Remover este itinerário?")) return;
    try {
      await api.delete(`${API_ROUTES.itineraries}/${id}`);
      setItineraries((current) => current.filter((item) => item.id !== id));
      if (selectedId === id) resetForm();
      showToast("Itinerário removido.");
    } catch (error) {
      console.error(error);
      if (error?.response?.status === 409) {
        setDeleteConflict({ id, name: existing?.name || "Itinerário" });
        return;
      }
      showToast(resolveApiError(error, "Não foi possível remover."), "warning");
    }
  };

  const exportKml = async (id) => {
    if (!id) return;
    try {
      const response = await api.get(`${API_ROUTES.itineraries}/${id}/export/kml`, { responseType: "blob" });
      const blob = new Blob([response.data], { type: "application/vnd.google-earth.kml+xml" });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "itinerary.kml";
      a.click();
      window.URL.revokeObjectURL(url);
      setKmlSizes((current) => {
        const next = new Map(current);
        next.set(id, blob.size);
        return next;
      });
    } catch (error) {
      console.error(error);
      showToast(resolveApiError(error, "Não foi possível exportar o KML."), "warning");
    }
  };

  const filteredItineraries = useMemo(() => {
    const term = query.trim().toLowerCase();
    return itineraries.filter((item) => {
      const name = item.name?.toLowerCase() || "";
      if (term && !name.includes(term)) return false;
      return true;
    });
  }, [itineraries, query]);

  const filteredHistory = useMemo(() => {
    const term = query.trim().toLowerCase();
    const list = historyEntries.filter((entry) => {
      if (!term) return true;
      return [
        entry.itineraryName,
        entry.vehicleName,
        entry.plate,
        entry.model,
        entry.brand,
        entry.sentByName,
        entry.message,
        entry.actionLabel,
        entry.statusLabel,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(term));
    });
    return list;
  }, [historyEntries, query]);

  const filteredEmbarkDetails = useMemo(() => {
    const term = embarkDetailsQuery.trim().toLowerCase();
    if (!term) return embarkDetails;
    return embarkDetails.filter((detail) =>
      [detail.vehicleName, detail.plate, detail.brand, detail.model, detail.itineraryName]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(term)),
    );
  }, [embarkDetails, embarkDetailsQuery]);

  const selectedEmbarkDetail = useMemo(
    () => filteredEmbarkDetails.find((item) => String(item.vehicleId) === String(selectedEmbarkDetailVehicleId)) || null,
    [filteredEmbarkDetails, selectedEmbarkDetailVehicleId],
  );
  const detailItems = useMemo(
    () => buildItineraryItemDetails(detailItinerary, geofences, routes),
    [detailItinerary, geofences, routes],
  );

  useEffect(() => {
    if (activeTab !== "veiculos") return;
    if (!filteredEmbarkDetails.length) {
      setSelectedEmbarkDetailVehicleId(null);
      return;
    }
    const exists = filteredEmbarkDetails.some(
      (item) => String(item.vehicleId) === String(selectedEmbarkDetailVehicleId),
    );
    if (!exists) {
      setSelectedEmbarkDetailVehicleId(filteredEmbarkDetails[0].vehicleId);
    }
  }, [activeTab, filteredEmbarkDetails, selectedEmbarkDetailVehicleId]);

  useEffect(() => {
    if (activeTab !== "veiculos") return;
    setVehicleDetailTab("detalhes");
  }, [activeTab, selectedEmbarkDetailVehicleId]);

  const historyTotalPages = Math.max(1, Math.ceil(filteredHistory.length / HISTORY_PAGE_SIZE));
  const safeHistoryPage = Math.min(historyPage, historyTotalPages);
  const historyStart = (safeHistoryPage - 1) * HISTORY_PAGE_SIZE;
  const paginatedHistory = filteredHistory.slice(historyStart, historyStart + HISTORY_PAGE_SIZE);

  const selected = useMemo(() => itineraries.find((item) => item.id === selectedId) || null, [itineraries, selectedId]);

  const handleFormChange = useCallback(
    (nextForm) => {
      setForm(nextForm);
      if (postSavePrompt) {
        setPostSavePrompt(null);
      }
    },
    [postSavePrompt],
  );

  const openItemMapPreview = useCallback((item) => {
    if (!item) return;
    setMapPreview({ title: item.name || "Mapa", items: [item] });
  }, []);

  const handleToggleVehicle = (vehicleId) => {
    setSelectedEmbarkVehicleIds((current) =>
      current.includes(vehicleId) ? current.filter((id) => id !== vehicleId) : [...current, vehicleId],
    );
  };

  const handleToggleItinerary = (itineraryId) => {
    setSelectedEmbarkItineraryIds((current) =>
      current.includes(itineraryId) ? current.filter((id) => id !== itineraryId) : [...current, itineraryId],
    );
  };

  const handleRemoveVehicle = (vehicleId) => {
    setSelectedEmbarkVehicleIds((current) => current.filter((id) => id !== vehicleId));
  };

  const handleToggleEditorEmbarkVehicle = (vehicleId) => {
    setSelectedEditorEmbarkVehicleIds((current) =>
      current.includes(vehicleId) ? current.filter((id) => id !== vehicleId) : [...current, vehicleId],
    );
  };

  const handleToggleEditorEmbarkItinerary = (itineraryId) => {
    setSelectedEditorEmbarkItineraryIds((current) =>
      current.includes(itineraryId) ? current.filter((id) => id !== itineraryId) : [...current, itineraryId],
    );
  };

  const handleRemoveEditorEmbarkVehicle = (vehicleId) => {
    setSelectedEditorEmbarkVehicleIds((current) => current.filter((id) => id !== vehicleId));
  };

  const handleToggleDisembarkVehicle = (vehicleId) => {
    setSelectedDisembarkVehicleIds((current) =>
      current.includes(vehicleId) ? current.filter((id) => id !== vehicleId) : [...current, vehicleId],
    );
  };

  const handleToggleDisembarkItinerary = (itineraryId) => {
    setSelectedDisembarkItineraryIds((current) =>
      current.includes(itineraryId) ? current.filter((id) => id !== itineraryId) : [...current, itineraryId],
    );
  };

  const handleRemoveDisembarkVehicle = (vehicleId) => {
    setSelectedDisembarkVehicleIds((current) => current.filter((id) => id !== vehicleId));
  };

  const handleToggleEditorDisembarkVehicle = (vehicleId) => {
    setSelectedEditorDisembarkVehicleIds((current) =>
      current.includes(vehicleId) ? current.filter((id) => id !== vehicleId) : [...current, vehicleId],
    );
  };

  const handleToggleEditorDisembarkItinerary = (itineraryId) => {
    setSelectedEditorDisembarkItineraryIds((current) =>
      current.includes(itineraryId) ? current.filter((id) => id !== itineraryId) : [...current, itineraryId],
    );
  };

  const handleRemoveEditorDisembarkVehicle = (vehicleId) => {
    setSelectedEditorDisembarkVehicleIds((current) => current.filter((id) => id !== vehicleId));
  };

  const openDisembarkModal = useCallback(
    (itineraryId = null) => {
      resetDisembarkForm();
      if (itineraryId) {
        setSelectedDisembarkItineraryIds([String(itineraryId)]);
      }
      setDisembarkOpen(true);
    },
    [resetDisembarkForm],
  );

  const openEmbarkModal = useCallback(
    (itineraryId = null) => {
      resetEmbarkForm();
      if (itineraryId) {
        setSelectedEmbarkItineraryIds([String(itineraryId)]);
      }
      setEmbarkOpen(true);
    },
    [resetEmbarkForm],
  );

  const handleEmbarkSubmit = async (overrideItineraryIds = null, overrideClientId = null) => {
    const vehicleIds = normalizeIdList(selectedEmbarkVehicleIds);
    const itineraryIds = normalizeIdList(overrideItineraryIds || selectedEmbarkItineraryIds);
    const validationMessage = resolveSelectionValidation({
      hasVehicles: vehicleIds.length > 0,
      hasItineraries: itineraryIds.length > 0,
    });
    if (validationMessage) {
      showToast(validationMessage, "warning");
      return;
    }
    const inferredClientId =
      overrideClientId ||
      tenantId ||
      itineraries.find((item) => String(item.id) === String(itineraryIds[0]))?.clientId ||
      null;
    if (!inferredClientId) {
      showToast("Selecione um cliente válido para embarcar.", "warning");
      return;
    }
    setEmbarkSending(true);
    setEmbarkErrorDetails(null);
    try {
      const response = await api.post(API_ROUTES.itineraryEmbark, {
        vehicleIds,
        itineraryIds,
        clientId: inferredClientId ?? undefined,
        xdmBufferMeters: embarkBufferMeters,
      });
      const summary = response?.data?.data?.summary || response?.data?.summary || null;
      const okCount = Number(summary?.success || 0);
      const failedCount = Number(summary?.failed || 0);
      if (failedCount > 0) {
        showToast(`Embarque concluído com ${okCount} sucesso(s) e ${failedCount} falha(s).`, "warning");
        setEmbarkSummary(`Resultado: ${okCount} enviados, ${failedCount} falharam.`);
      } else {
        showToast("Embarque enviado com sucesso.");
        setEmbarkSummary("Embarque enviado com sucesso.");
        setEmbarkOpen(false);
        resetEmbarkForm();
      }
      await loadHistory();
      if (activeTab === "veiculos") {
        await loadEmbarkDetails();
      }
    } catch (error) {
      console.error(error);
      const friendlyMessage = resolveEmbarkErrorMessage(error);
      showToast(friendlyMessage, "warning");
      setEmbarkSummary(friendlyMessage);
      setEmbarkErrorDetails(resolveTechnicalDetails(error));
    } finally {
      setEmbarkSending(false);
    }
  };

  const handleDisembarkSubmit = async (overrideItineraryIds = null, overrideClientId = null) => {
    const vehicleIds = normalizeIdList(selectedDisembarkVehicleIds);
    const itineraryIds = normalizeIdList(overrideItineraryIds || selectedDisembarkItineraryIds);
    const validationMessage = resolveSelectionValidation({
      hasVehicles: vehicleIds.length > 0,
      hasItineraries: itineraryIds.length > 0,
    });
    if (validationMessage) {
      showToast(validationMessage, "warning");
      return;
    }
    const inferredClientId =
      overrideClientId ||
      tenantId ||
      itineraries.find((item) => String(item.id) === String(itineraryIds[0]))?.clientId ||
      null;
    if (!inferredClientId) {
      showToast("Selecione um cliente válido para desembarcar.", "warning");
      return;
    }
    setDisembarkSending(true);
    setDisembarkErrorDetails(null);
    try {
      const response = await api.post(API_ROUTES.itineraryDisembarkBatch, {
        vehicleIds,
        itineraryIds,
        clientId: inferredClientId ?? undefined,
        options: {
          cleanup: {
            deleteGeozoneGroup: cleanupDeleteGroup,
            deleteGeozones: cleanupDeleteGeozones,
          },
        },
      });
      const summary = response?.data?.data?.summary || response?.data?.summary || null;
      const okCount = Number(summary?.success || 0);
      const failedCount = Number(summary?.failed || 0);
      if (failedCount > 0) {
        showToast(`Desembarque concluído com ${okCount} sucesso(s) e ${failedCount} falha(s).`, "warning");
        setDisembarkSummary(`Resultado: ${okCount} concluídos, ${failedCount} falharam.`);
      } else {
        showToast("Desembarque enviado com sucesso.");
        setDisembarkSummary("Desembarque enviado com sucesso.");
        setDisembarkOpen(false);
        resetDisembarkForm();
      }
      await loadHistory();
      if (activeTab === "veiculos") {
        await loadEmbarkDetails();
      }
    } catch (error) {
      console.error(error);
      const friendlyMessage = resolveEmbarkErrorMessage(error);
      showToast(friendlyMessage, "warning");
      setDisembarkSummary(friendlyMessage);
      setDisembarkErrorDetails(resolveTechnicalDetails(error));
    } finally {
      setDisembarkSending(false);
    }
  };

  const handleEditorEmbarkSubmit = async () => {
    const itineraryId = selectedId;
    if (!itineraryId) {
      showToast("Salve o itinerário antes de embarcar.", "warning");
      return;
    }
    const itineraryIds =
      selectedEditorEmbarkItineraryIds.length > 0
        ? selectedEditorEmbarkItineraryIds
        : [String(itineraryId)];
    const validationMessage = resolveSelectionValidation({
      hasVehicles: selectedEditorEmbarkVehicleIds.length > 0,
      hasItineraries: itineraryIds.length > 0,
    });
    if (validationMessage) {
      showToast(validationMessage, "warning");
      return;
    }
    const inferredClientId = selected?.clientId ?? tenantId ?? null;
    if (!inferredClientId) {
      showToast("Selecione um cliente válido para embarcar.", "warning");
      return;
    }
    setEmbarkSending(true);
    try {
      const response = await api.post(API_ROUTES.itineraryEmbark, {
        vehicleIds: selectedEditorEmbarkVehicleIds,
        itineraryIds,
        clientId: inferredClientId ?? undefined,
        xdmBufferMeters: editorEmbarkBufferMeters,
      });
      const summary = response?.data?.data?.summary || response?.data?.summary || null;
      const okCount = Number(summary?.success || 0);
      const failedCount = Number(summary?.failed || 0);
      if (failedCount > 0) {
        showToast(`Embarque concluído com ${okCount} sucesso(s) e ${failedCount} falha(s).`, "warning");
        setEditorEmbarkSummary(`Resultado: ${okCount} enviados, ${failedCount} falharam.`);
      } else {
        showToast("Embarque enviado com sucesso.");
        setEditorEmbarkSummary("Embarque enviado com sucesso.");
      }
      await loadHistory();
    } catch (error) {
      console.error(error);
      showToast(resolveEmbarkErrorMessage(error), "warning");
    } finally {
      setEmbarkSending(false);
    }
  };

  const handleEditorDisembarkSubmit = async () => {
    const itineraryId = selectedId;
    if (!itineraryId) {
      showToast("Salve o itinerário antes de desembarcar.", "warning");
      return;
    }
    const itineraryIds =
      selectedEditorDisembarkItineraryIds.length > 0
        ? selectedEditorDisembarkItineraryIds
        : [String(itineraryId)];
    const validationMessage = resolveSelectionValidation({
      hasVehicles: selectedEditorDisembarkVehicleIds.length > 0,
      hasItineraries: itineraryIds.length > 0,
    });
    if (validationMessage) {
      showToast(validationMessage, "warning");
      return;
    }
    const inferredClientId = selected?.clientId ?? tenantId ?? null;
    if (!inferredClientId) {
      showToast("Selecione um cliente válido para desembarcar.", "warning");
      return;
    }
    setDisembarkSending(true);
    try {
      const response = await api.post(API_ROUTES.itineraryDisembarkBatch, {
        vehicleIds: selectedEditorDisembarkVehicleIds,
        itineraryIds,
        clientId: inferredClientId ?? undefined,
        options: {
          cleanup: {
            deleteGeozoneGroup: editorCleanupDeleteGroup,
            deleteGeozones: editorCleanupDeleteGeozones,
          },
        },
      });
      const summary = response?.data?.data?.summary || response?.data?.summary || null;
      const okCount = Number(summary?.success || 0);
      const failedCount = Number(summary?.failed || 0);
      if (failedCount > 0) {
        showToast(`Desembarque concluído com ${okCount} sucesso(s) e ${failedCount} falha(s).`, "warning");
        setEditorDisembarkSummary(`Resultado: ${okCount} concluídos, ${failedCount} falharam.`);
      } else {
        showToast("Desembarque enviado com sucesso.");
        setEditorDisembarkSummary("Desembarque enviado com sucesso.");
      }
      await loadHistory();
    } catch (error) {
      console.error(error);
      showToast(resolveEmbarkErrorMessage(error), "warning");
    } finally {
      setDisembarkSending(false);
    }
  };

  const handleDisembarkAndDelete = async (itineraryId) => {
    if (!itineraryId) return;
    setDeleteConflictSending(true);
    try {
      await api.post(API_ROUTES.itineraryDisembarkBatch, {
        vehicleIds: [],
        itineraryIds: [String(itineraryId)],
        clientId: tenantId ?? undefined,
        options: {
          cleanup: {
            deleteGeozoneGroup: false,
            deleteGeozones: false,
          },
        },
      });
      await api.delete(`${API_ROUTES.itineraries}/${itineraryId}`);
      setItineraries((current) => current.filter((item) => item.id !== itineraryId));
      if (selectedId === itineraryId) resetForm();
      setDeleteConflict(null);
      showToast("Itinerário desembarcado e removido.");
      if (activeTab === "veiculos") {
        await loadEmbarkDetails();
      }
    } catch (error) {
      console.error(error);
      showToast(resolveApiError(error, "Não foi possível desembarcar e excluir."), "warning");
    } finally {
      setDeleteConflictSending(false);
    }
  };

  const tableColCount = 8;
  const historyColCount = 11;

  return (
    <div className="flex min-h-[calc(100vh-180px)] flex-col gap-6">
      {toast && (
        <div
          className={
            "fixed right-4 top-4 z-50 rounded-lg border px-4 py-3 text-sm shadow-lg " +
            (toast.type === "warning"
              ? "border-amber-500/40 bg-amber-500/20 text-amber-50"
              : "border-emerald-500/40 bg-emerald-500/20 text-emerald-50")
          }
        >
          <div className="flex items-center gap-3">
            <span>{toast.message}</span>
            {toast.action && (
              <button
                type="button"
                onClick={() => {
                  const action = toast.action;
                  setToast(null);
                  if (toastTimeoutRef.current) {
                    clearTimeout(toastTimeoutRef.current);
                  }
                  action.onClick?.();
                }}
                className="rounded-full border border-white/40 px-2 py-0.5 text-[11px] uppercase tracking-[0.12em] text-white/90 transition hover:border-white/70"
              >
                {toast.action.label}
              </button>
            )}
          </div>
        </div>
      )}

      {deleteConflict && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4 py-6">
          <div className="w-full max-w-md rounded-2xl border border-white/10 bg-[#0f141c] p-5 shadow-2xl">
            <p className="text-xs uppercase tracking-[0.12em] text-white/50">Conflito ao excluir</p>
            <h3 className="mt-2 text-lg font-semibold text-white">Há dispositivos embarcados</h3>
            <p className="mt-2 text-sm text-white/60">
              O itinerário <span className="font-semibold text-white">{deleteConflict.name}</span> ainda possui veículos embarcados.
            </p>
            <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setDeleteConflict(null)}
                disabled={deleteConflictSending}
              >
                Cancelar
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  const { id } = deleteConflict;
                  setDeleteConflict(null);
                  openDisembarkModal(id);
                }}
                disabled={deleteConflictSending}
              >
                Abrir desembarque
              </Button>
              <Button
                size="sm"
                onClick={() => handleDisembarkAndDelete(deleteConflict.id)}
                disabled={deleteConflictSending}
              >
                {deleteConflictSending ? "Processando..." : "Desembarcar e excluir"}
              </Button>
            </div>
          </div>
        </div>
      )}

      <div className="space-y-4">
        <PageHeader
          title="Embarcar Itinerários"
          description="Agrupadores de cercas, rotas e alvos para o mesmo cliente."
          right={(
            <>
              <span className="map-status-pill">
                <span className="dot" />
                {itineraries.length} itinerários
              </span>
              {loading && <span className="map-status-pill border-primary/50 bg-primary/10 text-cyan-100">Carregando...</span>}
              <div className="flex items-center gap-2">
                <Button size="sm" variant="secondary" onClick={() => openEmbarkModal()}>
                  Embarcar
                </Button>
                <Button size="sm" variant="secondary" onClick={() => openDisembarkModal()}>
                  Desembarcar
                </Button>
                <Button size="sm" onClick={() => openEditor(null)} icon={Plus}>
                  Criar novo
                </Button>
              </div>
            </>
          )}
        />
        <div className="flex flex-wrap gap-2 text-[11px] uppercase tracking-[0.1em] text-white/60">
          {[
            { key: "embarcado", label: "Embarcado" },
            { key: "historico", label: "Histórico" },
            { key: "veiculos", label: "Veículos" },
          ].map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`rounded-md px-3 py-2 transition ${
                activeTab === tab.key
                  ? "border border-primary/40 bg-primary/20 text-white"
                  : "border border-transparent hover:border-white/20"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="w-full md:max-w-xs">
            <Input
              placeholder={
                activeTab === "historico"
                  ? "Buscar histórico"
                  : activeTab === "veiculos"
                    ? "Buscar veículo"
                    : "Buscar itinerário"
              }
              value={activeTab === "veiculos" ? embarkDetailsQuery : query}
              onChange={(event) => {
                const value = event.target.value;
                if (activeTab === "veiculos") {
                  setEmbarkDetailsQuery(value);
                } else {
                  setQuery(value);
                }
              }}
            />
          </div>
        </div>
      </div>

      {activeTab === "embarcado" && (
        <div className="flex-1 border border-white/10 bg-transparent">
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm text-white/80">
              <thead className="sticky top-0 bg-white/5 text-xs uppercase tracking-wide text-white/60 backdrop-blur">
                <tr>
                  <th className="px-4 py-3 text-left">Nome</th>
                  <th className="px-4 py-3 text-left">Cliente</th>
                  <th className="px-4 py-3 text-left">Cercas</th>
                  <th className="px-4 py-3 text-left">Rotas</th>
                  <th className="px-4 py-3 text-left">Alvos</th>
                  <th className="px-4 py-3 text-left">Tamanho do arquivo</th>
                  <th className="px-4 py-3 text-left">Último embarque</th>
                  <th className="px-4 py-3 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {loading && (
                  <tr>
                    <td colSpan={tableColCount} className="px-4 py-6 text-center text-white/60">
                      Carregando itinerários…
                    </td>
                  </tr>
                )}
                {!loading && filteredItineraries.length === 0 && (
                  <tr>
                    <td colSpan={tableColCount} className="px-4 py-10 text-center text-white/60">
                      <div className="space-y-2">
                        <p className="text-sm font-semibold text-white">Nenhum itinerário encontrado</p>
                        <p className="text-xs text-white/60">Ajuste a busca ou crie um novo itinerário.</p>
                        <div className="flex justify-center gap-2 text-xs">
                          <Button
                            variant="ghost"
                            className="inline-flex items-center gap-2"
                            onClick={() => setQuery("")}
                          >
                            Limpar busca
                          </Button>
                          <Button className="inline-flex items-center gap-2" onClick={() => openEditor(null)}>
                            <Plus className="h-4 w-4" />
                            Criar novo
                          </Button>
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
                {!loading &&
                  filteredItineraries.map((item) => {
                    const items = item.items || [];
                    const geofenceCount = items.filter((entry) => entry.type === "geofence").length;
                    const routeCount = items.filter((entry) => entry.type === "route").length;
                    const targetCount = items.filter((entry) => entry.type === "target").length;
                    const lastEmbark = resolveLastEmbark(item);
                    const lastEmbarkLabel = lastEmbark
                      ? `${lastEmbark.vehicleName || lastEmbark.plate || "Veículo"} · ${formatDateTime(lastEmbark.embarkedAt || lastEmbark.at)}`
                      : "—";
                    return (
                      <tr key={item.id}>
                        <td className="px-4 py-3 font-semibold text-white">{item.name}</td>
                        <td className="px-4 py-3">{clientNameById.get(String(item.clientId)) || item.clientId || "—"}</td>
                        <td className="px-4 py-3">{geofenceCount}</td>
                        <td className="px-4 py-3">{routeCount}</td>
                        <td className="px-4 py-3">{targetCount}</td>
                        <td className="px-4 py-3">{formatBytes(kmlSizes.get(item.id))}</td>
                        <td className="px-4 py-3">{lastEmbarkLabel}</td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex flex-wrap justify-end gap-2">
                            <Button size="xs" variant="secondary" onClick={() => setDetailItinerary(item)} icon={MapIcon}>
                              Ver detalhes
                            </Button>
                            <Button size="xs" variant="secondary" onClick={() => exportKml(item.id)} icon={Download}>
                              Exportar KML
                            </Button>
                            <Button size="xs" variant="ghost" onClick={() => openEditor(item)} icon={Pencil}>
                              Editar
                            </Button>
                            <Button size="xs" variant="ghost" onClick={() => handleDelete(item.id)} icon={Trash2}>
                              Excluir
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === "historico" && (
        <div className="flex-1 border border-white/10 bg-transparent">
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm text-white/80">
              <thead className="sticky top-0 bg-white/5 text-xs uppercase tracking-wide text-white/60 backdrop-blur">
                <tr>
                  <th className="px-4 py-3 text-left">Data e hora (Envio)</th>
                  <th className="px-4 py-3 text-left">Data e hora (Recebido)</th>
                  <th className="px-4 py-3 text-left">Usuário</th>
                  <th className="px-4 py-3 text-left">Placa</th>
                  <th className="px-4 py-3 text-left">Marca</th>
                  <th className="px-4 py-3 text-left">Modelo</th>
                  <th className="px-4 py-3 text-left">Nome do itinerário</th>
                  <th className="px-4 py-3 text-left">Ação</th>
                  <th className="px-4 py-3 text-left">Status</th>
                  <th className="px-4 py-3 text-left">Mensagem</th>
                  <th className="px-4 py-3 text-left">Detalhes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {historyLoading && (
                  <tr>
                    <td colSpan={historyColCount} className="px-4 py-6 text-center text-white/60">
                      Carregando histórico…
                    </td>
                  </tr>
                )}
                {!historyLoading && paginatedHistory.length === 0 && (
                  <tr>
                    <td colSpan={historyColCount} className="px-4 py-10 text-center text-white/60">
                      Nenhum embarque encontrado.
                    </td>
                  </tr>
                )}
                {!historyLoading &&
                  paginatedHistory.map((entry) => (
                    <tr key={entry.id}>
                      <td className="px-4 py-3">{formatDateTime(entry.sentAt || entry.at)}</td>
                      <td className="px-4 py-3">{formatDateTime(entry.receivedAt)}</td>
                      <td className="px-4 py-3">{entry.sentByName || entry.sentBy || "—"}</td>
                      <td className="px-4 py-3">{entry.plate || "—"}</td>
                      <td className="px-4 py-3">{entry.brand || "—"}</td>
                      <td className="px-4 py-3">{entry.model || "—"}</td>
                      <td className="px-4 py-3">{entry.itineraryName || "—"}</td>
                      <td className="px-4 py-3">{entry.actionLabel || "—"}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${resolveStatusBadgeClass(entry.statusLabel || entry.status)}`}>
                          {entry.statusLabel || entry.status || "—"}
                        </span>
                      </td>
                      <td className="px-4 py-3">{entry.message || entry.result || "—"}</td>
                      <td className="px-4 py-3">
                        {entry.details ? (
                          <details className="text-xs text-white/70">
                            <summary className="cursor-pointer text-white/80">Ver detalhes</summary>
                            <div className="mt-2 whitespace-pre-wrap text-white/60">{entry.details}</div>
                          </details>
                        ) : (
                          <span className="text-white/50">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between border-t border-white/10 px-4 py-3 text-xs text-white/60">
            <span>
              Página {safeHistoryPage} de {historyTotalPages}
            </span>
            <div className="flex items-center gap-2">
              <Button size="xs" variant="ghost" onClick={() => setHistoryPage(1)} disabled={safeHistoryPage === 1}>
                Primeiro
              </Button>
              <Button
                size="xs"
                variant="ghost"
                onClick={() => setHistoryPage((page) => Math.max(1, page - 1))}
                disabled={safeHistoryPage === 1}
              >
                Anterior
              </Button>
              <Button
                size="xs"
                variant="ghost"
                onClick={() => setHistoryPage((page) => Math.min(historyTotalPages, page + 1))}
                disabled={safeHistoryPage === historyTotalPages}
              >
                Próxima
              </Button>
              <Button
                size="xs"
                variant="ghost"
                onClick={() => setHistoryPage(historyTotalPages)}
                disabled={safeHistoryPage === historyTotalPages}
              >
                Última
              </Button>
            </div>
          </div>
        </div>
      )}

      {activeTab === "veiculos" && (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
          <div className="border border-white/10 bg-transparent p-4">
            <div className="mb-3 flex items-center justify-between">
              <p className="text-sm font-semibold text-white">Veículos monitorados</p>
              <span className="text-[11px] text-white/60">{filteredEmbarkDetails.length} resultados</span>
            </div>
            <div className="max-h-[560px] space-y-2 overflow-y-auto">
              {embarkDetailsLoading && <p className="text-xs text-white/60">Carregando veículos…</p>}
              {!embarkDetailsLoading && filteredEmbarkDetails.length === 0 && (
                <p className="text-xs text-white/60">Nenhum veículo encontrado.</p>
              )}
              {!embarkDetailsLoading &&
                filteredEmbarkDetails.map((detail) => {
                  const isSelected = String(detail.vehicleId) === String(selectedEmbarkDetailVehicleId);
                  return (
                    <button
                      key={detail.vehicleId}
                      type="button"
                      onClick={() => setSelectedEmbarkDetailVehicleId(detail.vehicleId)}
                      className={`flex w-full flex-col gap-1 rounded-xl border px-3 py-2 text-left transition ${
                        isSelected ? "border-primary/40 bg-primary/10 text-white" : "border-white/10 bg-white/5 text-white/80 hover:border-white/30"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-semibold">{detail.vehicleName || "Veículo"}</p>
                        <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold ${resolveStatusBadgeClass(detail.statusLabel || detail.status)}`}>
                          {detail.statusLabel || detail.status || "Sem status"}
                        </span>
                      </div>
                      <p className="text-xs text-white/60">{detail.plate || "Placa não informada"}</p>
                      <p className="text-xs text-white/50">
                        {detail.itineraryName ? `Itinerário: ${detail.itineraryName}` : "Sem itinerário embarcado (XDM)"}
                      </p>
                    </button>
                  );
                })}
            </div>
          </div>

          <div className="border border-white/10 bg-transparent p-5">
            {embarkDetailsLoading && <p className="text-sm text-white/60">Carregando detalhes…</p>}
            {!embarkDetailsLoading && !selectedEmbarkDetail && (
              <p className="text-sm text-white/60">Selecione um veículo para visualizar os detalhes do embarque.</p>
            )}
            {!embarkDetailsLoading && selectedEmbarkDetail && (
              <div className="space-y-6">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-xs uppercase tracking-[0.12em] text-white/50">Detalhes do embarque</p>
                    <h3 className="text-xl font-semibold text-white">
                      {selectedEmbarkDetail.vehicleName || "Veículo"}
                    </h3>
                    <p className="text-sm text-white/60">{selectedEmbarkDetail.plate || "Placa não informada"}</p>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/70">
                    <div className="flex items-center gap-2">
                      <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold ${resolveStatusBadgeClass(selectedEmbarkDetail.statusLabel || selectedEmbarkDetail.status)}`}>
                        {selectedEmbarkDetail.statusLabel || selectedEmbarkDetail.status || "Sem status"}
                      </span>
                      <span>
                        Última atualização: {formatDateTime(selectedEmbarkDetail.lastActionAt || selectedEmbarkDetail.updatedAt)}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2 text-[11px] uppercase tracking-[0.1em] text-white/60">
                  {[
                    { key: "detalhes", label: "Detalhes do embarque" },
                    { key: "historico", label: "Histórico do veículo" },
                  ].map((tab) => (
                    <button
                      key={tab.key}
                      onClick={() => setVehicleDetailTab(tab.key)}
                      className={`rounded-md px-3 py-2 transition ${
                        vehicleDetailTab === tab.key
                          ? "border border-primary/40 bg-primary/20 text-white"
                          : "border border-transparent hover:border-white/20"
                      }`}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>

                {vehicleDetailTab === "detalhes" && (
                  <>
                    <div className="grid gap-4 md:grid-cols-2">
                      <div className="rounded-xl border border-white/10 bg-black/30 p-4 text-sm text-white/70">
                        <p className="text-[11px] uppercase tracking-[0.12em] text-white/50">Itinerário embarcado</p>
                        <p className="text-base font-semibold text-white">
                          {selectedEmbarkDetail.itineraryName || "Nenhum itinerário embarcado (XDM)"}
                        </p>
                        {selectedEmbarkDetail.itineraryDescription && (
                          <p className="mt-2 text-xs text-white/60">{selectedEmbarkDetail.itineraryDescription}</p>
                        )}
                        {selectedEmbarkDetail.xdmError && (
                          <p className="mt-2 text-xs text-red-200">{selectedEmbarkDetail.xdmError}</p>
                        )}
                      </div>
                      <div className="rounded-xl border border-white/10 bg-black/30 p-4 text-sm text-white/70">
                        <p className="text-[11px] uppercase tracking-[0.12em] text-white/50">Último embarque</p>
                        <p className="text-base font-semibold text-white">
                          {formatDateTime(selectedEmbarkDetail.lastEmbarkAt || selectedEmbarkDetail.lastActionAt)}
                        </p>
                        <p className="mt-2 text-xs text-white/60">{selectedEmbarkDetail.lastActionLabel || "—"}</p>
                      </div>
                    </div>

                    <div className="grid gap-4 md:grid-cols-3">
                      {["itinerary", "targets", "entry"].map((role) => (
                        <div key={role} className="rounded-xl border border-white/10 bg-black/30 p-4 text-xs text-white/70">
                          <p className="text-[11px] uppercase tracking-[0.12em] text-white/50">
                            Grupo {role === "itinerary" ? "itinerário" : role === "targets" ? "alvos" : "entrada"}
                          </p>
                          <p className="mt-1 text-sm font-semibold text-white">
                            {selectedEmbarkDetail.xdmGroups?.[role]?.id || "Não aplicado"}
                          </p>
                          {selectedEmbarkDetail.xdmGroups?.[role]?.itineraryId && (
                            <p className="mt-1 text-[11px] text-white/60">
                              Itinerário vinculado: {selectedEmbarkDetail.xdmGroups?.[role]?.itineraryId}
                            </p>
                          )}
                        </div>
                      ))}
                    </div>

                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-semibold text-white">Itens embarcados</p>
                        <span className="text-xs text-white/60">
                          {selectedEmbarkDetail.items?.length || 0} itens
                        </span>
                      </div>
                      {selectedEmbarkDetail.items?.length ? (
                        <div className="grid gap-3 md:grid-cols-2">
                          {selectedEmbarkDetail.items.map((item) => {
                            const previewSrc = item.previewUrl
                              ? item.previewUrl
                              : item.previewSvg
                                ? `data:image/svg+xml;utf8,${encodeURIComponent(item.previewSvg)}`
                                : null;
                            return (
                              <div key={`${item.type}-${item.id}`} className="rounded-xl border border-white/10 bg-black/30 p-3">
                                <div className="flex gap-3">
                                  <div className="h-20 w-28 overflow-hidden rounded-lg border border-white/10 bg-white/5">
                                    {previewSrc ? (
                                      <img src={previewSrc} alt={`Preview ${item.name}`} className="h-full w-full object-cover" />
                                    ) : (
                                      <div className="flex h-full w-full items-center justify-center text-[10px] uppercase tracking-[0.12em] text-white/40">
                                        Sem preview
                                      </div>
                                    )}
                                  </div>
                                  <div className="flex-1">
                                    <p className="text-sm font-semibold text-white">{item.name || "Item"}</p>
                                    <p className="text-xs text-white/60">{item.typeLabel || item.type || "—"}</p>
                                    <div className="mt-2 grid gap-2 text-xs text-white/60 sm:grid-cols-2">
                                      <div>
                                        <p className="text-[10px] uppercase tracking-[0.12em] text-white/40">Tamanho</p>
                                        <p>{formatBytes(item.sizeBytes)}</p>
                                      </div>
                                      <div>
                                        <p className="text-[10px] uppercase tracking-[0.12em] text-white/40">Último embarque</p>
                                        <p>{formatDateTime(item.lastEmbarkAt || selectedEmbarkDetail.lastEmbarkAt)}</p>
                                      </div>
                                      <div>
                                        <p className="text-[10px] uppercase tracking-[0.12em] text-white/40">Status</p>
                                        <p>{item.statusLabel || selectedEmbarkDetail.statusLabel || "—"}</p>
                                      </div>
                                    </div>
                                    <div className="mt-3">
                                      <Button size="xs" variant="ghost" onClick={() => openItemMapPreview(item)} icon={MapIcon}>
                                        Ver no mapa (Híbrido)
                                      </Button>
                                    </div>
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <p className="text-xs text-white/60">Nenhum item embarcado para este veículo.</p>
                      )}
                    </div>
                  </>
                )}

                {vehicleDetailTab === "historico" && (
                  <div className="rounded-2xl border border-white/10 bg-black/30">
                    <div className="overflow-x-auto">
                      <table className="min-w-full text-xs text-white/70">
                        <thead className="bg-white/5 text-[11px] uppercase tracking-wide text-white/60">
                          <tr>
                            <th className="px-3 py-2 text-left">Envio</th>
                            <th className="px-3 py-2 text-left">Recebido</th>
                            <th className="px-3 py-2 text-left">Ação</th>
                            <th className="px-3 py-2 text-left">Status</th>
                            <th className="px-3 py-2 text-left">Detalhes</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-white/5">
                          {vehicleHistoryLoading && (
                            <tr>
                              <td colSpan={5} className="px-3 py-4 text-center text-white/60">
                                Carregando histórico…
                              </td>
                            </tr>
                          )}
                          {!vehicleHistoryLoading && vehicleHistory.length === 0 && (
                            <tr>
                              <td colSpan={5} className="px-3 py-4 text-center text-white/60">
                                Nenhum histórico disponível.
                              </td>
                            </tr>
                          )}
                          {!vehicleHistoryLoading &&
                            vehicleHistory.map((entry) => (
                              <tr key={entry.id}>
                                <td className="px-3 py-2">{formatDateTime(entry.sentAt)}</td>
                                <td className="px-3 py-2">{formatDateTime(entry.receivedAt)}</td>
                                <td className="px-3 py-2">{entry.actionLabel || "—"}</td>
                                <td className="px-3 py-2">
                                  <span
                                    className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold ${resolveStatusBadgeClass(
                                      entry.statusLabel || entry.status,
                                    )}`}
                                  >
                                    {entry.statusLabel || entry.status || "—"}
                                  </span>
                                </td>
                                <td className="px-3 py-2">
                                  {entry.details ? (
                                    <details className="text-[11px] text-white/70">
                                      <summary className="cursor-pointer text-white/80">Ver detalhes</summary>
                                      <div className="mt-2 whitespace-pre-wrap text-white/60">{entry.details}</div>
                                    </details>
                                  ) : (
                                    <span className="text-white/50">—</span>
                                  )}
                                </td>
                              </tr>
                            ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      <ItineraryDetailModal
        open={Boolean(detailItinerary)}
        itinerary={detailItinerary}
        items={detailItems}
        onClose={() => setDetailItinerary(null)}
        onExportKml={exportKml}
        onOpenMap={openItemMapPreview}
      />

      <MapPreviewModal
        open={Boolean(mapPreview)}
        title={mapPreview?.title || "Mapa"}
        items={mapPreview?.items || []}
        onClose={() => setMapPreview(null)}
      />

      <ItineraryModal
        open={editorOpen}
        onClose={() => {
          setEditorOpen(false);
          setPostSavePrompt(null);
          resetEditorEmbarkForm();
          resetEditorDisembarkForm();
        }}
        title={selected ? "Editar itinerário" : "Novo itinerário"}
        description="Organize cercas, rotas e alvos existentes em um agrupador."
        saving={saving}
        onSave={handleSave}
        onDelete={selected ? () => handleDelete(selected.id) : null}
        form={form}
        onChange={handleFormChange}
        postSavePrompt={postSavePrompt}
        onEmbarkNow={() => {
          const itineraryId = postSavePrompt?.id || selectedId;
          if (!itineraryId) return;
          setPostSavePrompt(null);
          setEditorOpen(false);
          openEmbarkModal(itineraryId);
        }}
        onContinueEditing={() => setPostSavePrompt(null)}
        onClosePrompt={() => {
          setPostSavePrompt(null);
          setEditorOpen(false);
        }}
        activeTab={editorTab}
        onTabChange={setEditorTab}
        geofences={geofences}
        routes={routes}
        targetGeofences={targetGeofences}
        onLinkItem={handleLinkItem}
        onRemoveItem={handleRemoveItem}
        vehicles={vehicles}
        itineraries={itineraries}
        embarkState={{
          vehicleQuery: editorEmbarkVehicleQuery,
          onVehicleQueryChange: setEditorEmbarkVehicleQuery,
          itineraryQuery: editorEmbarkItineraryQuery,
          onItineraryQueryChange: setEditorEmbarkItineraryQuery,
          bufferMeters: editorEmbarkBufferMeters,
          onBufferMetersChange: setEditorEmbarkBufferMeters,
          selectedVehicleIds: selectedEditorEmbarkVehicleIds,
          onToggleVehicle: handleToggleEditorEmbarkVehicle,
          selectedItineraryIds: selectedEditorEmbarkItineraryIds,
          onToggleItinerary: handleToggleEditorEmbarkItinerary,
          onRemoveVehicle: handleRemoveEditorEmbarkVehicle,
          resultSummary: editorEmbarkSummary,
          sending: embarkSending,
        }}
        disembarkState={{
          vehicleQuery: editorDisembarkVehicleQuery,
          onVehicleQueryChange: setEditorDisembarkVehicleQuery,
          itineraryQuery: editorDisembarkItineraryQuery,
          onItineraryQueryChange: setEditorDisembarkItineraryQuery,
          selectedVehicleIds: selectedEditorDisembarkVehicleIds,
          onToggleVehicle: handleToggleEditorDisembarkVehicle,
          onRemoveVehicle: handleRemoveEditorDisembarkVehicle,
          selectedItineraryIds: selectedEditorDisembarkItineraryIds,
          onToggleItinerary: handleToggleEditorDisembarkItinerary,
          cleanupDeleteGroup: editorCleanupDeleteGroup,
          onCleanupDeleteGroupChange: setEditorCleanupDeleteGroup,
          cleanupDeleteGeozones: editorCleanupDeleteGeozones,
          onCleanupDeleteGeozonesChange: setEditorCleanupDeleteGeozones,
          resultSummary: editorDisembarkSummary,
          sending: disembarkSending,
        }}
        onEmbarkSubmit={handleEditorEmbarkSubmit}
        onDisembarkSubmit={handleEditorDisembarkSubmit}
      />

      <EmbarkModal
        open={embarkOpen}
        onClose={() => {
          setEmbarkOpen(false);
          resetEmbarkForm();
        }}
        vehicles={vehicles}
        itineraries={itineraries}
        vehicleQuery={embarkVehicleQuery}
        onVehicleQueryChange={setEmbarkVehicleQuery}
        itineraryQuery={embarkItineraryQuery}
        onItineraryQueryChange={setEmbarkItineraryQuery}
        bufferMeters={embarkBufferMeters}
        onBufferMetersChange={setEmbarkBufferMeters}
        selectedVehicleIds={selectedEmbarkVehicleIds}
        onToggleVehicle={handleToggleVehicle}
        onRemoveVehicle={handleRemoveVehicle}
        selectedItineraryIds={selectedEmbarkItineraryIds}
        onToggleItinerary={handleToggleItinerary}
        sending={embarkSending}
        onSubmit={handleEmbarkSubmit}
        resultSummary={embarkSummary}
        technicalDetails={embarkErrorDetails}
      />

      <DisembarkModal
        open={disembarkOpen}
        onClose={() => {
          setDisembarkOpen(false);
          resetDisembarkForm();
        }}
        vehicles={vehicles}
        itineraries={itineraries}
        vehicleQuery={disembarkVehicleQuery}
        onVehicleQueryChange={setDisembarkVehicleQuery}
        itineraryQuery={disembarkItineraryQuery}
        onItineraryQueryChange={setDisembarkItineraryQuery}
        selectedVehicleIds={selectedDisembarkVehicleIds}
        onToggleVehicle={handleToggleDisembarkVehicle}
        onRemoveVehicle={handleRemoveDisembarkVehicle}
        selectedItineraryIds={selectedDisembarkItineraryIds}
        onToggleItinerary={handleToggleDisembarkItinerary}
        cleanupDeleteGroup={cleanupDeleteGroup}
        onCleanupDeleteGroupChange={setCleanupDeleteGroup}
        cleanupDeleteGeozones={cleanupDeleteGeozones}
        onCleanupDeleteGeozonesChange={setCleanupDeleteGeozones}
        sending={disembarkSending}
        onSubmit={handleDisembarkSubmit}
        resultSummary={disembarkSummary}
        technicalDetails={disembarkErrorDetails}
      />
    </div>
  );
}
