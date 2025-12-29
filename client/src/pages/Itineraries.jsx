import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Circle as LeafletCircle, MapContainer, Marker, Polygon, Polyline, TileLayer, Tooltip } from "react-leaflet";
import { Download, Eye, EyeOff, Map as MapIcon, Plus, Route, Save, Target, Trash, X } from "lucide-react";
import "leaflet/dist/leaflet.css";

import useGeofences from "../lib/hooks/useGeofences.js";
import useVehicles from "../lib/hooks/useVehicles.js";
import api from "../lib/api.js";
import { API_ROUTES } from "../lib/api-routes.js";
import useMapLifecycle from "../lib/map/useMapLifecycle.js";
import Button from "../ui/Button";
import Input from "../ui/Input";
import LTextArea from "../ui/LTextArea.jsx";

const DEFAULT_CENTER = [-23.55052, -46.633308];

const circleStyle = {
  color: "#38bdf8",
  weight: 2,
  fillOpacity: 0.12,
};

const polygonStyle = {
  color: "#22c55e",
  weight: 2,
  fillOpacity: 0.12,
};

function Drawer({ open, onClose, title, description, children }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[9998] flex">
      <div className="flex-1 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative h-full w-full max-w-3xl border-l border-white/10 bg-[#0f141c] shadow-3xl">
        <div className="flex items-start justify-between gap-4 border-b border-white/10 px-6 py-5">
          <div>
            <p className="text-xs uppercase tracking-[0.12em] text-white/50">Editor de itinerários</p>
            <h2 className="text-xl font-semibold text-white">{title}</h2>
            {description && <p className="text-sm text-white/60">{description}</p>}
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
        <div className="h-[calc(100%-80px)] overflow-y-auto px-6 py-4">{children}</div>
      </div>
    </div>
  );
}

export default function Itineraries() {
  const mapRef = useRef(null);
  const { onMapReady } = useMapLifecycle({ mapRef });
  const { geofences } = useGeofences({ autoRefreshMs: 0 });
  // Alvos: usamos veículos existentes como referência para o agrupador (não cria novas entidades).
  const { vehicles } = useVehicles({ includeUnlinked: true });
  const [routes, setRoutes] = useState([]);
  const [itineraries, setItineraries] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [form, setForm] = useState({ name: "", description: "", items: [] });
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [visibleIds, setVisibleIds] = useState(new Set());
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerTab, setDrawerTab] = useState("cercas");

  const selected = useMemo(() => itineraries.find((item) => item.id === selectedId) || null, [itineraries, selectedId]);
  const activeItems = useMemo(
    () => (drawerOpen ? form.items || [] : selected?.items || []),
    [drawerOpen, form.items, selected],
  );

  const geofenceById = useMemo(() => new Map(geofences.map((geo) => [String(geo.id), geo])), [geofences]);
  const routeById = useMemo(() => new Map(routes.map((route) => [String(route.id), route])), [routes]);
  const targetById = useMemo(() => new Map(vehicles.map((vehicle) => [String(vehicle.id), vehicle])), [vehicles]);

  const loadRoutes = useCallback(async () => {
    try {
      const response = await api.get(API_ROUTES.routes);
      const list = response?.data?.routes || response?.data?.data || [];
      setRoutes(list);
    } catch (error) {
      console.error("[itineraries] Falha ao carregar rotas salvas", error);
    }
  }, []);

  const loadItineraries = useCallback(async () => {
    setLoading(true);
    try {
      const response = await api.get(API_ROUTES.itineraries);
      const list = response?.data?.data || [];
      setItineraries(list);
      if (list[0] && !selectedId) {
        setSelectedId(list[0].id);
        setForm(list[0]);
        setVisibleIds(new Set((list[0].items || []).map((item) => `${item.type}:${item.id}`)));
      }
    } finally {
      setLoading(false);
    }
  }, [selectedId]);

  useEffect(() => {
    void loadRoutes();
    void loadItineraries();
  }, [loadRoutes, loadItineraries]);

  const resetForm = () => {
    setForm({ name: "", description: "", items: [] });
    setSelectedId(null);
    setVisibleIds(new Set());
  };

  const handleToggleItem = (item) => {
    setVisibleIds((current) => {
      const key = `${item.type}:${item.id}`;
      const next = new Set(current);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const handleAddItem = (item) => {
    if (!item) return;
    setForm((current) => {
      const exists = (current.items || []).some((entry) => entry.type === item.type && String(entry.id) === String(item.id));
      if (exists) return current;
      const next = { ...current, items: [...(current.items || []), { type: item.type, id: String(item.id) }] };
      setVisibleIds((prev) => new Set([...prev, `${item.type}:${item.id}`]));
      return next;
    });
  };

  const handleRemoveItem = (item) => {
    if (!item) return;
    setForm((current) => {
      const nextItems = (current.items || []).filter(
        (entry) => !(entry.type === item.type && String(entry.id) === String(item.id)),
      );
      setVisibleIds((prev) => {
        const next = new Set(prev);
        next.delete(`${item.type}:${item.id}`);
        return next;
      });
      return { ...current, items: nextItems };
    });
  };

  const handleSave = async () => {
    if (!form.name.trim()) {
      alert("Informe um nome para o itinerário.");
      return;
    }
    setSaving(true);
    try {
      const payload = { ...form, items: form.items || [] };
      const response = selectedId
        ? await api.put(`${API_ROUTES.itineraries}/${selectedId}`, payload)
        : await api.post(API_ROUTES.itineraries, payload);
      const saved = response?.data?.data || payload;
      await loadItineraries();
      setSelectedId(saved.id || selectedId);
    } catch (error) {
      console.error(error);
      alert(error?.message || "Não foi possível salvar o itinerário.");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id) => {
    if (!id) return;
    if (!window.confirm("Remover este itinerário?")) return;
    try {
      await api.delete(`${API_ROUTES.itineraries}/${id}`);
      setItineraries((current) => current.filter((item) => item.id !== id));
      if (selectedId === id) resetForm();
    } catch (error) {
      console.error(error);
      alert(error?.message || "Não foi possível remover.");
    }
  };

  const handleSelect = (itinerary) => {
    setSelectedId(itinerary.id);
    setForm(itinerary);
    setVisibleIds(new Set((itinerary.items || []).map((item) => `${item.type}:${item.id}`)));
    setDrawerOpen(true);
  };

  const handleCreateNew = () => {
    resetForm();
    setDrawerTab("cercas");
    setDrawerOpen(true);
  };

  const selectedGeofences = useMemo(() => {
    return activeItems
      .filter((item) => item.type === "geofence")
      .map((item) => geofenceById.get(String(item.id)))
      .filter(Boolean);
  }, [activeItems, geofenceById]);

  const selectedRoutes = useMemo(() => {
    return activeItems
      .filter((item) => item.type === "route")
      .map((item) => routeById.get(String(item.id)))
      .filter(Boolean);
  }, [activeItems, routeById]);

  const selectedTargets = useMemo(() => {
    return activeItems
      .filter((item) => item.type === "target")
      .map((item) => targetById.get(String(item.id)))
      .filter(Boolean);
  }, [activeItems, targetById]);

  const exportKml = async (id) => {
    const target = id || selectedId;
    if (!target) return;
    try {
      const response = await api.get(`${API_ROUTES.itineraries}/${target}/export/kml`, { responseType: "blob" });
      const blob = new Blob([response.data], { type: "application/vnd.google-earth.kml+xml" });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "itinerary.kml";
      a.click();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error(error);
      alert(error?.message || "Não foi possível exportar o KML.");
    }
  };

  const center = useMemo(() => {
    if (selectedGeofences[0]?.center) return selectedGeofences[0].center;
    if (selectedRoutes[0]?.points?.[0]) return selectedRoutes[0].points[0];
    return DEFAULT_CENTER;
  }, [selectedGeofences, selectedRoutes]);

  const resolveTargetPosition = useCallback((target) => {
    if (!target) return null;
    const position = target.position || target.device?.position || null;
    const lat = position?.latitude ?? position?.lat ?? target.lat;
    const lng = position?.longitude ?? position?.lon ?? target.lng;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return [lat, lng];
  }, []);

  return (
    <div className="mx-auto w-full max-w-6xl space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-[0.1em] text-white/60">Itinerários</p>
          <h1 className="text-lg font-semibold text-white">Agrupadores de cercas, rotas e alvos</h1>
          <p className="text-xs text-white/70">Organize entidades existentes sem criar novos itens.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <span className="map-status-pill">
            <span className="dot" />
            {itineraries.length} itinerários
          </span>
          {saving && <span className="map-status-pill border-primary/50 bg-primary/10 text-cyan-100">Salvando...</span>}
          {loading && <span className="map-status-pill border-primary/50 bg-primary/10 text-cyan-100">Carregando...</span>}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
        <div className="rounded-xl border border-white/10 bg-white/5 p-4">
          <div className="flex items-center justify-between gap-2">
            <div>
              <p className="text-[11px] uppercase tracking-[0.1em] text-white/60">Lista</p>
              <h2 className="text-base font-semibold text-white">Itinerários</h2>
            </div>
            <Button size="sm" onClick={handleCreateNew} icon={Plus}>
              Criar novo
            </Button>
          </div>
          <div className="mt-3 space-y-2">
            {itineraries.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => handleSelect(item)}
                className={`w-full rounded-xl border px-3 py-2 text-left text-sm transition ${
                  selectedId === item.id ? "border-primary/50 bg-primary/10 text-white" : "border-white/10 bg-white/5 text-white/80 hover:border-white/20"
                }`}
              >
                <div className="flex items-center justify-between">
                  <p className="font-semibold text-white">{item.name}</p>
                  <span className="text-[11px] text-white/60">{new Date(item.updatedAt || item.createdAt || Date.now()).toLocaleDateString()}</span>
                </div>
                <p className="text-[11px] text-white/60">{item.items?.length || 0} itens</p>
              </button>
            ))}
            {itineraries.length === 0 && <p className="text-xs text-white/60">Nenhum itinerário salvo.</p>}
          </div>
        </div>

        <div className="overflow-hidden rounded-xl border border-white/10 bg-[#0f141c]">
          <MapContainer
            ref={mapRef}
            center={center}
            zoom={13}
            className="h-[540px] w-full"
            whenReady={onMapReady}
          >
            <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="OpenStreetMap" />

            {selectedGeofences.map((geo) => {
              const key = `geofence:${geo.id}`;
              const visible = visibleIds.has(key);
              if (geo.type === "circle") {
                if (!geo.latitude || !geo.longitude || !geo.radius) return null;
                return (
                  visible && (
                    <LeafletCircle
                      key={key}
                      center={[geo.latitude, geo.longitude]}
                      radius={geo.radius}
                      pathOptions={{ ...circleStyle, color: geo.color || circleStyle.color }}
                    >
                      <Tooltip>{geo.name}</Tooltip>
                    </LeafletCircle>
                  )
                );
              }
              if (!geo.points?.length) return null;
              return (
                visible && (
                  <Polygon key={key} positions={geo.points} pathOptions={{ ...polygonStyle, color: geo.color || polygonStyle.color }}>
                    <Tooltip>{geo.name}</Tooltip>
                  </Polygon>
                )
              );
            })}

            {selectedRoutes.map((route) => {
              const key = `route:${route.id}`;
              const visible = visibleIds.has(key);
              return (
                visible && (
                  <Polyline key={key} positions={route.points || []} pathOptions={{ color: "#eab308", weight: 4, opacity: 0.8 }}>
                    <Tooltip>{route.name}</Tooltip>
                  </Polyline>
                )
              );
            })}

            {selectedTargets.map((target) => {
              const key = `target:${target.id}`;
              const visible = visibleIds.has(key);
              const position = resolveTargetPosition(target);
              if (!visible || !position) return null;
              return (
                <Marker key={key} position={position}>
                  <Tooltip>{target.name || target.plate || "Alvo"}</Tooltip>
                </Marker>
              );
            })}
          </MapContainer>
        </div>
      </div>

      <Drawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        title={selected ? "Editar itinerário" : "Novo itinerário"}
        description="Organize cercas, rotas e alvos existentes em um agrupador."
      >
        <div className="flex gap-2 overflow-x-auto pb-2 text-[11px] uppercase tracking-[0.1em] text-white/60">
          {[
            { key: "cercas", label: "Cercas" },
            { key: "rotas", label: "Rotas" },
            { key: "alvos", label: "Alvos" },
          ].map((tab) => (
            <button
              key={tab.key}
              onClick={() => setDrawerTab(tab.key)}
              className={`rounded-md px-3 py-2 transition ${drawerTab === tab.key ? "bg-primary/20 text-white border border-primary/40" : "border border-transparent hover:border-white/20"}`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="mt-4 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-white">{selected ? "Detalhes" : "Novo itinerário"}</h3>
            {selected && (
              <Button size="sm" variant="ghost" onClick={() => handleDelete(selected.id)} icon={Trash}>
                Excluir
              </Button>
            )}
          </div>
          <Input
            label="Nome"
            value={form.name}
            onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
          />
          <LTextArea
            label="Descrição"
            value={form.description}
            onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
            rows={3}
          />

          <div className="space-y-2 rounded-xl border border-white/10 bg-white/5 p-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-white">Itens vinculados</p>
              <div className="flex gap-2">
                <Button size="xs" variant="secondary" onClick={() => selectedId && exportKml(selectedId)} icon={Download}>
                  Exportar KML
                </Button>
                <Button size="xs" onClick={handleSave} disabled={saving} icon={Save}>
                  {saving ? "Salvando..." : "Salvar"}
                </Button>
              </div>
            </div>
            <div className="space-y-2">
              {(form.items || []).map((item) => {
                const key = `${item.type}:${item.id}`;
                const visible = visibleIds.has(key);
                const label =
                  item.type === "geofence"
                    ? geofenceById.get(String(item.id))?.name || `Cerca ${item.id}`
                    : item.type === "route"
                    ? routeById.get(String(item.id))?.name || `Rota ${item.id}`
                    : targetById.get(String(item.id))?.name || targetById.get(String(item.id))?.plate || `Alvo ${item.id}`;
                const Icon = item.type === "geofence" ? MapIcon : item.type === "route" ? Route : Target;
                return (
                  <div key={key} className="flex items-center justify-between rounded-lg border border-white/10 bg-black/20 px-2 py-1 text-sm text-white">
                    <span className="flex items-center gap-2">
                      <Icon size={14} />
                      {label}
                    </span>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        className="text-white/70 hover:text-white"
                        onClick={() => handleToggleItem(item)}
                        title={visible ? "Ocultar" : "Exibir"}
                      >
                        {visible ? <Eye size={14} /> : <EyeOff size={14} />}
                      </button>
                      <button
                        type="button"
                        className="text-white/60 hover:text-white"
                        onClick={() => handleRemoveItem(item)}
                        title="Remover"
                      >
                        <Trash size={14} />
                      </button>
                    </div>
                  </div>
                );
              })}
              {(form.items || []).length === 0 && <p className="text-xs text-white/60">Nenhum item adicionado.</p>}
            </div>
          </div>

          {drawerTab === "cercas" && (
            <div className="space-y-2 rounded-xl border border-white/10 bg-white/5 p-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-white">Cercas disponíveis</p>
                <span className="text-[11px] text-white/60">{geofences.length} disponíveis</span>
              </div>
              <div className="max-h-64 space-y-1 overflow-y-auto">
                {geofences.map((geo) => (
                  <button
                    key={geo.id}
                    type="button"
                    className="flex w-full items-center justify-between rounded-lg px-2 py-1 text-left text-sm text-white/80 hover:bg-white/5"
                    onClick={() => handleAddItem({ type: "geofence", id: geo.id })}
                  >
                    <span className="flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full" style={{ background: geo.color || "#22c55e" }} />
                      {geo.name}
                    </span>
                    <span className="text-[11px] text-white/50">{geo.type === "circle" ? "Círculo" : `${geo.points?.length || 0} pts`}</span>
                  </button>
                ))}
                {geofences.length === 0 && <p className="text-xs text-white/60">Nenhuma cerca disponível.</p>}
              </div>
            </div>
          )}

          {drawerTab === "rotas" && (
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
                    className="flex w-full items-center justify-between rounded-lg px-2 py-1 text-left text-sm text-white/80 hover:bg-white/5"
                    onClick={() => handleAddItem({ type: "route", id: route.id })}
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
          )}

          {drawerTab === "alvos" && (
            <div className="space-y-2 rounded-xl border border-white/10 bg-white/5 p-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-white">Alvos disponíveis</p>
                <span className="text-[11px] text-white/60">{vehicles.length} disponíveis</span>
              </div>
              <div className="max-h-64 space-y-1 overflow-y-auto">
                {vehicles.map((vehicle) => (
                  <button
                    key={vehicle.id}
                    type="button"
                    className="flex w-full items-center justify-between rounded-lg px-2 py-1 text-left text-sm text-white/80 hover:bg-white/5"
                    onClick={() => handleAddItem({ type: "target", id: vehicle.id })}
                  >
                    <span className="flex items-center gap-2">
                      <Target size={14} />
                      {vehicle.name || vehicle.plate || `Veículo ${vehicle.id}`}
                    </span>
                    <span className="text-[11px] text-white/50">{vehicle.plate || vehicle.identifier || ""}</span>
                  </button>
                ))}
                {vehicles.length === 0 && <p className="text-xs text-white/60">Nenhum alvo disponível.</p>}
              </div>
            </div>
          )}
        </div>
      </Drawer>
    </div>
  );
}
