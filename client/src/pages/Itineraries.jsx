import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  createAndEmbark,
  onCreateAndEmbarkChange,
  showCreateAndEmbark,
  activeTab,
  onTabChange,
  geofences,
  routes,
  targetGeofences,
  onLinkItem,
  onRemoveItem,
}) {
  const [selectedGeofenceId, setSelectedGeofenceId] = useState(null);
  const [selectedRouteId, setSelectedRouteId] = useState(null);
  const [selectedTargetId, setSelectedTargetId] = useState(null);

  useEffect(() => {
    if (!open) return;
    setSelectedGeofenceId(null);
    setSelectedRouteId(null);
    setSelectedTargetId(null);
  }, [open]);

  if (!open) return null;

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
              {showCreateAndEmbark && (
                <label className="flex items-center gap-2 text-sm text-white/70">
                  <input
                    type="checkbox"
                    className="h-4 w-4"
                    checked={createAndEmbark}
                    onChange={(event) => onCreateAndEmbarkChange(event.target.checked)}
                  />
                  Criar e embarcar agora
                </label>
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
        </div>

        <div className="flex items-center justify-end border-t border-white/10 px-6 py-4">
          <Button onClick={onSave} disabled={saving} icon={Save}>
            {saving ? "Salvando..." : "Salvar"}
          </Button>
        </div>
      </div>
    </div>
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
  selectedVehicleIds,
  onToggleVehicle,
  selectedItineraryIds,
  onToggleItinerary,
  onRemoveVehicle,
  sending,
  onSubmit,
  resultSummary,
}) {
  if (!open) return null;

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

        <div className="max-h-[70vh] flex-1 space-y-6 overflow-y-auto px-6 py-5">
          <div className="grid gap-6 lg:grid-cols-2">
            <div className="space-y-3 rounded-xl border border-white/10 bg-white/5 p-4">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-white">Veículos</p>
                <span className="text-[11px] text-white/60">{selectedVehicleIds.length} selecionados</span>
              </div>
              <Input
                placeholder="Buscar veículo"
                value={vehicleQuery}
                onChange={(event) => onVehicleQueryChange(event.target.value)}
              />
              <div className="max-h-48 space-y-2 overflow-y-auto">
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
                {filteredVehicles.length === 0 && <p className="text-xs text-white/60">Nenhum veículo encontrado.</p>}
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

            <div className="space-y-3 rounded-xl border border-white/10 bg-white/5 p-4">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-white">Itinerários</p>
                <span className="text-[11px] text-white/60">{selectedItineraryIds.length} selecionados</span>
              </div>
              <Input
                placeholder="Buscar itinerário"
                value={itineraryQuery}
                onChange={(event) => onItineraryQueryChange(event.target.value)}
              />
              <div className="max-h-64 space-y-2 overflow-y-auto">
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
                {filteredItineraries.length === 0 && <p className="text-xs text-white/60">Nenhum itinerário encontrado.</p>}
              </div>
            </div>
          </div>

          {resultSummary && (
            <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-xs text-white/70">
              {resultSummary}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end border-t border-white/10 px-6 py-4">
          <Button onClick={onSubmit} disabled={sending}>
            {sending ? "Embarcando..." : "Embarcar"}
          </Button>
        </div>
      </div>
    </div>
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
}) {
  const [activeTab, setActiveTab] = useState("vehicles");

  useEffect(() => {
    if (!open) return;
    setActiveTab("vehicles");
  }, [open]);

  if (!open) return null;

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

        <div className="border-b border-white/10 px-6 py-3">
          <div className="flex flex-wrap gap-2 text-[11px] uppercase tracking-[0.1em] text-white/60">
            {[
              { key: "vehicles", label: "Veículos" },
              { key: "itineraries", label: "Itinerários" },
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
        </div>

        <div className="max-h-[70vh] flex-1 space-y-6 overflow-y-auto px-6 py-5">
          {activeTab === "vehicles" && (
            <div className="space-y-3">
              <Input
                placeholder="Buscar veículo"
                value={vehicleQuery}
                onChange={(event) => onVehicleQueryChange(event.target.value)}
              />
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
                  {filteredVehicles.length === 0 && <p className="text-xs text-white/60">Nenhum veículo encontrado.</p>}
                </div>
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
                placeholder="Buscar itinerário"
                value={itineraryQuery}
                onChange={(event) => onItineraryQueryChange(event.target.value)}
              />
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
                  {filteredItineraries.length === 0 && <p className="text-xs text-white/60">Nenhum itinerário encontrado.</p>}
                </div>
              </div>
              <div className="space-y-2">
                <p className="text-sm font-semibold text-white">Itinerários selecionados</p>
                {selectedItineraries.length === 0 && <p className="text-xs text-white/60">Nenhum itinerário selecionado.</p>}
                {selectedItineraries.map((itinerary) => (
                  <div key={itinerary.id} className="rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white/80">
                    {itinerary.name}
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

          {resultSummary && (
            <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-xs text-white/70">
              {resultSummary}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end border-t border-white/10 px-6 py-4">
          <Button onClick={onSubmit} disabled={sending}>
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
  const [vehicleQuery, setVehicleQuery] = useState("");
  const [itineraryQuery, setItineraryQuery] = useState("");
  const [selectedVehicleIds, setSelectedVehicleIds] = useState([]);
  const [selectedItineraryIds, setSelectedItineraryIds] = useState([]);
  const [embarkSending, setEmbarkSending] = useState(false);
  const [embarkSummary, setEmbarkSummary] = useState(null);
  const [disembarkSending, setDisembarkSending] = useState(false);
  const [disembarkVehicleQuery, setDisembarkVehicleQuery] = useState("");
  const [disembarkItineraryQuery, setDisembarkItineraryQuery] = useState("");
  const [selectedDisembarkVehicleIds, setSelectedDisembarkVehicleIds] = useState([]);
  const [selectedDisembarkItineraryIds, setSelectedDisembarkItineraryIds] = useState([]);
  const [disembarkSummary, setDisembarkSummary] = useState(null);
  const [cleanupDeleteGroup, setCleanupDeleteGroup] = useState(false);
  const [cleanupDeleteGeozones, setCleanupDeleteGeozones] = useState(false);
  const [createAndEmbark, setCreateAndEmbark] = useState(false);
  const [toast, setToast] = useState(null);
  const toastTimeoutRef = useRef(null);

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
      showToast("Não foi possível carregar as rotas salvas.", "warning");
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
      showToast("Não foi possível carregar os itinerários.", "warning");
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
      showToast("Não foi possível carregar o histórico de embarques.", "warning");
    } finally {
      setHistoryLoading(false);
    }
  }, [showToast, tenantId]);

  useEffect(() => {
    void loadRoutes();
    void loadItineraries();
  }, [loadRoutes, loadItineraries]);

  useEffect(() => {
    if (activeTab !== "historico") return;
    void loadHistory();
  }, [activeTab, loadHistory]);

  useEffect(() => {
    if (activeTab !== "historico") return;
    const hasPending = historyEntries.some((entry) =>
      ["Deploying", "Enviado"].includes(entry.status || ""),
    );
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
    setCreateAndEmbark(false);
  };

  const resetEmbarkForm = useCallback(() => {
    setVehicleQuery("");
    setItineraryQuery("");
    setSelectedVehicleIds([]);
    setSelectedItineraryIds([]);
    setEmbarkSummary(null);
  }, []);

  const resetDisembarkForm = useCallback(() => {
    setDisembarkVehicleQuery("");
    setDisembarkItineraryQuery("");
    setSelectedDisembarkVehicleIds([]);
    setSelectedDisembarkItineraryIds([]);
    setDisembarkSummary(null);
    setCleanupDeleteGroup(false);
    setCleanupDeleteGeozones(false);
  }, []);

  const openEditor = (itinerary = null) => {
    if (itinerary) {
      setSelectedId(itinerary.id);
      setForm({
        name: itinerary.name || "",
        description: itinerary.description || "",
        items: itinerary.items || [],
      });
      setCreateAndEmbark(false);
    } else {
      resetForm();
    }
    setEditorTab("detalhes");
    setEditorOpen(true);
  };

  const handleLinkItem = useCallback(
    (item) => {
      if (!item) return;
      const exists = (form.items || []).some((entry) => entry.type === item.type && String(entry.id) === String(item.id));
      if (exists) {
        showToast("Item já vinculado.", "warning");
        return;
      }
      setForm((current) => ({
        ...current,
        items: [...(current.items || []), { type: item.type, id: String(item.id) }],
      }));
      const label = item.type === "geofence" ? "Cerca" : item.type === "route" ? "Rota" : "Alvo";
      showToast(`${label} vinculada com sucesso.`);
    },
    [form.items, showToast],
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

  const handleSave = async () => {
    if (!form.name.trim()) {
      showToast("Informe um nome para o itinerário.", "warning");
      return;
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
      setEditorOpen(false);
      showToast("Itinerário salvo com sucesso.");
      if (isNew && createAndEmbark) {
        resetEmbarkForm();
        setSelectedItineraryIds([String(saved.id || selectedId)]);
        setEmbarkOpen(true);
      }
    } catch (error) {
      console.error(error);
      showToast(error?.message || "Não foi possível salvar o itinerário.", "warning");
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
      showToast("Itinerário removido.");
    } catch (error) {
      console.error(error);
      if (error?.response?.status === 409) {
        showToast(
          "Há dispositivos embarcados. Clique em Desembarcar para remover do veículo e depois excluir.",
          "warning",
          {
            label: "Abrir desembarque",
            onClick: () => openDisembarkModal(id),
          },
        );
        return;
      }
      showToast(error?.message || "Não foi possível remover.", "warning");
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
      showToast(error?.message || "Não foi possível exportar o KML.", "warning");
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
      return [entry.itineraryName, entry.vehicleName, entry.plate, entry.model, entry.brand, entry.sentByName]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(term));
    });
    return list;
  }, [historyEntries, query]);

  const historyTotalPages = Math.max(1, Math.ceil(filteredHistory.length / HISTORY_PAGE_SIZE));
  const safeHistoryPage = Math.min(historyPage, historyTotalPages);
  const historyStart = (safeHistoryPage - 1) * HISTORY_PAGE_SIZE;
  const paginatedHistory = filteredHistory.slice(historyStart, historyStart + HISTORY_PAGE_SIZE);

  const selected = useMemo(() => itineraries.find((item) => item.id === selectedId) || null, [itineraries, selectedId]);

  const handleToggleVehicle = (vehicleId) => {
    setSelectedVehicleIds((current) =>
      current.includes(vehicleId) ? current.filter((id) => id !== vehicleId) : [...current, vehicleId],
    );
  };

  const handleToggleItinerary = (itineraryId) => {
    setSelectedItineraryIds((current) =>
      current.includes(itineraryId) ? current.filter((id) => id !== itineraryId) : [...current, itineraryId],
    );
  };

  const handleRemoveVehicle = (vehicleId) => {
    setSelectedVehicleIds((current) => current.filter((id) => id !== vehicleId));
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

  const handleEmbarkSubmit = async () => {
    if (!selectedVehicleIds.length || !selectedItineraryIds.length) {
      showToast("Selecione veículos e itinerários para embarcar.", "warning");
      return;
    }
    setEmbarkSending(true);
    try {
      const response = await api.post(API_ROUTES.itineraryEmbark, {
        vehicleIds: selectedVehicleIds,
        itineraryIds: selectedItineraryIds,
        clientId: tenantId ?? undefined,
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
    } catch (error) {
      console.error(error);
      showToast(error?.message || "Não foi possível enviar o embarque.", "warning");
    } finally {
      setEmbarkSending(false);
    }
  };

  const handleDisembarkSubmit = async () => {
    if (!selectedDisembarkItineraryIds.length) {
      showToast("Selecione itinerários para desembarcar.", "warning");
      return;
    }
    setDisembarkSending(true);
    try {
      const response = await api.post(API_ROUTES.itineraryDisembarkBatch, {
        vehicleIds: selectedDisembarkVehicleIds,
        itineraryIds: selectedDisembarkItineraryIds,
        clientId: tenantId ?? undefined,
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
    } catch (error) {
      console.error(error);
      showToast(error?.message || "Não foi possível desembarcar.", "warning");
    } finally {
      setDisembarkSending(false);
    }
  };

  const tableColCount = 8;
  const historyColCount = 10;

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
              <div className="flex items-center gap-2">
                <Button size="sm" variant="secondary" onClick={() => setEmbarkOpen(true)}>
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
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2 text-[11px] uppercase tracking-[0.1em] text-white/60">
            {[
              { key: "embarcado", label: "Embarcado" },
              { key: "historico", label: "Histórico" },
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
                placeholder={activeTab === "historico" ? "Buscar histórico" : "Buscar itinerário"}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
          </div>
        </div>
      </div>

      {activeTab === "embarcado" && (
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
        <div className="flex-1 rounded-2xl border border-white/10 bg-[#0d131c]/80 shadow-2xl">
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm text-white/80">
              <thead className="sticky top-0 bg-white/5 text-xs uppercase tracking-wide text-white/60 backdrop-blur">
                <tr>
                  <th className="px-4 py-3 text-left">Enviado em</th>
                  <th className="px-4 py-3 text-left">Recebido em</th>
                  <th className="px-4 py-3 text-left">Quem enviou</th>
                  <th className="px-4 py-3 text-left">Status</th>
                  <th className="px-4 py-3 text-left">Veículo</th>
                  <th className="px-4 py-3 text-left">Placa</th>
                  <th className="px-4 py-3 text-left">Marca</th>
                  <th className="px-4 py-3 text-left">Modelo</th>
                  <th className="px-4 py-3 text-left">Resultado</th>
                  <th className="px-4 py-3 text-left">IP/Endereço</th>
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
                      <td className="px-4 py-3">{formatDateTime(entry.sentAt)}</td>
                      <td className="px-4 py-3">{formatDateTime(entry.receivedAt)}</td>
                      <td className="px-4 py-3">{entry.sentByName || entry.sentBy || "—"}</td>
                      <td className="px-4 py-3">{entry.status || "—"}</td>
                      <td className="px-4 py-3">{entry.vehicleName || "—"}</td>
                      <td className="px-4 py-3">{entry.plate || "—"}</td>
                      <td className="px-4 py-3">{entry.brand || "—"}</td>
                      <td className="px-4 py-3">{entry.model || "—"}</td>
                      <td className="px-4 py-3">{entry.result || "—"}</td>
                      <td className="px-4 py-3">{entry.ipAddress || "—"}</td>
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

      <ItineraryModal
        open={editorOpen}
        onClose={() => {
          setEditorOpen(false);
          setCreateAndEmbark(false);
        }}
        title={selected ? "Editar itinerário" : "Novo itinerário"}
        description="Organize cercas, rotas e alvos existentes em um agrupador."
        saving={saving}
        onSave={handleSave}
        onDelete={selected ? () => handleDelete(selected.id) : null}
        form={form}
        onChange={setForm}
        createAndEmbark={createAndEmbark}
        onCreateAndEmbarkChange={setCreateAndEmbark}
        showCreateAndEmbark={!selected}
        activeTab={editorTab}
        onTabChange={setEditorTab}
        geofences={geofences}
        routes={routes}
        targetGeofences={targetGeofences}
        onLinkItem={handleLinkItem}
        onRemoveItem={handleRemoveItem}
      />

      <EmbarkModal
        open={embarkOpen}
        onClose={() => {
          setEmbarkOpen(false);
          resetEmbarkForm();
        }}
        vehicles={vehicles}
        itineraries={itineraries}
        vehicleQuery={vehicleQuery}
        onVehicleQueryChange={setVehicleQuery}
        itineraryQuery={itineraryQuery}
        onItineraryQueryChange={setItineraryQuery}
        selectedVehicleIds={selectedVehicleIds}
        onToggleVehicle={handleToggleVehicle}
        onRemoveVehicle={handleRemoveVehicle}
        selectedItineraryIds={selectedItineraryIds}
        onToggleItinerary={handleToggleItinerary}
        sending={embarkSending}
        onSubmit={handleEmbarkSubmit}
        resultSummary={embarkSummary}
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
      />
    </div>
  );
}
