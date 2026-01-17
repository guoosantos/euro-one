import React, { useEffect, useMemo, useRef, useState } from "react";
import { MapPin, RefreshCw, Search, Send, Users } from "lucide-react";
import { Circle, MapContainer, Marker, TileLayer } from "react-leaflet";
import "leaflet/dist/leaflet.css";

import api from "../lib/api.js";
import { CoreApi } from "../lib/coreApi.js";
import { useTenant } from "../lib/tenant-context.jsx";
import PageHeader from "../components/ui/PageHeader.jsx";
import FilterBar from "../components/ui/FilterBar.jsx";
import DataTable from "../components/ui/DataTable.jsx";
import EmptyState from "../components/ui/EmptyState.jsx";
import SkeletonTable from "../components/ui/SkeletonTable.jsx";
import AddressSearchInput, { useAddressSearchState } from "../components/shared/AddressSearchInput.jsx";
import useMapLifecycle from "../lib/map/useMapLifecycle.js";

const FILTER_OPTIONS = [
  { value: "both", label: "Ambos" },
  { value: "available", label: "Disponíveis" },
  { value: "linked", label: "Vinculados" },
];

const DEFAULT_CENTER = [-15.7801, -47.9292];

function Drawer({ open, onClose, title, description, children }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[9998] flex">
      <div className="flex-1 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative h-full w-full max-w-3xl border-l border-white/10 bg-[#0f141c] shadow-3xl">
        <div className="flex items-start justify-between gap-4 border-b border-white/10 px-6 py-5">
          <div>
            <p className="text-xs uppercase tracking-[0.12em] text-white/50">Estoque</p>
            <h2 className="text-xl font-semibold text-white">{title}</h2>
            {description ? <p className="mt-1 text-sm text-white/60">{description}</p> : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-white/10 px-3 py-1 text-xs text-white/70 hover:border-white/30 hover:text-white"
          >
            Fechar
          </button>
        </div>
        <div className="h-[calc(100vh-120px)] overflow-y-auto px-6 py-6">{children}</div>
      </div>
    </div>
  );
}

function resolveDeviceCoords(device) {
  const attrs = device?.attributes || {};
  const position = attrs.position || attrs.lastPosition || {};
  const lat = Number(
    device?.latitude ??
      device?.lat ??
      position.latitude ??
      position.lat ??
      attrs.latitude ??
      attrs.lat ??
      null,
  );
  const lng = Number(
    device?.longitude ??
      device?.lng ??
      device?.lon ??
      position.longitude ??
      position.lon ??
      attrs.longitude ??
      attrs.lon ??
      null,
  );
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

function resolveTechnicianAddress(technician) {
  if (!technician) return "";
  if (technician.address) return technician.address;
  const parts = [
    technician.street,
    technician.number,
    technician.district,
    technician.city,
    technician.state,
  ].filter(Boolean);
  return parts.join(", ");
}

function distanceKm(lat1, lon1, lat2, lon2) {
  const toRad = (value) => (value * Math.PI) / 180;
  const radius = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return radius * c;
}

export default function Stock() {
  const { tenantId, user, tenants } = useTenant();
  const [devices, setDevices] = useState([]);
  const [models, setModels] = useState([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState("geral");
  const [availabilityFilter, setAvailabilityFilter] = useState("both");
  const [searchClient, setSearchClient] = useState("");
  const [searchId, setSearchId] = useState("");
  const [cityFilter, setCityFilter] = useState("");
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [radiusKm, setRadiusKm] = useState("10");
  const [technicians, setTechnicians] = useState([]);
  const [techniciansLoading, setTechniciansLoading] = useState(false);
  const [transferDrawerOpen, setTransferDrawerOpen] = useState(false);
  const [detailsDrawerOpen, setDetailsDrawerOpen] = useState(false);
  const [detailsClientId, setDetailsClientId] = useState(null);
  const [transferSearch, setTransferSearch] = useState({
    model: "",
    deviceId: "",
    client: "",
  });
  const [transferForm, setTransferForm] = useState({
    destinationType: "client",
    destinationClientId: "",
    destinationTechnicianId: "",
    address: "",
    referencePoint: "",
    latitude: "",
    longitude: "",
    notes: "",
  });
  const mapSearchState = useAddressSearchState({ initialValue: "" });
  const transferAddressState = useAddressSearchState({ initialValue: "" });
  const [regionTarget, setRegionTarget] = useState(null);
  const mapRef = useRef(null);
  const { onMapReady } = useMapLifecycle({ mapRef });

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

  useEffect(() => {
    let cancelled = false;
    const loadTechnicians = async () => {
      setTechniciansLoading(true);
      try {
        const params = resolvedClientId ? { clientId: resolvedClientId } : undefined;
        const response = await api.get("core/technicians", { params });
        const list = response?.data?.items || [];
        if (!cancelled) {
          setTechnicians(Array.isArray(list) ? list : []);
        }
      } catch (error) {
        if (!cancelled) {
          console.error("Falha ao carregar técnicos", error);
          setTechnicians([]);
        }
      } finally {
        if (!cancelled) {
          setTechniciansLoading(false);
        }
      }
    };

    loadTechnicians();
    return () => {
      cancelled = true;
    };
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

  const clientOptions = useMemo(
    () => (Array.isArray(tenants) ? tenants : []).map((tenant) => ({
      id: tenant.id,
      name: tenant.name || tenant.company || tenant.id,
    })),
    [tenants],
  );

  const technicianOptions = useMemo(
    () => (Array.isArray(technicians) ? technicians : []).map((technician) => ({
      id: technician.id,
      name: technician.name || technician.fullName || technician.email || String(technician.id),
      address: technician.address || "",
      street: technician.street || "",
      number: technician.number || "",
      district: technician.district || "",
      city: technician.city || "",
      state: technician.state || "",
      latitude: technician.latitude ?? "",
      longitude: technician.longitude ?? "",
    })),
    [technicians],
  );

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

  const detailsClient = useMemo(
    () => groupedByClient.find((client) => String(client.clientId) === String(detailsClientId)) || null,
    [detailsClientId, groupedByClient],
  );

  const detailsDevices = useMemo(
    () => devices.filter((device) => String(device.clientId || "global") === String(detailsClientId)),
    [detailsClientId, devices],
  );

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
      if (availabilityFilter === "available" && device.vehicleId) return false;
      if (availabilityFilter === "linked" && !device.vehicleId) return false;
      if (term && !String(device.uniqueId || device.id || "").toLowerCase().includes(term)) return false;
      if (cityTerm && !String(device.city || device.address || "").toLowerCase().includes(cityTerm)) return false;
      return true;
    });
  }, [availabilityFilter, cityFilter, devices, searchId]);

  const transferCandidates = useMemo(() => {
    const modelTerm = transferSearch.model.trim().toLowerCase();
    const idTerm = transferSearch.deviceId.trim().toLowerCase();
    const clientTerm = transferSearch.client.trim().toLowerCase();

    return devices.filter((device) => {
      const modelLabel = modelById.get(device.modelId)?.name || device.model || "";
      const clientLabel = clientNameById.get(String(device.clientId)) || "";
      const deviceLabel = String(device.uniqueId || device.id || "").toLowerCase();

      if (modelTerm && !modelLabel.toLowerCase().includes(modelTerm)) return false;
      if (idTerm && !deviceLabel.includes(idTerm)) return false;
      if (clientTerm && !clientLabel.toLowerCase().includes(clientTerm)) return false;
      return true;
    });
  }, [clientNameById, devices, modelById, transferSearch]);

  const nearbyDevices = useMemo(() => {
    if (!regionTarget) return [];
    const radiusValue = Number(radiusKm) || 0;
    if (!radiusValue) return [];
    return devices.filter((device) => {
      const coords = resolveDeviceCoords(device);
      if (!coords) return false;
      return distanceKm(regionTarget.lat, regionTarget.lng, coords.lat, coords.lng) <= radiusValue;
    });
  }, [devices, radiusKm, regionTarget]);

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

  const handleOpenTransfer = () => {
    setTransferForm((prev) => ({
      ...prev,
      destinationClientId: resolvedClientId || "",
      destinationTechnicianId: "",
      destinationType: prev.destinationType || "client",
    }));
    transferAddressState.setQuery("");
    setTransferSearch({ model: "", deviceId: "", client: "" });
    setTransferDrawerOpen(true);
  };

  const handleTransfer = () => {
    if (!selectedIds.size) {
      alert("Selecione equipamentos para transferir.");
      return;
    }

    if (transferForm.destinationType === "client" && !transferForm.destinationClientId) {
      alert("Selecione o cliente destino.");
      return;
    }

    if (
      (transferForm.destinationType === "technician" || transferForm.destinationType === "client_technician") &&
      !transferForm.destinationTechnicianId
    ) {
      alert("Selecione o técnico destino.");
      return;
    }

    alert(`Transferindo ${selectedIds.size} equipamentos.`);
    setSelectedIds(new Set());
    setTransferDrawerOpen(false);
  };

  const handleSelectRegion = (option) => {
    if (!option) return;
    if (!Number.isFinite(option.lat) || !Number.isFinite(option.lng)) return;
    setRegionTarget({
      lat: option.lat,
      lng: option.lng,
      label: option.label || option.concise,
    });
  };

  const handleSelectTransferAddress = (option) => {
    if (!option) return;
    setTransferForm((prev) => ({
      ...prev,
      address: option.label || option.concise || prev.address,
      latitude: option.lat ?? prev.latitude,
      longitude: option.lng ?? prev.longitude,
    }));
  };

  const selectedDevicesList = useMemo(
    () => devices.filter((device) => selectedIds.has(device.id)),
    [devices, selectedIds],
  );

  useEffect(() => {
    if (
      transferForm.destinationType !== "technician" &&
      transferForm.destinationType !== "client_technician"
    ) {
      return;
    }
    const technician = technicianOptions.find(
      (option) => String(option.id) === String(transferForm.destinationTechnicianId),
    );
    if (!technician) return;
    const resolvedAddress = resolveTechnicianAddress(technician);
    setTransferForm((prev) => ({
      ...prev,
      address: resolvedAddress || prev.address,
      latitude: technician.latitude ?? prev.latitude,
      longitude: technician.longitude ?? prev.longitude,
    }));
    transferAddressState.setQuery(resolvedAddress || "");
  }, [technicianOptions, transferAddressState, transferForm.destinationTechnicianId, transferForm.destinationType]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Estoque"
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
              onClick={handleOpenTransfer}
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

      <FilterBar
        left={
          <div className="flex w-full flex-wrap items-center gap-3">
            <div className="relative min-w-[220px] flex-1">
              <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-white/50" />
              <input
                value={searchClient}
                onChange={(event) => setSearchClient(event.target.value)}
                placeholder="Buscar lista/cliente"
                className="w-full rounded-xl border border-white/10 bg-black/30 py-2 pl-10 pr-4 text-sm text-white placeholder:text-white/50 focus:border-white/30 focus:outline-none"
              />
            </div>
            <input
              value={searchId}
              onChange={(event) => setSearchId(event.target.value)}
              placeholder="Buscar equipamento por ID"
              className="min-w-[200px] flex-1 rounded-xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-white placeholder:text-white/50 focus:border-white/30 focus:outline-none"
            />
            <input
              value={cityFilter}
              onChange={(event) => setCityFilter(event.target.value)}
              placeholder="Cidade/UF"
              className="min-w-[200px] flex-1 rounded-xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-white placeholder:text-white/50 focus:border-white/30 focus:outline-none"
            />
            <select
              value={availabilityFilter}
              onChange={(event) => setAvailabilityFilter(event.target.value)}
              className="min-w-[200px] flex-1 rounded-xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
            >
              {FILTER_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        }
      />

      {view === "geral" && (
        <DataTable>
            <thead className="bg-white/5 text-xs uppercase tracking-wide text-white/70">
              <tr className="text-left">
                <th className="px-4 py-3">Lista</th>
                <th className="px-4 py-3">Disponíveis</th>
                <th className="px-4 py-3">Vinculados</th>
                <th className="px-4 py-3 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/10">
              {loading && (
                <tr>
                  <td colSpan={4} className="px-4 py-6">
                    <SkeletonTable rows={6} columns={4} />
                  </td>
                </tr>
              )}
              {!loading && filteredClients.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-8">
                    <EmptyState title="Nenhuma lista encontrada." subtitle="Ajuste os filtros para visualizar o estoque." />
                  </td>
                </tr>
              )}
              {!loading &&
                filteredClients.map((client) => (
                  <tr key={client.clientId} className="hover:bg-white/5">
                    <td className="px-4 py-3 text-white">
                      <div className="flex items-center gap-2">
                        <Users className="h-4 w-4 text-white/40" />
                        <span>{client.name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-white/70">{client.available}</td>
                    <td className="px-4 py-3 text-white/70">{client.linked}</td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => {
                          setDetailsClientId(client.clientId);
                          setDetailsDrawerOpen(true);
                        }}
                        className="rounded-xl bg-white/10 px-3 py-2 text-sm text-white transition hover:bg-white/15"
                      >
                        Ver detalhes
                      </button>
                    </td>
                  </tr>
                ))}
            </tbody>
          </DataTable>
      )}

      {view === "cliente" && (
        <DataTable>
            <thead className="bg-white/5 text-xs uppercase tracking-wide text-white/70">
              <tr className="text-left">
                <th className="px-4 py-3">Selecionar</th>
                <th className="px-4 py-3">ID</th>
                <th className="px-4 py-3">Modelo</th>
                <th className="px-4 py-3">Cliente</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Localização</th>
                <th className="px-4 py-3">Vínculo</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/10">
              {loading && (
                <tr>
                  <td colSpan={7} className="px-4 py-6">
                    <SkeletonTable rows={6} columns={7} />
                  </td>
                </tr>
              )}
              {!loading && filteredDevices.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-8">
                    <EmptyState title="Nenhum equipamento encontrado." subtitle="Refine os filtros para este cliente." />
                  </td>
                </tr>
              )}
              {!loading &&
                filteredDevices.map((device) => {
                  const location = [device.city, device.state].filter(Boolean).join(" - ") || "Base";
                  return (
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
                      <td className="px-4 py-3 text-white/70">
                        {clientNameById.get(String(device.clientId)) || "—"}
                      </td>
                      <td className="px-4 py-3">
                        <span className="rounded-lg bg-white/10 px-2 py-1 text-xs text-white/80">
                          {device.vehicleId ? "Vinculado" : "Disponível"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-white/70">{location}</td>
                      <td className="px-4 py-3 text-white/70">
                        {device.vehicle?.plate || device.vehicleId || "—"}
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </DataTable>
      )}

      {view === "mapa" && (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <div className="space-y-3 rounded-2xl border border-white/10 bg-transparent p-4">
            <h2 className="text-sm font-semibold text-white">Busca por região</h2>
            <div className="space-y-3">
              <AddressSearchInput
                state={mapSearchState}
                onSelect={handleSelectRegion}
                placeholder="Buscar endereço"
                variant="toolbar"
                containerClassName="w-full"
              />
              <input
                value={radiusKm}
                onChange={(event) => setRadiusKm(event.target.value)}
                placeholder="Raio (km)"
                className="w-full rounded-xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-white placeholder:text-white/50 focus:border-white/30 focus:outline-none"
              />
            </div>
            <div className="h-[360px] overflow-hidden rounded-xl border border-white/10">
              <MapContainer
                ref={mapRef}
                center={regionTarget ? [regionTarget.lat, regionTarget.lng] : DEFAULT_CENTER}
                zoom={regionTarget ? 12 : 4}
                style={{ height: "100%", width: "100%" }}
                whenReady={onMapReady}
              >
                <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="OpenStreetMap" />
                {regionTarget && (
                  <>
                    <Marker position={[regionTarget.lat, regionTarget.lng]} />
                    <Circle
                      center={[regionTarget.lat, regionTarget.lng]}
                      radius={(Number(radiusKm) || 0) * 1000}
                      pathOptions={{ color: "#38bdf8" }}
                    />
                  </>
                )}
                {nearbyDevices.map((device) => {
                  const coords = resolveDeviceCoords(device);
                  if (!coords) return null;
                  return <Marker key={device.id} position={[coords.lat, coords.lng]} />;
                })}
              </MapContainer>
            </div>
          </div>
          <DataTable>
              <thead className="bg-white/5 text-xs uppercase tracking-wide text-white/70">
                <tr className="text-left">
                  <th className="px-4 py-3">Modelo</th>
                  <th className="px-4 py-3">ID</th>
                  <th className="px-4 py-3">Cliente</th>
                  <th className="px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/10">
                {(regionTarget ? nearbyDevices : availableDevices).map((device) => (
                  <tr key={device.id} className="hover:bg-white/5">
                    <td className="px-4 py-3 text-white/80">
                      {modelById.get(device.modelId)?.name || device.model || "—"}
                    </td>
                    <td className="px-4 py-3 text-white/80">{device.uniqueId || device.id}</td>
                    <td className="px-4 py-3 text-white/70">
                      {clientNameById.get(String(device.clientId)) || "—"}
                    </td>
                    <td className="px-4 py-3 text-white/70">{device.vehicleId ? "Vinculado" : "Disponível"}</td>
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
        </div>
      )}

      <Drawer
        open={detailsDrawerOpen}
        onClose={() => {
          setDetailsDrawerOpen(false);
          setDetailsClientId(null);
        }}
        title={detailsClient?.name || "Detalhes do estoque"}
        description="Resumo do estoque e equipamentos vinculados."
      >
        <div className="space-y-4">
          <div className="rounded-xl border border-white/10 bg-white/5 p-4 text-sm text-white/80">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-xs uppercase tracking-[0.12em] text-white/50">Cliente</div>
                <div className="text-base text-white">{detailsClient?.name || "—"}</div>
              </div>
              <div className="text-right text-xs text-white/60">
                <div>Disponíveis: {detailsClient?.available ?? 0}</div>
                <div>Vinculados: {detailsClient?.linked ?? 0}</div>
              </div>
            </div>
          </div>
          <div className="max-h-[50vh] overflow-y-auto rounded-xl border border-white/10">
            <table className="w-full text-left text-xs text-white/70">
              <thead className="sticky top-0 bg-[#0f141c] text-[10px] uppercase tracking-wide text-white/50">
                <tr>
                  <th className="px-3 py-2">Modelo</th>
                  <th className="px-3 py-2">ID</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Localização</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/10">
                {detailsDevices.length ? (
                  detailsDevices.map((device) => {
                    const modelLabel = modelById.get(device.modelId)?.name || device.model || "—";
                    const location = [device.city, device.state].filter(Boolean).join(" - ") || "Base";
                    return (
                      <tr key={device.id}>
                        <td className="px-3 py-2">{modelLabel}</td>
                        <td className="px-3 py-2">{device.uniqueId || device.id}</td>
                        <td className="px-3 py-2">{device.vehicleId ? "Vinculado" : "Disponível"}</td>
                        <td className="px-3 py-2">{location}</td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={4} className="px-3 py-4 text-center text-white/50">
                      Nenhum equipamento encontrado.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </Drawer>

      <Drawer
        open={transferDrawerOpen}
        onClose={() => setTransferDrawerOpen(false)}
        title="Transferir equipamentos"
        description="Selecione cliente/técnico destino e anexe endereço da transferência."
      >
        <div className="space-y-4">
          <div className="rounded-xl border border-white/10 bg-white/5 p-4 text-sm text-white/80">
            <div className="flex items-center gap-2 text-white/60">
              <MapPin className="h-4 w-4" />
              {selectedIds.size} equipamentos selecionados
            </div>
            <div className="mt-3 space-y-1 text-xs text-white/60">
              {selectedDevicesList.map((device) => (
                <div key={device.id} className="flex justify-between">
                  <span>{modelById.get(device.modelId)?.name || "Modelo"}</span>
                  <span>{device.uniqueId || device.id}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            <input
              value={transferSearch.model}
              onChange={(event) => setTransferSearch((prev) => ({ ...prev, model: event.target.value }))}
              placeholder="Buscar por modelo"
              className="rounded-xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-white"
            />
            <input
              value={transferSearch.deviceId}
              onChange={(event) => setTransferSearch((prev) => ({ ...prev, deviceId: event.target.value }))}
              placeholder="Buscar por ID"
              className="rounded-xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-white"
            />
            <input
              value={transferSearch.client}
              onChange={(event) => setTransferSearch((prev) => ({ ...prev, client: event.target.value }))}
              placeholder="Buscar por cliente"
              className="rounded-xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-white"
            />
          </div>

          <div className="max-h-56 space-y-2 overflow-y-auto rounded-xl border border-white/10 bg-black/20 p-2 text-xs text-white/70">
            {transferCandidates.length ? (
              transferCandidates.map((device) => {
                const modelLabel = modelById.get(device.modelId)?.name || device.model || "Modelo";
                const clientLabel = clientNameById.get(String(device.clientId)) || "—";
                return (
                  <label key={device.id} className="flex items-center justify-between gap-3 px-2 py-1">
                    <span className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={selectedIds.has(device.id)}
                        onChange={() => toggleSelection(device.id)}
                        className="h-4 w-4 rounded border-white/30 bg-transparent"
                      />
                      <span>{modelLabel}</span>
                    </span>
                    <span className="text-white/50">
                      {device.uniqueId || device.id} · {clientLabel}
                    </span>
                  </label>
                );
              })
            ) : (
              <div className="px-2 py-2 text-white/50">Nenhum equipamento encontrado.</div>
            )}
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            <select
              value={transferForm.destinationType}
              onChange={(event) => setTransferForm((prev) => ({ ...prev, destinationType: event.target.value }))}
              className="rounded-xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-white"
            >
              <option value="client">Destino: Cliente</option>
              <option value="technician">Destino: Técnico</option>
              <option value="client_technician">Destino: Cliente + Técnico</option>
            </select>
            {(transferForm.destinationType === "client" || transferForm.destinationType === "client_technician") && (
              <select
                value={transferForm.destinationClientId}
                onChange={(event) => setTransferForm((prev) => ({ ...prev, destinationClientId: event.target.value }))}
                className="rounded-xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-white"
              >
                <option value="">Selecione o cliente</option>
                {clientOptions.map((client) => (
                  <option key={client.id} value={client.id}>
                    {client.name}
                  </option>
                ))}
              </select>
            )}
            {(transferForm.destinationType === "technician" || transferForm.destinationType === "client_technician") && (
              <select
                value={transferForm.destinationTechnicianId}
                onChange={(event) => setTransferForm((prev) => ({ ...prev, destinationTechnicianId: event.target.value }))}
                className="rounded-xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-white"
              >
                <option value="">
                  {techniciansLoading ? "Carregando técnicos..." : "Selecione o técnico"}
                </option>
                {technicianOptions.map((technician) => (
                  <option key={technician.id} value={technician.id}>
                    {technician.name}
                  </option>
                ))}
              </select>
            )}
          </div>
          <div className="space-y-2">
            <span className="text-xs text-white/60">Endereço da transferência</span>
            <AddressSearchInput
              state={transferAddressState}
              onSelect={handleSelectTransferAddress}
              placeholder="Buscar endereço"
              variant="toolbar"
              containerClassName="w-full"
              portalSuggestions
            />
            <input
              value={transferForm.referencePoint}
              onChange={(event) => setTransferForm((prev) => ({ ...prev, referencePoint: event.target.value }))}
              placeholder="Referência"
              className="w-full rounded-xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-white"
            />
          </div>
          <textarea
            value={transferForm.notes}
            onChange={(event) => setTransferForm((prev) => ({ ...prev, notes: event.target.value }))}
            placeholder="Observações"
            rows={3}
            className="w-full rounded-xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-white"
          />
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setTransferDrawerOpen(false)}
              className="rounded-xl border border-white/10 px-4 py-2 text-sm text-white"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleTransfer}
              className="rounded-xl bg-sky-500 px-4 py-2 text-sm font-medium text-black transition hover:bg-sky-400"
            >
              Transferir
            </button>
          </div>
        </div>
      </Drawer>
    </div>
  );
}
