import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, RefreshCw, Search, X } from "lucide-react";

import api from "../lib/api";
import { API_ROUTES } from "../lib/api-routes";
import { useTenant } from "../lib/tenant-context";
import { useGroups } from "../lib/hooks/useGroups";
import useVehicles, { formatVehicleLabel } from "../lib/hooks/useVehicles";
import PageHeader from "../components/ui/PageHeader";
import FilterBar from "../components/ui/FilterBar";
import DataTable from "../components/ui/DataTable";
import AutocompleteSelect from "../components/ui/AutocompleteSelect";
import { usePermissions } from "../lib/permissions/permission-gate";

const EMPTY_LIST = [];

const TABS = [
  { id: "mirrors", label: "Espelhamento", permission: { menuKey: "admin", pageKey: "mirrors", subKey: "mirrors-main" } },
  { id: "mirrored", label: "Espelhados", permission: { menuKey: "admin", pageKey: "mirrors", subKey: "mirrors-received" } },
];

function Drawer({ open, onClose, title, description, children }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[9998] flex">
      <div className="flex-1 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative h-full w-full max-w-3xl border-l border-white/10 bg-[#0f141c] shadow-3xl">
        <div className="flex items-start justify-between gap-4 border-b border-white/10 px-6 py-5">
          <div>
            <p className="text-xs uppercase tracking-[0.12em] text-white/50">Espelhamento</p>
            <h2 className="text-xl font-semibold text-white">{title}</h2>
            {description && <p className="text-sm text-white/60">{description}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-white/10 bg-white/5 p-2 text-white/70 transition hover:border-white/30 hover:text-white"
            aria-label="Fechar"
          >
            ×
          </button>
        </div>
        <div className="h-[calc(100%-80px)] overflow-y-auto px-6 py-4">{children}</div>
      </div>
    </div>
  );
}

function resolveClientType(client) {
  return (
    client?.attributes?.clientProfile?.clientType
    || client?.attributes?.clientType
    || ""
  );
}

function formatPeriod(startAt, endAt) {
  if (!startAt && !endAt) return "—";
  const start = startAt ? new Date(startAt) : null;
  const end = endAt ? new Date(endAt) : null;
  const format = (value) =>
    value?.toLocaleString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  return `${start ? format(start) : "—"} até ${end ? format(end) : "—"}`;
}

export default function MirrorReceivers() {
  const { user, tenantId } = useTenant();
  const { getPermission } = usePermissions();
  const mirrorsPermission = getPermission({ menuKey: "admin", pageKey: "mirrors" });
  const [context, setContext] = useState(null);
  const [mirrors, setMirrors] = useState(EMPTY_LIST);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [activeTab, setActiveTab] = useState("mirrors");
  const [search, setSearch] = useState("");
  const [clientFilter, setClientFilter] = useState("");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [detailsDrawerOpen, setDetailsDrawerOpen] = useState(false);
  const [activeMirror, setActiveMirror] = useState(null);
  const [detailsTab, setDetailsTab] = useState("geral");
  const [vehicleSearch, setVehicleSearch] = useState("");
  const [vehiclePickId, setVehiclePickId] = useState("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState(null);
  const [formMode, setFormMode] = useState("group");
  const [form, setForm] = useState({
    targetClientIds: [],
    vehicleGroupId: "",
    vehicleIds: [],
    permissionGroupId: "",
    startAt: "",
    endAt: "",
  });

  const resolvedClientId = tenantId || user?.clientId || null;
  const { vehicles } = useVehicles();
  const { groups } = useGroups({ params: resolvedClientId ? { clientId: resolvedClientId } : {} });

  const vehicleGroups = useMemo(
    () => groups.filter((entry) => entry.attributes?.kind === "VEHICLE_GROUP"),
    [groups],
  );
  const permissionGroups = useMemo(
    () => groups.filter((entry) => entry.attributes?.kind === "PERMISSION_GROUP"),
    [groups],
  );

  const availableTabs = useMemo(() => {
    const base = TABS.filter((tab) => getPermission(tab.permission).canShow);
    if (context?.mode === "target") {
      return base.filter((tab) => tab.id === "mirrors");
    }
    return base;
  }, [context?.mode, getPermission]);

  useEffect(() => {
    if (!availableTabs.length) {
      setActiveTab("");
      return;
    }
    const stillAvailable = availableTabs.some((tab) => tab.id === activeTab);
    if (!stillAvailable) {
      setActiveTab(availableTabs[0].id);
    }
  }, [activeTab, availableTabs]);

  const vehicleMap = useMemo(
    () => new Map(vehicles.map((vehicle) => [String(vehicle.id), vehicle])),
    [vehicles],
  );

  const vehicleOptions = useMemo(
    () =>
      vehicles.map((vehicle) => ({
        value: String(vehicle.id),
        label: formatVehicleLabel(vehicle),
        description: vehicle.plate || "",
      })),
    [vehicles],
  );

  const groupOptions = useMemo(
    () =>
      vehicleGroups.map((group) => ({
        value: String(group.id),
        label: group.name,
        description: `${group.attributes?.vehicleIds?.length || 0} veículos`,
      })),
    [vehicleGroups],
  );

  const targetOptions = useMemo(() => {
    const list = context?.targets || [];
    return list.map((client) => ({
      value: String(client.id),
      label: client.name,
      description: resolveClientType(client),
    }));
  }, [context]);

  const ownerOptions = useMemo(() => {
    const list = context?.owners || [];
    return list.map((client) => ({
      value: String(client.id),
      label: client.name,
    }));
  }, [context]);

  const loadContext = useCallback(async () => {
    try {
      const response = await api.get("mirrors/context");
      setContext(response?.data || null);
    } catch (loadError) {
      console.error("Erro ao carregar contexto de espelhamento", loadError);
      setContext(null);
    }
  }, []);

  const loadMirrors = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError(null);
    try {
      const params = {};
      if (context?.mode === "target") {
        params.targetClientId = resolvedClientId;
      } else if (context?.mode === "admin" && clientFilter) {
        params.ownerClientId = clientFilter;
      } else if (context?.mode !== "admin") {
        params.ownerClientId = resolvedClientId;
      }
      const response = await api.get(API_ROUTES.mirrors, { params });
      const list = response?.data?.mirrors || response?.data || [];
      setMirrors(Array.isArray(list) ? list : EMPTY_LIST);
    } catch (loadError) {
      console.error("Erro ao carregar espelhamentos", loadError);
      setError(loadError);
      setMirrors(EMPTY_LIST);
    } finally {
      setLoading(false);
    }
  }, [clientFilter, context?.mode, resolvedClientId, user]);

  useEffect(() => {
    loadContext();
  }, [loadContext]);

  useEffect(() => {
    if (!context) return;
    loadMirrors();
  }, [context, loadMirrors]);

  const isReceiverMode = context?.mode === "target";
  const isOwnerMode = !isReceiverMode;
  const isReceiverEditing = isReceiverMode && Boolean(activeMirror);
  const showOwnerFilter = context?.mode === "target";

  const filteredMirrors = useMemo(() => {
    const term = search.trim().toLowerCase();
    const filtered = term
      ? mirrors.filter((mirror) => {
          const values = [
            mirror.ownerClientName,
            mirror.targetClientName,
            mirror.vehicleGroupName,
            mirror.createdByName,
          ]
            .filter(Boolean)
            .join(" ")
            .toLowerCase();
          return values.includes(term);
        })
      : mirrors;
    if (!showOwnerFilter || !clientFilter) return filtered;
    return filtered.filter((mirror) => String(mirror.ownerClientId) === String(clientFilter));
  }, [clientFilter, mirrors, search, showOwnerFilter]);

  const mirroredRows = useMemo(() => {
    const rows = [];
    mirrors.forEach((mirror) => {
      (mirror.vehicleIds || []).forEach((vehicleId) => {
        const vehicle = vehicleMap.get(String(vehicleId));
        const label = vehicle ? formatVehicleLabel(vehicle) : `Veículo ${vehicleId}`;
        rows.push({
          id: `${mirror.id}-${vehicleId}`,
          vehicleLabel: label,
          targetLabel: mirror.targetClientName || "—",
          period: formatPeriod(mirror.startAt, mirror.endAt),
          mirror,
        });
      });
    });
    if (!vehicleSearch) return rows;
    const term = vehicleSearch.trim().toLowerCase();
    return rows.filter((row) => row.vehicleLabel.toLowerCase().includes(term));
  }, [mirrors, vehicleMap, vehicleSearch]);

  const openNewDrawer = () => {
    setFormMode("group");
    setFormError(null);
    setActiveMirror(null);
    setForm({
      targetClientIds: [],
      vehicleGroupId: "",
      vehicleIds: [],
      permissionGroupId: "",
      startAt: "",
      endAt: "",
    });
    setDrawerOpen(true);
  };

  const openEditDrawer = (mirror) => {
    setFormError(null);
    setActiveMirror(mirror);
    setFormMode(mirror.vehicleGroupId ? "group" : "single");
    setForm({
      targetClientIds: mirror.targetClientId ? [String(mirror.targetClientId)] : [],
      vehicleGroupId: mirror.vehicleGroupId ? String(mirror.vehicleGroupId) : "",
      vehicleIds: (mirror.vehicleIds || []).map(String),
      permissionGroupId: mirror.permissionGroupId ? String(mirror.permissionGroupId) : "",
      startAt: mirror.startAt ? mirror.startAt.slice(0, 16) : "",
      endAt: mirror.endAt ? mirror.endAt.slice(0, 16) : "",
    });
    setDrawerOpen(true);
  };

  const openDetailsDrawer = (mirror) => {
    setActiveMirror(mirror);
    setDetailsTab("geral");
    setVehicleSearch("");
    setDetailsDrawerOpen(true);
  };

  const saveMirror = async (event) => {
    event.preventDefault();
    if (saving) return;
    setFormError(null);
    setSaving(true);
    try {
      if (isReceiverEditing) {
        await api.put(`${API_ROUTES.mirrors}/${activeMirror.id}`, {
          permissionGroupId: form.permissionGroupId || null,
        });
      } else {
        const targets = form.targetClientIds.filter(Boolean);
        if (!targets.length) {
          setFormError("Selecione ao menos um destino.");
          setSaving(false);
          return;
        }
        if (formMode === "group" && !form.vehicleGroupId) {
          setFormError("Selecione o grupo de veículos.");
          setSaving(false);
          return;
        }
        if (formMode === "single" && !form.vehicleIds.length) {
          setFormError("Selecione ao menos um veículo.");
          setSaving(false);
          return;
        }
        if (!form.startAt || !form.endAt) {
          setFormError("Informe o período de início e fim.");
          setSaving(false);
          return;
        }
        const payloadBase = {
          vehicleGroupId: formMode === "group" ? form.vehicleGroupId : null,
          vehicleIds: formMode === "single" ? form.vehicleIds : [],
          permissionGroupId: form.permissionGroupId || null,
          startAt: form.startAt ? new Date(form.startAt).toISOString() : null,
          endAt: form.endAt ? new Date(form.endAt).toISOString() : null,
        };

        await Promise.all(
          targets.map((targetClientId) =>
            api.post(API_ROUTES.mirrors, {
              ...payloadBase,
              targetClientId,
            }),
          ),
        );
      }
      setDrawerOpen(false);
      setActiveMirror(null);
      await loadMirrors();
    } catch (saveError) {
      console.error("Erro ao salvar espelhamento", saveError);
      setFormError(saveError?.response?.data?.message || saveError?.message || "Erro ao salvar espelhamento.");
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async (mirror) => {
    if (!window.confirm("Remover espelhamento?")) return;
    try {
      await api.delete(`${API_ROUTES.mirrors}/${mirror.id}`);
      await loadMirrors();
    } catch (removeError) {
      console.error("Erro ao remover espelhamento", removeError);
      setError(removeError);
    }
  };

  return (
    <div className="space-y-6 text-white">
      <PageHeader
        title="Espelhamento"
        subtitle="Gerencie os espelhamentos ativos entre clientes."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => loadMirrors()}
              className="rounded-xl bg-white/10 px-4 py-2 text-sm text-white transition hover:bg-white/15"
            >
              <span className="inline-flex items-center gap-2">
                <RefreshCw className="h-4 w-4" /> Atualizar
              </span>
            </button>
            {isOwnerMode && mirrorsPermission.isFull && (
              <button
                type="button"
                onClick={openNewDrawer}
                className="rounded-xl bg-sky-500 px-4 py-2 text-sm font-medium text-black transition hover:bg-sky-400"
              >
                <span className="inline-flex items-center gap-2">
                  <Plus className="h-4 w-4" /> Novo espelhamento
                </span>
              </button>
            )}
          </div>
        }
      />

      {error && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {error?.response?.data?.message || error.message}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {availableTabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={`rounded-xl px-4 py-2 text-sm transition ${
              activeTab === tab.id ? "bg-sky-500 text-black" : "bg-white/10 text-white hover:bg-white/15"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {!availableTabs.length && (
        <div className="rounded-xl border border-white/10 bg-white/5 p-6 text-sm text-white/70">
          Sem acesso ao módulo de espelhamentos.
        </div>
      )}

      {activeTab === "mirrors" && availableTabs.length > 0 && (
        <div className="space-y-4">
          <FilterBar
            left={
              <div className="flex w-full flex-wrap items-center gap-3">
                <div className="relative min-w-[240px] flex-1">
                  <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-white/50" />
                  <input
                    placeholder={isReceiverMode ? "Buscar cliente ou grupo" : "Buscar destino ou grupo"}
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    className="w-full rounded-xl border border-white/10 bg-black/30 py-2 pl-10 pr-4 text-sm text-white placeholder:text-white/50 focus:border-white/30 focus:outline-none"
                  />
                </div>
                {showOwnerFilter && (
                  <div className="min-w-[220px] flex-1">
                    <AutocompleteSelect
                      placeholder="Selecionar cliente"
                      value={clientFilter}
                      options={[
                        { value: "", label: "Todos os clientes" },
                        ...ownerOptions,
                      ]}
                      onChange={(value) => setClientFilter(value ?? "")}
                    />
                  </div>
                )}
              </div>
            }
          />

          <DataTable tableClassName="text-white/80">
            <thead className="bg-white/5 text-xs uppercase tracking-wide text-white/60">
              <tr>
                <th className="px-4 py-3 text-left">{isReceiverMode ? "Cliente" : "Destino"}</th>
                <th className="px-4 py-3 text-left">Grupo de veículos</th>
                <th className="px-4 py-3 text-left">Quem espelhou</th>
                <th className="px-4 py-3 text-left">Período</th>
                {isReceiverMode && <th className="px-4 py-3 text-left">Quantidade</th>}
                <th className="px-4 py-3 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/10">
              {loading && (
                <tr>
                  <td colSpan={isReceiverMode ? 6 : 5} className="px-4 py-6 text-sm text-white/60">
                    Carregando espelhamentos...
                  </td>
                </tr>
              )}
              {!loading && !filteredMirrors.length && (
                <tr>
                  <td colSpan={isReceiverMode ? 6 : 5} className="px-4 py-6 text-sm text-white/60">
                    Nenhum espelhamento encontrado.
                  </td>
                </tr>
              )}
              {!loading &&
                filteredMirrors.map((mirror) => (
                  <tr key={mirror.id} className="hover:bg-white/5">
                    <td className="px-4 py-3 text-white">
                      {isReceiverMode ? mirror.ownerClientName : mirror.targetClientName}
                    </td>
                    <td className="px-4 py-3 text-white/70">{mirror.vehicleGroupName || "—"}</td>
                    <td className="px-4 py-3 text-white/70">{mirror.createdByName || "—"}</td>
                    <td className="px-4 py-3 text-white/70">{formatPeriod(mirror.startAt, mirror.endAt)}</td>
                    {isReceiverMode && (
                      <td className="px-4 py-3 text-white/70">{mirror.vehicleIds?.length || 0}</td>
                    )}
                    <td className="px-4 py-3 text-right">
                      <div className="flex justify-end gap-2">
                        {(isOwnerMode || isReceiverMode) && mirrorsPermission.isFull && (
                          <button
                            type="button"
                            onClick={() => openEditDrawer(mirror)}
                            className="rounded-lg border border-white/10 px-3 py-1 text-xs text-white/80 hover:border-white/30"
                          >
                            Editar
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => openDetailsDrawer(mirror)}
                          className="rounded-lg border border-white/10 px-3 py-1 text-xs text-white/80 hover:border-white/30"
                        >
                          Detalhes
                        </button>
                        {isOwnerMode && mirrorsPermission.isFull && (
                          <button
                            type="button"
                            onClick={() => handleRemove(mirror)}
                            className="rounded-lg border border-red-500/40 px-3 py-1 text-xs text-red-300 hover:bg-red-500/10"
                          >
                            Remover
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
            </tbody>
          </DataTable>
        </div>
      )}

      {activeTab === "mirrored" && availableTabs.length > 0 && (
        <div className="space-y-4">
          <div className="relative min-w-[240px]">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-white/50" />
            <input
              placeholder="Buscar veículo"
              value={vehicleSearch}
              onChange={(event) => setVehicleSearch(event.target.value)}
              className="w-full rounded-xl border border-white/10 bg-black/30 py-2 pl-10 pr-4 text-sm text-white placeholder:text-white/50 focus:border-white/30 focus:outline-none"
            />
          </div>
          <DataTable tableClassName="text-white/80">
            <thead className="bg-white/5 text-xs uppercase tracking-wide text-white/60">
              <tr>
                <th className="px-4 py-3 text-left">Veículo</th>
                <th className="px-4 py-3 text-left">Destino</th>
                <th className="px-4 py-3 text-left">Quantidade</th>
                <th className="px-4 py-3 text-left">Período</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/10">
              {!mirroredRows.length && (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-sm text-white/60">
                    Nenhum veículo espelhado encontrado.
                  </td>
                </tr>
              )}
              {mirroredRows.map((row) => (
                <tr key={row.id} className="hover:bg-white/5">
                  <td className="px-4 py-3 text-white">{row.vehicleLabel}</td>
                  <td className="px-4 py-3 text-white/70">{row.targetLabel}</td>
                  <td className="px-4 py-3 text-white/70">{row.mirror.vehicleIds?.length || 0}</td>
                  <td className="px-4 py-3 text-white/70">{row.period}</td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        </div>
      )}

      <Drawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        title={activeMirror ? "Editar espelhamento" : "Novo espelhamento"}
        description="Defina destinos, veículos e período."
      >
        <form onSubmit={saveMirror} className="space-y-4">
          {isOwnerMode && (
            <label className="text-sm">
              <span className="block text-xs uppercase tracking-wide text-white/60">Destinos</span>
              <select
                multiple
                value={form.targetClientIds}
                onChange={(event) =>
                  setForm((prev) => ({
                    ...prev,
                    targetClientIds: Array.from(event.target.selectedOptions).map((option) => option.value),
                  }))
                }
                className="mt-1 h-32 w-full rounded-lg border border-border bg-layer px-3 py-2 text-sm"
              >
                {targetOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label} {option.description ? `(${option.description})` : ""}
                  </option>
                ))}
              </select>
            </label>
          )}

          <div className="rounded-xl border border-white/10 bg-white/5 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-xs uppercase tracking-wide text-white/50">Seleção de veículos</p>
                <p className="text-xs text-white/60">Escolha por grupo ou veículos avulsos.</p>
              </div>
              {!isReceiverEditing && (
                <div className="flex gap-2 text-xs">
                  {["group", "single"].map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => setFormMode(mode)}
                      className={`rounded-full border px-3 py-1 uppercase tracking-wide ${
                        formMode === mode
                          ? "border-sky-400 bg-sky-400/20 text-sky-100"
                          : "border-white/10 text-white/60 hover:border-white/30 hover:text-white"
                      }`}
                    >
                      {mode === "group" ? "Grupo" : "Avulso"}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {formMode === "group" && !isReceiverEditing && (
              <div className="mt-4">
                <AutocompleteSelect
                  label="Grupo de veículos"
                  placeholder="Selecionar grupo"
                  value={form.vehicleGroupId}
                  onChange={(value) => setForm((prev) => ({ ...prev, vehicleGroupId: value || "" }))}
                  options={groupOptions}
                />
              </div>
            )}

            {formMode === "single" && !isReceiverEditing && (
              <div className="mt-4 space-y-3">
                <div className="grid gap-3 md:grid-cols-[1fr_auto]">
                  <AutocompleteSelect
                    label="Buscar veículo"
                    placeholder="Buscar por placa, nome ou modelo"
                    value={vehiclePickId}
                    onChange={(value) => setVehiclePickId(value)}
                    options={vehicleOptions}
                  />
                  <button
                    type="button"
                    onClick={() => {
                      if (!vehiclePickId) return;
                      setForm((prev) => ({
                        ...prev,
                        vehicleIds: Array.from(new Set([...prev.vehicleIds, vehiclePickId])),
                      }));
                      setVehiclePickId("");
                    }}
                    className="mt-6 rounded-xl bg-sky-500 px-4 py-2 text-sm font-medium text-black transition hover:bg-sky-400"
                  >
                    Adicionar
                  </button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {form.vehicleIds.map((id) => {
                    const vehicle = vehicleMap.get(String(id));
                    return (
                      <span
                        key={id}
                        className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/20 px-3 py-1 text-xs text-white/80"
                      >
                        {vehicle ? formatVehicleLabel(vehicle) : `Veículo ${id}`}
                        <button
                          type="button"
                          onClick={() =>
                            setForm((prev) => ({
                              ...prev,
                              vehicleIds: prev.vehicleIds.filter((value) => String(value) !== String(id)),
                            }))
                          }
                          className="text-white/60 hover:text-white"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </span>
                    );
                  })}
                  {!form.vehicleIds.length && (
                    <span className="text-xs text-white/40">Nenhum veículo selecionado.</span>
                  )}
                </div>
              </div>
            )}
          </div>

          <label className="text-sm">
            <span className="block text-xs uppercase tracking-wide text-white/60">Grupo de permissões</span>
            <select
              value={form.permissionGroupId}
              onChange={(event) => setForm((prev) => ({ ...prev, permissionGroupId: event.target.value }))}
              className="mt-1 w-full rounded-lg border border-border bg-layer px-3 py-2 text-sm"
            >
              <option value="">Selecionar grupo</option>
              {permissionGroups.map((group) => (
                <option key={group.id} value={group.id}>
                  {group.name}
                </option>
              ))}
            </select>
          </label>

          <div className="grid gap-3 md:grid-cols-2">
            <label className="text-sm">
              <span className="block text-xs uppercase tracking-wide text-white/60">Início</span>
              <input
                type="datetime-local"
                value={form.startAt}
                onChange={(event) => setForm((prev) => ({ ...prev, startAt: event.target.value }))}
                className="mt-1 w-full rounded-lg border border-border bg-layer px-3 py-2 text-sm"
                disabled={isReceiverEditing}
              />
            </label>
            <label className="text-sm">
              <span className="block text-xs uppercase tracking-wide text-white/60">Fim</span>
              <input
                type="datetime-local"
                value={form.endAt}
                onChange={(event) => setForm((prev) => ({ ...prev, endAt: event.target.value }))}
                className="mt-1 w-full rounded-lg border border-border bg-layer px-3 py-2 text-sm"
                disabled={isReceiverEditing}
              />
            </label>
          </div>

          {formError && (
            <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
              {formError}
            </div>
          )}

          <div className="flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={() => setDrawerOpen(false)}
              className="rounded-xl border border-border px-4 py-2 text-sm text-white/70 hover:bg-white/10"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={saving}
              className="rounded-xl bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90 disabled:opacity-60"
            >
              {saving ? "Salvando…" : activeMirror ? "Salvar alterações" : "Criar espelhamento"}
            </button>
          </div>
        </form>
      </Drawer>

      <Drawer
        open={detailsDrawerOpen}
        onClose={() => setDetailsDrawerOpen(false)}
        title="Detalhes do espelhamento"
        description="Visualize informações gerais e veículos vinculados."
      >
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {["geral", "veiculos", "seguranca"].map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setDetailsTab(tab)}
                className={`rounded-xl px-4 py-2 text-sm transition ${
                  detailsTab === tab ? "bg-sky-500 text-black" : "bg-white/10 text-white hover:bg-white/15"
                }`}
              >
                {tab === "geral" ? "Geral" : tab === "veiculos" ? "Veículos" : "Segurança"}
              </button>
            ))}
          </div>

          {detailsTab === "geral" && activeMirror && (
            <div className="space-y-3 text-sm text-white/70">
              <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                <p>
                  <span className="text-white/50">Destinos:</span>{" "}
                  {activeMirror.targetClientName || "—"}
                </p>
                <p>
                  <span className="text-white/50">Quantidade:</span>{" "}
                  {activeMirror.vehicleIds?.length || 0} veículos
                </p>
                <p>
                  <span className="text-white/50">Período:</span>{" "}
                  {formatPeriod(activeMirror.startAt, activeMirror.endAt)}
                </p>
                <p>
                  <span className="text-white/50">Quem espelhou:</span>{" "}
                  {activeMirror.createdByName || "—"}
                </p>
              </div>
            </div>
          )}

          {detailsTab === "veiculos" && activeMirror && (
            <div className="space-y-3">
              <div className="relative">
                <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-white/50" />
                <input
                  placeholder="Buscar veículo"
                  value={vehicleSearch}
                  onChange={(event) => setVehicleSearch(event.target.value)}
                  className="w-full rounded-xl border border-white/10 bg-black/30 py-2 pl-10 pr-4 text-sm text-white placeholder:text-white/50 focus:border-white/30 focus:outline-none"
                />
              </div>
              <div className="space-y-2">
                {(activeMirror.vehicleIds || [])
                  .map((id) => vehicleMap.get(String(id)))
                  .filter(Boolean)
                  .filter((vehicle) => {
                    if (!vehicleSearch) return true;
                    return formatVehicleLabel(vehicle).toLowerCase().includes(vehicleSearch.toLowerCase());
                  })
                  .map((vehicle) => (
                    <div key={vehicle.id} className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/80">
                      {formatVehicleLabel(vehicle)}
                    </div>
                  ))}
                {!activeMirror.vehicleIds?.length && (
                  <div className="text-sm text-white/60">Nenhum veículo disponível.</div>
                )}
              </div>
            </div>
          )}

          {detailsTab === "seguranca" && (
            <div className="rounded-xl border border-white/10 bg-white/5 p-4 text-sm text-white/70">
              Este espelhamento é restrito ao cliente de origem e ao destino configurado.
              Veículos e dados só podem ser acessados conforme as permissões do perfil selecionado.
            </div>
          )}
        </div>
      </Drawer>
    </div>
  );
}
