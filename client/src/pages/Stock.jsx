import React, { useEffect, useMemo, useState } from "react";
import { MapPin, RefreshCw, Search, Send, Users } from "lucide-react";

import { CoreApi } from "../lib/coreApi.js";
import { useTenant } from "../lib/tenant-context.jsx";
import PageHeader from "../components/ui/PageHeader.jsx";
import DataCard from "../components/ui/DataCard.jsx";
import FilterBar from "../components/ui/FilterBar.jsx";
import DataTable from "../components/ui/DataTable.jsx";
import EmptyState from "../components/ui/EmptyState.jsx";
import SkeletonTable from "../components/ui/SkeletonTable.jsx";

const FILTER_OPTIONS = [
  { value: "both", label: "Ambos" },
  { value: "available", label: "Disponíveis" },
  { value: "linked", label: "Vinculados" },
];

export default function Stock() {
  const { tenantId, user, tenants } = useTenant();
  const [devices, setDevices] = useState([]);
  const [models, setModels] = useState([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState("geral");
  const [selectedClientId, setSelectedClientId] = useState(null);
  const [availabilityFilter, setAvailabilityFilter] = useState("both");
  const [searchClient, setSearchClient] = useState("");
  const [searchId, setSearchId] = useState("");
  const [cityFilter, setCityFilter] = useState("");
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [transferTechnician, setTransferTechnician] = useState("");
  const [radiusKm, setRadiusKm] = useState("10");
  const [addressQuery, setAddressQuery] = useState("");

  const resolvedClientId = tenantId || user?.clientId || null;

  const loadStock = async () => {
    setLoading(true);
    try {
      const params = resolvedClientId ? { clientId: resolvedClientId } : undefined;
      const [deviceList, modelList] = await Promise.all([CoreApi.listDevices(params), CoreApi.models(params)]);
      setDevices(Array.isArray(deviceList) ? deviceList : []);
      setModels(Array.isArray(modelList) ? modelList : []);
    } catch (error) {
      console.error("Falha ao carregar estoque", error);
      setDevices([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadStock();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolvedClientId]);

  const modelById = useMemo(() => {
    const map = new Map();
    models.forEach((model) => {
      map.set(model.id, model);
    });
    return map;
  }, [models]);

  const clientNameById = useMemo(() => {
    const map = new Map();
    (tenants || []).forEach((tenant) => {
      map.set(String(tenant.id), tenant.name || tenant.company || tenant.id);
    });
    return map;
  }, [tenants]);

  const availableDevices = useMemo(() => devices.filter((device) => !device.vehicleId), [devices]);
  const linkedDevices = useMemo(() => devices.filter((device) => device.vehicleId), [devices]);

  const totals = {
    available: availableDevices.length,
    linked: linkedDevices.length,
  };

  const groupedByClient = useMemo(() => {
    const groups = new Map();
    devices.forEach((device) => {
      const clientId = device.clientId || "global";
      if (!groups.has(clientId)) {
        groups.set(clientId, []);
      }
      groups.get(clientId).push(device);
    });
    return Array.from(groups.entries()).map(([clientId, list]) => {
      const available = list.filter((item) => !item.vehicleId).length;
      const linked = list.filter((item) => item.vehicleId).length;
      return {
        clientId,
        name: clientNameById.get(String(clientId)) || `Cliente ${String(clientId).slice(0, 6)}`,
        available,
        linked,
      };
    });
  }, [clientNameById, devices]);

  const filteredClients = useMemo(() => {
    const term = searchClient.trim().toLowerCase();
    return groupedByClient.filter((client) => {
      if (!term) return true;
      return client.name.toLowerCase().includes(term);
    });
  }, [groupedByClient, searchClient]);

  const filteredDevices = useMemo(() => {
    const term = searchId.trim().toLowerCase();
    const cityTerm = cityFilter.trim().toLowerCase();
    return devices.filter((device) => {
      if (selectedClientId && String(device.clientId) !== String(selectedClientId)) return false;
      if (availabilityFilter === "available" && device.vehicleId) return false;
      if (availabilityFilter === "linked" && !device.vehicleId) return false;
      if (term && !String(device.uniqueId || device.id || "").toLowerCase().includes(term)) return false;
      if (cityTerm && !String(device.city || device.address || "").toLowerCase().includes(cityTerm)) return false;
      return true;
    });
  }, [availabilityFilter, cityFilter, devices, searchId, selectedClientId]);

  const toggleSelection = (id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleTransfer = () => {
    if (!selectedIds.size || !transferTechnician) {
      alert("Selecione equipamentos e informe o técnico destino.");
      return;
    }
    alert(`Transferindo ${selectedIds.size} equipamentos para ${transferTechnician}.`);
    setSelectedIds(new Set());
    setTransferTechnician("");
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="Estoque"
        titleClassName="text-xs font-semibold uppercase tracking-[0.14em] text-white/70"
        subtitle="Controle por cliente, disponíveis e vinculados."
        actions={
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={loadStock}
              className="rounded-xl bg-white/10 px-4 py-2 text-sm text-white transition hover:bg-white/15"
            >
              <span className="inline-flex items-center gap-2">
                <RefreshCw className="h-4 w-4" />
                Atualizar
              </span>
            </button>
            <button
              type="button"
              onClick={handleTransfer}
              className="rounded-xl bg-sky-500 px-4 py-2 text-sm font-medium text-black transition hover:bg-sky-400"
            >
              <span className="inline-flex items-center gap-2">
                <Send className="h-4 w-4" />
                Transferir
              </span>
            </button>
          </div>
        }
      />

      <div className="flex flex-wrap items-center gap-3 text-sm text-white/80">
        <span className="rounded-full bg-white/10 px-3 py-1">Disponíveis: {totals.available}</span>
        <span className="rounded-full bg-white/10 px-3 py-1">Vinculados: {totals.linked}</span>
        <div className="ml-auto flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setView("geral")}
            className={`rounded-xl px-4 py-2 ${view === "geral" ? "bg-sky-500 text-black" : "bg-white/10 text-white"}`}
          >
            Geral
          </button>
          <button
            type="button"
            onClick={() => setView("cliente")}
            className={`rounded-xl px-4 py-2 ${view === "cliente" ? "bg-sky-500 text-black" : "bg-white/10 text-white"}`}
          >
            Cliente
          </button>
          <button
            type="button"
            onClick={() => setView("mapa")}
            className={`rounded-xl px-4 py-2 ${view === "mapa" ? "bg-sky-500 text-black" : "bg-white/10 text-white"}`}
          >
            Mapa/Região
          </button>
        </div>
      </div>

      <DataCard>
        <FilterBar
          left={
            <>
              <div className="relative min-w-[240px] flex-1">
                <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-white/50" />
                <input
                  value={searchClient}
                  onChange={(event) => setSearchClient(event.target.value)}
                  placeholder="Buscar cliente"
                  className="w-full rounded-xl border border-white/10 bg-black/30 py-2 pl-10 pr-4 text-sm text-white placeholder:text-white/50 focus:border-white/30 focus:outline-none"
                />
              </div>
              <input
                value={searchId}
                onChange={(event) => setSearchId(event.target.value)}
                placeholder="Buscar equipamento por ID"
                className="rounded-xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-white placeholder:text-white/50 focus:border-white/30 focus:outline-none"
              />
              <input
                value={cityFilter}
                onChange={(event) => setCityFilter(event.target.value)}
                placeholder="Endereço/Cidade"
                className="rounded-xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-white placeholder:text-white/50 focus:border-white/30 focus:outline-none"
              />
              <select
                value={availabilityFilter}
                onChange={(event) => setAvailabilityFilter(event.target.value)}
                className="rounded-xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
              >
                {FILTER_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <input
                value={transferTechnician}
                onChange={(event) => setTransferTechnician(event.target.value)}
                placeholder="Transferir para técnico"
                className="rounded-xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-white placeholder:text-white/50 focus:border-white/30 focus:outline-none"
              />
            </>
          }
        />
      </DataCard>

      {view === "geral" && (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filteredClients.map((client) => (
            <DataCard key={client.clientId} className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="text-sm font-semibold text-white">{client.name}</div>
                <Users className="h-4 w-4 text-white/40" />
              </div>
              <div className="flex items-center gap-3 text-sm text-white/70">
                <span className="rounded-full bg-white/10 px-3 py-1">Disponíveis: {client.available}</span>
                <span className="rounded-full bg-white/10 px-3 py-1">Vinculados: {client.linked}</span>
              </div>
              <button
                type="button"
                onClick={() => {
                  setSelectedClientId(client.clientId);
                  setView("cliente");
                }}
                className="w-full rounded-xl bg-white/10 px-3 py-2 text-sm text-white transition hover:bg-white/15"
              >
                Ver detalhes
              </button>
            </DataCard>
          ))}
          {!filteredClients.length && !loading && (
            <DataCard>
              <EmptyState title="Nenhum cliente encontrado." subtitle="Ajuste os filtros para visualizar o estoque." />
            </DataCard>
          )}
        </div>
      )}

      {view === "cliente" && (
        <DataCard className="overflow-hidden p-0">
          <DataTable>
            <thead className="bg-white/5 text-xs uppercase tracking-wide text-white/70">
              <tr className="text-left">
                <th className="px-4 py-3">Selecionar</th>
                <th className="px-4 py-3">ID</th>
                <th className="px-4 py-3">Modelo</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Localização</th>
                <th className="px-4 py-3">Veículo/Técnico</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/10">
              {loading && (
                <tr>
                  <td colSpan={6} className="px-4 py-6">
                    <SkeletonTable rows={6} columns={6} />
                  </td>
                </tr>
              )}
              {!loading && filteredDevices.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8">
                    <EmptyState title="Nenhum equipamento encontrado." subtitle="Refine os filtros para este cliente." />
                  </td>
                </tr>
              )}
              {!loading &&
                filteredDevices.map((device) => (
                  <tr key={device.id} className="hover:bg-white/5">
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        checked={selectedIds.has(device.id)}
                        onChange={() => toggleSelection(device.id)}
                        className="h-4 w-4 rounded border-white/30 bg-transparent"
                      />
                    </td>
                    <td className="px-4 py-3 text-white/80">{device.uniqueId || device.id}</td>
                    <td className="px-4 py-3 text-white/70">
                      {modelById.get(device.modelId)?.name || device.model || "—"}
                    </td>
                    <td className="px-4 py-3">
                      <span className="rounded-lg bg-white/10 px-2 py-1 text-xs text-white/80">
                        {device.vehicleId ? "Vinculado" : "Disponível"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-white/70">
                      {device.address || device.city || "Base"}
                    </td>
                    <td className="px-4 py-3 text-white/70">
                      {device.vehicle?.plate || device.vehicleId || "—"}
                    </td>
                  </tr>
                ))}
            </tbody>
          </DataTable>
        </DataCard>
      )}

      {view === "mapa" && (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <DataCard className="space-y-3">
            <h2 className="text-sm font-semibold text-white">Busca por região</h2>
            <div className="grid gap-3 md:grid-cols-2">
              <input
                value={addressQuery}
                onChange={(event) => setAddressQuery(event.target.value)}
                placeholder="Endereço ou cidade"
                className="w-full rounded-xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-white placeholder:text-white/50 focus:border-white/30 focus:outline-none"
              />
              <input
                value={radiusKm}
                onChange={(event) => setRadiusKm(event.target.value)}
                placeholder="Raio (km)"
                className="w-full rounded-xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-white placeholder:text-white/50 focus:border-white/30 focus:outline-none"
              />
            </div>
            <div className="rounded-xl border border-white/10 bg-white/5 p-4 text-sm text-white/60">
              <MapPin className="mb-2 h-4 w-4" />
              Mapa indisponível nesta versão. Resultado exibido em lista por distância aproximada.
            </div>
          </DataCard>
          <DataCard className="overflow-hidden p-0">
            <DataTable>
              <thead className="bg-white/5 text-xs uppercase tracking-wide text-white/70">
                <tr className="text-left">
                  <th className="px-4 py-3">ID</th>
                  <th className="px-4 py-3">Cliente</th>
                  <th className="px-4 py-3">Local</th>
                  <th className="px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/10">
                {availableDevices.slice(0, 6).map((device) => (
                  <tr key={device.id} className="hover:bg-white/5">
                    <td className="px-4 py-3 text-white/80">{device.uniqueId || device.id}</td>
                    <td className="px-4 py-3 text-white/70">
                      {clientNameById.get(String(device.clientId)) || "—"}
                    </td>
                    <td className="px-4 py-3 text-white/70">{device.address || device.city || "Base"}</td>
                    <td className="px-4 py-3 text-white/70">Disponível</td>
                  </tr>
                ))}
                {!availableDevices.length && !loading && (
                  <tr>
                    <td colSpan={4} className="px-4 py-8">
                      <EmptyState title="Nenhum equipamento disponível." subtitle="Tente outro raio/região." />
                    </td>
                  </tr>
                )}
              </tbody>
            </DataTable>
          </DataCard>
        </div>
      )}
    </div>
  );
}
