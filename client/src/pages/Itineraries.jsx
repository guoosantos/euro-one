import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Download, Map as MapIcon, Pencil, Plus, Route, Save, Target, Trash2, X } from "lucide-react";

import useGeofences from "../lib/hooks/useGeofences.js";
import api from "../lib/api.js";
import { API_ROUTES } from "../lib/api-routes.js";
import { useTenant } from "../lib/tenant-context.jsx";
import Button from "../ui/Button";
import Input from "../ui/Input";
import LTextArea from "../ui/LTextArea.jsx";
import PageHeader from "../ui/PageHeader.jsx";
import Select from "../ui/Select.jsx";

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
  panelTab,
  onTabChange,
  geofences,
  routes,
  targetGeofences,
  onAddItem,
  onRemoveItem,
}) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[9998] flex items-center justify-center bg-black/60 px-4 py-6">
      <div className="relative w-full max-w-4xl rounded-2xl border border-white/10 bg-[#0f141c] shadow-3xl">
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
        <div className="max-h-[70vh] overflow-y-auto px-6 py-5">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-white">Detalhes</h3>
              {onDelete && (
                <Button size="sm" variant="ghost" onClick={onDelete} icon={Trash2}>
                  Excluir
                </Button>
              )}
            </div>
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

            <div className="space-y-2 rounded-xl border border-white/10 bg-white/5 p-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-white">Itens vinculados</p>
                <Button size="xs" onClick={onSave} disabled={saving} icon={Save}>
                  {saving ? "Salvando..." : "Salvar"}
                </Button>
              </div>
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
                    <div key={key} className="flex items-center justify-between rounded-lg border border-white/10 bg-black/20 px-2 py-1 text-sm text-white">
                      <span className="flex items-center gap-2">
                        <Icon size={14} />
                        {label}
                      </span>
                      <button
                        type="button"
                        className="text-white/60 hover:text-white"
                        onClick={() => onRemoveItem(item)}
                        title="Remover"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  );
                })}
                {(form.items || []).length === 0 && <p className="text-xs text-white/60">Nenhum item adicionado.</p>}
              </div>
            </div>

            <div>
              <div className="flex gap-2 overflow-x-auto pb-2 text-[11px] uppercase tracking-[0.1em] text-white/60">
                {[
                  { key: "cercas", label: "Cercas" },
                  { key: "rotas", label: "Rotas" },
                  { key: "alvos", label: "Alvos" },
                ].map((tab) => (
                  <button
                    key={tab.key}
                    onClick={() => onTabChange(tab.key)}
                    className={`rounded-md px-3 py-2 transition ${
                      panelTab === tab.key ? "border border-primary/40 bg-primary/20 text-white" : "border border-transparent hover:border-white/20"
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              {panelTab === "cercas" && (
                <div className="space-y-2 rounded-xl border border-white/10 bg-white/5 p-3">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-semibold text-white">Cercas disponíveis</p>
                    <span className="text-[11px] text-white/60">{geofences.length} disponíveis</span>
                  </div>
                  <div className="max-h-56 space-y-1 overflow-y-auto">
                    {geofences.map((geo) => (
                      <button
                        key={geo.id}
                        type="button"
                        className="flex w-full items-center justify-between rounded-lg px-2 py-1 text-left text-sm text-white/80 hover:bg-white/5"
                        onClick={() => onAddItem({ type: "geofence", id: geo.id })}
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

              {panelTab === "rotas" && (
                <div className="space-y-2 rounded-xl border border-white/10 bg-white/5 p-3">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-semibold text-white">Rotas disponíveis</p>
                    <span className="text-[11px] text-white/60">{routes.length} disponíveis</span>
                  </div>
                  <div className="max-h-56 space-y-1 overflow-y-auto">
                    {routes.map((route) => (
                      <button
                        key={route.id}
                        type="button"
                        className="flex w-full items-center justify-between rounded-lg px-2 py-1 text-left text-sm text-white/80 hover:bg-white/5"
                        onClick={() => onAddItem({ type: "route", id: route.id })}
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

              {panelTab === "alvos" && (
                <div className="space-y-2 rounded-xl border border-white/10 bg-white/5 p-3">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-semibold text-white">Alvos disponíveis</p>
                    <span className="text-[11px] text-white/60">{targetGeofences.length} disponíveis</span>
                  </div>
                  <div className="max-h-56 space-y-1 overflow-y-auto">
                    {targetGeofences.map((target) => (
                      <button
                        key={target.id}
                        type="button"
                        className="flex w-full items-center justify-between rounded-lg px-2 py-1 text-left text-sm text-white/80 hover:bg-white/5"
                        onClick={() => onAddItem({ type: "target", id: target.id })}
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
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Itineraries() {
  const { geofences } = useGeofences({ autoRefreshMs: 0 });
  const { tenants } = useTenant();
  const [routes, setRoutes] = useState([]);
  const [itineraries, setItineraries] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [form, setForm] = useState({ name: "", description: "", items: [] });
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [panelTab, setPanelTab] = useState("cercas");
  const [editorOpen, setEditorOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [embarkedFilter, setEmbarkedFilter] = useState("all");
  const [kmlSizes, setKmlSizes] = useState(() => new Map());

  const clientNameById = useMemo(
    () => new Map((tenants || []).map((client) => [String(client.id), client.name])),
    [tenants],
  );
  const targetGeofences = useMemo(() => geofences.filter((geo) => geo.isTarget), [geofences]);

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
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadRoutes();
    void loadItineraries();
  }, [loadRoutes, loadItineraries]);

  const resetForm = () => {
    setForm({ name: "", description: "", items: [] });
    setSelectedId(null);
  };

  const openEditor = (itinerary = null) => {
    if (itinerary) {
      setSelectedId(itinerary.id);
      setForm({
        name: itinerary.name || "",
        description: itinerary.description || "",
        items: itinerary.items || [],
      });
    } else {
      resetForm();
    }
    setPanelTab("cercas");
    setEditorOpen(true);
  };

  const handleAddItem = (item) => {
    if (!item) return;
    setForm((current) => {
      const exists = (current.items || []).some((entry) => entry.type === item.type && String(entry.id) === String(item.id));
      if (exists) return current;
      return { ...current, items: [...(current.items || []), { type: item.type, id: String(item.id) }] };
    });
  };

  const handleRemoveItem = (item) => {
    if (!item) return;
    setForm((current) => {
      const nextItems = (current.items || []).filter(
        (entry) => !(entry.type === item.type && String(entry.id) === String(item.id)),
      );
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
      setEditorOpen(false);
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
      alert(error?.message || "Não foi possível exportar o KML.");
    }
  };

  const filteredItineraries = useMemo(() => {
    const term = query.trim().toLowerCase();
    return itineraries.filter((item) => {
      const name = item.name?.toLowerCase() || "";
      if (term && !name.includes(term)) return false;
      const lastEmbark = resolveLastEmbark(item);
      const isEmbarked = Boolean(item.isEmbarked ?? item.embarked ?? lastEmbark?.embarkedAt);
      if (embarkedFilter === "yes" && !isEmbarked) return false;
      if (embarkedFilter === "no" && isEmbarked) return false;
      return true;
    });
  }, [embarkedFilter, itineraries, query]);

  const selected = useMemo(() => itineraries.find((item) => item.id === selectedId) || null, [itineraries, selectedId]);

  const tableColCount = 8;

  return (
    <div className="flex min-h-[calc(100vh-180px)] flex-col gap-6">
      <div className="-mx-4 space-y-4 border-b border-white/5 bg-[#0c1119]/90 px-4 pb-4 pt-2 backdrop-blur sm:mx-0 sm:rounded-2xl sm:border">
        <PageHeader
          eyebrow="Itinerários"
          title="Itinerários"
          description="Agrupadores de cercas, rotas e alvos para o mesmo cliente."
          right={(
            <>
              <span className="map-status-pill">
                <span className="dot" />
                {itineraries.length} itinerários
              </span>
              {loading && <span className="map-status-pill border-primary/50 bg-primary/10 text-cyan-100">Carregando...</span>}
              <Button size="sm" onClick={() => openEditor(null)} icon={Plus}>
                Criar novo
              </Button>
            </>
          )}
        />
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="w-full md:max-w-xs">
            <Input
              placeholder="Buscar itinerário"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          <div className="flex flex-1 flex-wrap items-center gap-3 md:justify-end">
            <div className="min-w-[200px]">
              <Select
                value={embarkedFilter}
                onChange={(event) => setEmbarkedFilter(event.target.value)}
                className="w-full text-sm text-white/80"
              >
                <option value="all">Embarcados: Todos</option>
                <option value="yes">Embarcados: Sim</option>
                <option value="no">Embarcados: Não</option>
              </Select>
            </div>
          </div>
        </div>
      </div>

      <div className="flex-1 rounded-2xl border border-white/10 bg-[#0d131c]/80 shadow-2xl">
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
                      <p className="text-xs text-white/60">Ajuste os filtros ou crie um novo itinerário.</p>
                      <div className="flex justify-center gap-2 text-xs">
                        <Button
                          variant="ghost"
                          className="inline-flex items-center gap-2"
                          onClick={() => {
                            setEmbarkedFilter("all");
                            setQuery("");
                          }}
                        >
                          Limpar filtros
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

      {/* TODO: preencher último embarque quando API disponibilizar */}
      <ItineraryModal
        open={editorOpen}
        onClose={() => setEditorOpen(false)}
        title={selected ? "Editar itinerário" : "Novo itinerário"}
        description="Organize cercas, rotas e alvos existentes em um agrupador."
        saving={saving}
        onSave={handleSave}
        onDelete={selected ? () => handleDelete(selected.id) : null}
        form={form}
        onChange={setForm}
        panelTab={panelTab}
        onTabChange={setPanelTab}
        geofences={geofences}
        routes={routes}
        targetGeofences={targetGeofences}
        onAddItem={handleAddItem}
        onRemoveItem={handleRemoveItem}
      />
    </div>
  );
}
