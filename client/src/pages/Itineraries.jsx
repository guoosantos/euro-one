import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Circle as LeafletCircle, MapContainer, Marker, Polygon, Polyline, TileLayer, Tooltip } from "react-leaflet";
import { Download, Eye, EyeOff, Map as MapIcon, Plus, Route, Save, Trash } from "lucide-react";
import "leaflet/dist/leaflet.css";

import useGeofences from "../lib/hooks/useGeofences.js";
import api from "../lib/api.js";
import { API_ROUTES } from "../lib/api-routes.js";
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

export default function Itineraries() {
  const mapRef = useRef(null);
  const { geofences } = useGeofences({ autoRefreshMs: 0 });
  const [routes, setRoutes] = useState([]);
  const [itineraries, setItineraries] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [form, setForm] = useState({ name: "", description: "", items: [] });
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [visibleIds, setVisibleIds] = useState(new Set());

  const selected = useMemo(() => itineraries.find((item) => item.id === selectedId) || null, [itineraries, selectedId]);

  const visibleItems = useMemo(() => {
    if (!selected) return [];
    return (selected.items || []).filter((item) => visibleIds.has(`${item.type}:${item.id}`));
  }, [selected, visibleIds]);

  const geofenceById = useMemo(() => new Map(geofences.map((geo) => [String(geo.id), geo])), [geofences]);
  const routeById = useMemo(() => new Map(routes.map((route) => [String(route.id), route])), [routes]);

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
  };

  const selectedGeofences = useMemo(() => {
    if (!selected) return [];
    return (selected.items || [])
      .filter((item) => item.type === "geofence")
      .map((item) => geofenceById.get(String(item.id)))
      .filter(Boolean);
  }, [geofenceById, selected]);

  const selectedRoutes = useMemo(() => {
    if (!selected) return [];
    return (selected.items || [])
      .filter((item) => item.type === "route")
      .map((item) => routeById.get(String(item.id)))
      .filter(Boolean);
  }, [routeById, selected]);

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

  return (
    <div className="map-page">
      <div className="map-container">
        <MapContainer
          center={center}
          zoom={13}
          className="h-full w-full"
          whenCreated={(map) => {
            mapRef.current = map;
          }}
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
        </MapContainer>
      </div>

      <div className="floating-top-bar">
        <div className="flex w-full flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[11px] uppercase tracking-[0.1em] text-white/60">Itinerários</p>
            <h1 className="text-lg font-semibold text-white">Mapa como palco</h1>
            <p className="text-xs text-white/70">Agrupe cercas e rotas e visualize com toggles.</p>
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
      </div>

      <div className="floating-left-panel">
        <div className="flex items-center justify-between gap-2">
          <div>
            <p className="text-[11px] uppercase tracking-[0.1em] text-white/60">Lista</p>
            <h2 className="text-base font-semibold text-white">Itinerários</h2>
          </div>
          <Button size="sm" onClick={resetForm} icon={Plus}>
            Novo
          </Button>
        </div>
        <div className="mt-2 space-y-2">
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

      <div className="floating-right-panel">
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-white">{selected ? "Editar itinerário" : "Novo itinerário"}</h3>
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
              <p className="text-sm font-semibold text-white">Itens</p>
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
                    : routeById.get(String(item.id))?.name || `Rota ${item.id}`;
                return (
                  <div key={key} className="flex items-center justify-between rounded-lg border border-white/10 bg-black/20 px-2 py-1 text-sm text-white">
                    <span className="flex items-center gap-2">
                      {item.type === "geofence" ? <MapIcon size={14} /> : <Route size={14} />}
                      {label}
                    </span>
                    <button
                      type="button"
                      className="text-white/70 hover:text-white"
                      onClick={() => handleToggleItem(item)}
                      title={visible ? "Ocultar" : "Exibir"}
                    >
                      {visible ? <Eye size={14} /> : <EyeOff size={14} />}
                    </button>
                  </div>
                );
              })}
              {(form.items || []).length === 0 && <p className="text-xs text-white/60">Nenhum item adicionado.</p>}
            </div>
          </div>

          <div className="space-y-2 rounded-xl border border-white/10 bg-white/5 p-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-white">Adicionar cerca</p>
              <span className="text-[11px] text-white/60">{geofences.length} disponíveis</span>
            </div>
            <div className="max-h-40 space-y-1 overflow-y-auto">
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

          <div className="space-y-2 rounded-xl border border-white/10 bg-white/5 p-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-white">Adicionar rota</p>
              <span className="text-[11px] text-white/60">{routes.length} disponíveis</span>
            </div>
            <div className="max-h-40 space-y-1 overflow-y-auto">
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
        </div>
      </div>
    </div>
  );
}
