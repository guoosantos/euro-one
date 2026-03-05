import { Pencil, Plus, Search } from "lucide-react";
import React, { useCallback, useEffect, useMemo, useState } from "react";

import { CoreApi } from "../lib/coreApi.js";
import { useTenant } from "../lib/tenant-context.jsx";
import Button from "../ui/Button";
import Field from "../ui/Field";
import Input from "../ui/Input";
import PageHeader from "../components/ui/PageHeader.jsx";
import FilterBar from "../components/ui/FilterBar.jsx";
import DataTable from "../components/ui/DataTable.jsx";
import EmptyState from "../components/ui/EmptyState.jsx";
import SkeletonTable from "../components/ui/SkeletonTable.jsx";
import AutocompleteSelect from "../components/ui/AutocompleteSelect.jsx";
import { normalizePortCounts } from "../lib/device-ports.js";

function Drawer({ open, onClose, title, description, children }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[9998] flex">
      <div className="flex-1 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative h-full w-full max-w-4xl border-l border-white/10 bg-[#0f141c] shadow-3xl">
        <div className="flex items-start justify-between gap-4 border-b border-white/10 px-6 py-5">
          <div>
            <p className="text-xs uppercase tracking-[0.12em] text-white/50">Modelos & Portas</p>
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

function formatPortCountsSummary(model) {
  const counts = normalizePortCounts(model?.portCounts, model?.ports);
  const labels = {
    di: "DI",
    do: "DO",
    rs232: "RS232",
    rs485: "RS485",
    can: "CAN",
    lora: "LoRa",
    wifi: "Wi-Fi",
    bluetooth: "BT",
  };
  const entries = Object.entries(counts).filter(([, value]) => Number(value) > 0);
  if (!entries.length) return "—";
  return entries.map(([key, value]) => `${labels[key] || key.toUpperCase()}: ${value}`).join(" · ");
}

export default function Products() {
  const { tenants, tenantId, tenantScope, user } = useTenant();
  const [models, setModels] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [searchModel, setSearchModel] = useState("");
  const [searchManufacturer, setSearchManufacturer] = useState("");
  const [editingId, setEditingId] = useState(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState("basico");
  const [form, setForm] = useState({
    name: "",
    brand: "",
    prefix: "",
    protocol: "",
    connectivity: "",
    version: "",
    jammerBlockTime: "",
    panelBlockTime: "",
    jammerDetectionTime: "",
    frequency: "",
    blockMode: "",
    resetMode: "",
    workshopMode: "",
    productionDate: "",
    notes: "",
    isClientDefault: false,
    defaultClientId: "",
    portCounts: {
      di: "",
      do: "",
      rs232: "",
      rs485: "",
      can: "",
      lora: "",
      wifi: "",
      bluetooth: "",
    },
    technicalTimes: [],
    productionModes: [],
  });

  const resolvedClientId =
    tenantScope === "ALL" ? null : (tenantId || user?.clientId || null);

  const buildModelCounts = useCallback((devices = []) => {
    const counts = new Map();
    devices.forEach((device) => {
      const modelId =
        device?.modelId ||
        device?.productId ||
        device?.attributes?.modelId ||
        device?.attributes?.productId ||
        device?.model?.id ||
        null;
      if (!modelId) return;
      const key = String(modelId);
      if (!counts.has(key)) {
        counts.set(key, { available: 0, linked: 0, total: 0 });
      }
      const bucket = counts.get(key);
      if (device?.vehicleId) {
        bucket.linked += 1;
      } else {
        bucket.available += 1;
      }
      bucket.total += 1;
    });
    return counts;
  }, []);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [modelList, deviceList] = await Promise.all([
        CoreApi.models(resolvedClientId ? { clientId: resolvedClientId } : undefined),
        CoreApi.listDevices(resolvedClientId ? { clientId: resolvedClientId } : undefined).catch(() => null),
      ]);
      let nextModels = Array.isArray(modelList) ? modelList : [];

      if (Array.isArray(deviceList)) {
        const counts = buildModelCounts(deviceList);
        nextModels = nextModels.map((model) => {
          const bucket = counts.get(String(model.id)) || { available: 0, linked: 0, total: 0 };
          return {
            ...model,
            availableCount: bucket.available,
            linkedCount: bucket.linked,
            totalCount: bucket.total,
          };
        });
      }

      setModels(nextModels);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError : new Error("Falha ao carregar modelos"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [resolvedClientId]);

  const filtered = useMemo(() => {
    const modelTerm = searchModel.trim().toLowerCase();
    const manufacturerTerm = searchManufacturer.trim().toLowerCase();
    return models.filter((model) => {
      if (modelTerm) {
        const modelHaystack = [model.name, model.protocol]
          .filter(Boolean)
          .map((value) => String(value).toLowerCase());
        if (!modelHaystack.some((value) => value.includes(modelTerm))) return false;
      }
      if (manufacturerTerm) {
        const manufacturer = String(model.brand || "").toLowerCase();
        if (!manufacturer.includes(manufacturerTerm)) return false;
      }
      return true;
    });
  }, [models, searchManufacturer, searchModel]);

  const clientOptions = useMemo(
    () =>
      (Array.isArray(tenants) ? tenants : []).map((tenant) => ({
        value: tenant.id,
        label: tenant.name || tenant.company || tenant.id,
      })),
    [tenants],
  );

  const loadClientOptions = useCallback(
    async ({ query, page, pageSize }) => {
      const term = (query || "").trim().toLowerCase();
      const filteredClients = clientOptions.filter((client) =>
        client.label.toLowerCase().includes(term),
      );
      const start = (page - 1) * pageSize;
      const paged = filteredClients.slice(start, start + pageSize);
      return { options: paged, hasMore: start + pageSize < filteredClients.length };
    },
    [clientOptions],
  );

  function updatePortCount(key, value) {
    setForm((current) => ({
      ...current,
      portCounts: { ...(current.portCounts || {}), [key]: value },
    }));
  }

  function addDynamicItem(listKey) {
    setForm((current) => ({
      ...current,
      [listKey]: [
        ...(current[listKey] || []),
        { id: crypto.randomUUID(), label: "", value: "", description: "" },
      ],
    }));
  }

  function updateDynamicItem(listKey, index, field, value) {
    setForm((current) => {
      const items = Array.isArray(current[listKey]) ? [...current[listKey]] : [];
      items[index] = { ...(items[index] || {}), [field]: value };
      return { ...current, [listKey]: items };
    });
  }

  function removeDynamicItem(listKey, index) {
    setForm((current) => ({
      ...current,
      [listKey]: (current[listKey] || []).filter((_, idx) => idx !== index),
    }));
  }

  function openDrawer(model) {
    if (model) {
      const counts = normalizePortCounts(model.portCounts, model.ports);
      const technicalTimes = Array.isArray(model.technicalTimes) ? [...model.technicalTimes] : [];
      if (technicalTimes.length === 0) {
        if (model.jammerBlockTime) {
          technicalTimes.push({
            id: crypto.randomUUID(),
            label: "Tempo bloqueio Jammer",
            value: model.jammerBlockTime,
            description: "",
          });
        }
        if (model.panelBlockTime) {
          technicalTimes.push({
            id: crypto.randomUUID(),
            label: "Tempo bloqueio painel",
            value: model.panelBlockTime,
            description: "",
          });
        }
        if (model.jammerDetectionTime) {
          technicalTimes.push({
            id: crypto.randomUUID(),
            label: "Tempo detecção Jammer",
            value: model.jammerDetectionTime,
            description: "",
          });
        }
      }
      const productionModes = Array.isArray(model.productionModes) ? [...model.productionModes] : [];
      if (productionModes.length === 0) {
        if (model.blockMode) {
          productionModes.push({
            id: crypto.randomUUID(),
            label: "Modo bloqueio",
            value: model.blockMode,
            description: "",
          });
        }
        if (model.resetMode) {
          productionModes.push({
            id: crypto.randomUUID(),
            label: "Modo reset",
            value: model.resetMode,
            description: "",
          });
        }
        if (model.workshopMode) {
          productionModes.push({
            id: crypto.randomUUID(),
            label: "Modo oficina",
            value: model.workshopMode,
            description: "",
          });
        }
      }
      setEditingId(model.id);
      setForm({
        name: model.name || "",
        brand: model.brand || "",
        prefix: model.prefix || "",
        protocol: model.protocol || "",
        connectivity: model.connectivity || "",
        version: model.version || "",
        jammerBlockTime: model.jammerBlockTime || "",
        panelBlockTime: model.panelBlockTime || "",
        jammerDetectionTime: model.jammerDetectionTime || "",
        frequency: model.frequency || "",
        blockMode: model.blockMode || "",
        resetMode: model.resetMode || "",
        workshopMode: model.workshopMode || "",
        productionDate: model.productionDate || "",
        notes: model.notes || "",
        isClientDefault: Boolean(model.isClientDefault),
        defaultClientId: model.defaultClientId || "",
        portCounts: {
          di: String(Number(counts.di || 0)),
          do: String(Number(counts.do || 0)),
          rs232: String(Number(counts.rs232 || 0)),
          rs485: String(Number(counts.rs485 || 0)),
          can: String(Number(counts.can || 0)),
          lora: String(Number(counts.lora || 0)),
          wifi: String(Number(counts.wifi || 0)),
          bluetooth: String(Number(counts.bluetooth || 0)),
        },
        technicalTimes,
        productionModes,
      });
    } else {
      setEditingId(null);
      setForm({
        name: "",
        brand: "",
        prefix: "",
        protocol: "",
        connectivity: "",
        version: "",
        jammerBlockTime: "",
        panelBlockTime: "",
        jammerDetectionTime: "",
        frequency: "",
        blockMode: "",
        resetMode: "",
        workshopMode: "",
        productionDate: "",
        notes: "",
        isClientDefault: false,
        defaultClientId: "",
        portCounts: {
          di: "",
          do: "",
          rs232: "",
          rs485: "",
          can: "",
          lora: "",
          wifi: "",
          bluetooth: "",
        },
        technicalTimes: [],
        productionModes: [],
      });
    }
    setActiveTab("basico");
    setDrawerOpen(true);
  }

  async function handleSave(event) {
    event.preventDefault();
    if (!form.name.trim() || !form.brand.trim()) {
      alert("Informe nome e fabricante");
      return;
    }
    setSaving(true);
    try {
      const portCounts = Object.entries(form.portCounts || {}).reduce((acc, [key, value]) => {
        const numeric = Number(value);
        acc[key] = Number.isFinite(numeric) ? Math.max(0, Math.trunc(numeric)) : 0;
        return acc;
      }, {});
      const payload = {
        name: form.name.trim(),
        brand: form.brand.trim(),
        prefix: form.prefix ? String(form.prefix).trim() : undefined,
        protocol: form.protocol.trim() || undefined,
        connectivity: form.connectivity.trim() || undefined,
        version: form.version.trim() || undefined,
        jammerBlockTime: form.jammerBlockTime.trim() || undefined,
        panelBlockTime: form.panelBlockTime.trim() || undefined,
        jammerDetectionTime: form.jammerDetectionTime.trim() || undefined,
        frequency: form.frequency.trim() || undefined,
        blockMode: form.blockMode.trim() || undefined,
        resetMode: form.resetMode.trim() || undefined,
        workshopMode: form.workshopMode.trim() || undefined,
        productionDate: form.productionDate || undefined,
        notes: form.notes.trim() || undefined,
        isClientDefault: form.isClientDefault || false,
        defaultClientId: form.defaultClientId || undefined,
        portCounts,
        technicalTimes: (form.technicalTimes || []).filter((item) => item?.label?.trim()),
        productionModes: (form.productionModes || []).filter((item) => item?.label?.trim()),
      };
      if (editingId) {
        await CoreApi.updateModel(editingId, payload);
      } else {
        await CoreApi.createModel(payload);
      }
      setDrawerOpen(false);
      openDrawer(null);
      await load();
    } catch (requestError) {
      alert(requestError?.message || "Falha ao salvar modelo");
    } finally {
      setSaving(false);
    }
  }

  const renderDynamicItems = (listKey) => {
    const items = Array.isArray(form[listKey]) ? form[listKey] : [];
    return (
      <div className="space-y-3">
        {items.length === 0 && (
          <p className="text-xs text-white/60">Nenhum item configurado.</p>
        )}
        {items.map((item, index) => (
          <div key={item.id || `${listKey}-${index}`} className="grid gap-3 md:grid-cols-[2fr_2fr_2fr_auto]">
            <Input
              label="Nome"
              placeholder="Nome"
              value={item.label || ""}
              onChange={(event) => updateDynamicItem(listKey, index, "label", event.target.value)}
            />
            <Input
              label="Valor"
              placeholder="Valor"
              value={item.value || ""}
              onChange={(event) => updateDynamicItem(listKey, index, "value", event.target.value)}
            />
            <Input
              label="Descrição"
              placeholder="Descrição (opcional)"
              value={item.description || ""}
              onChange={(event) => updateDynamicItem(listKey, index, "description", event.target.value)}
            />
            <Button type="button" onClick={() => removeDynamicItem(listKey, index)}>
              Remover
            </Button>
          </div>
        ))}
        <Button type="button" onClick={() => addDynamicItem(listKey)}>
          + Adicionar item
        </Button>
      </div>
    );
  };

  return (
    <div className="space-y-5">
      <PageHeader
        actions={
          <button
            type="button"
            onClick={() => openDrawer(null)}
            className="rounded-xl bg-sky-500 px-4 py-2 text-sm font-medium text-black transition hover:bg-sky-400"
          >
            <span className="inline-flex items-center gap-2">
              <Plus className="h-4 w-4" />
              Novo modelo
            </span>
          </button>
        }
      />

      <FilterBar
        left={
          <div className="flex w-full flex-wrap items-center gap-3 md:flex-nowrap">
            <div className="relative min-w-[240px] flex-1">
              <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-white/50" />
              <input
                value={searchModel}
                onChange={(event) => setSearchModel(event.target.value)}
                placeholder="Buscar por modelo ou protocolo"
                className="w-full rounded-xl border border-white/10 bg-black/30 py-2 pl-10 pr-4 text-sm text-white placeholder:text-white/50 focus:border-white/30 focus:outline-none"
              />
            </div>
            <div className="relative min-w-[240px] flex-1">
              <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-white/50" />
              <input
                value={searchManufacturer}
                onChange={(event) => setSearchManufacturer(event.target.value)}
                placeholder="Buscar por fabricante"
                className="w-full rounded-xl border border-white/10 bg-black/30 py-2 pl-10 pr-4 text-sm text-white placeholder:text-white/50 focus:border-white/30 focus:outline-none"
              />
            </div>
          </div>
        }
      />

      <div className="overflow-hidden">
        <DataTable>
          <thead className="bg-white/5 text-xs uppercase tracking-[0.14em] text-white/70">
            <tr>
              <th className="px-4 py-3 text-left">Modelo</th>
              <th className="px-4 py-3 text-left">Fabricante</th>
              <th className="px-4 py-3 text-left">Versão</th>
              <th className="px-4 py-3 text-left">Disponível</th>
              <th className="px-4 py-3 text-left">Vinculados</th>
              <th className="px-4 py-3 text-left">Cadastrados</th>
              <th className="px-4 py-3 text-left">Interfaces</th>
              <th className="px-4 py-3 text-right">Ações</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/10">
            {loading && (
              <tr>
                <td colSpan={8} className="px-4 py-6">
                  <SkeletonTable rows={6} columns={8} />
                </td>
              </tr>
            )}
            {!loading && error && (
              <tr>
                <td colSpan={8} className="px-4 py-6 text-center text-red-200/80">
                  {error.message}
                </td>
              </tr>
            )}
            {!loading && !error && filtered.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-8">
                  <EmptyState
                    title="Nenhum modelo cadastrado."
                    subtitle="Cadastre modelos e protocolos para facilitar o vínculo de equipamentos."
                    action={
                      <button
                        type="button"
                        onClick={() => openDrawer(null)}
                        className="rounded-xl bg-sky-500 px-4 py-2 text-sm font-medium text-black transition hover:bg-sky-400"
                      >
                        Novo modelo
                      </button>
                    }
                  />
                </td>
              </tr>
            )}
            {!loading &&
              !error &&
              filtered.map((model) => {
                return (
                  <tr key={model.id} className="border-t border-white/10 hover:bg-white/5">
                    <td className="px-4 py-3">
                      <div className="font-semibold">{model.name}</div>
                      <div className="text-xs text-white/50">{model.protocol || "Protocolo padrão"}</div>
                    </td>
                    <td className="px-4 py-3 text-white/80">{model.brand || "—"}</td>
                    <td className="px-4 py-3 text-white/70">{model.version || "—"}</td>
                    <td className="px-4 py-3 text-white/70">{model.availableCount ?? 0}</td>
                    <td className="px-4 py-3 text-white/70">{model.linkedCount ?? 0}</td>
                    <td className="px-4 py-3 text-white/70">{model.totalCount ?? 0}</td>
                    <td className="px-4 py-3 text-white/70">
                      {formatPortCountsSummary(model)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => openDrawer(model)}
                        className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/10 text-white hover:border-white/30"
                        aria-label="Editar modelo"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                );
              })}
          </tbody>
        </DataTable>
      </div>

      <Drawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        title={editingId ? "Editar modelo" : "Novo modelo"}
        description="Cadastre informações técnicas e portas do modelo."
      >
        <form onSubmit={handleSave} className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {[
              { id: "basico", label: "Informações básicas" },
              { id: "tempos", label: "Tempos técnicos" },
              { id: "modos", label: "Modos e produção" },
              { id: "padrao", label: "Padrão do cliente" },
              { id: "obs", label: "Observação" },
              { id: "interfaces", label: "Interfaces" },
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`rounded-xl px-4 py-2 text-xs uppercase tracking-[0.12em] transition ${
                  activeTab === tab.id ? "bg-sky-500 text-black" : "bg-white/10 text-white/70 hover:bg-white/15"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {activeTab === "basico" && (
            <Field label="Informações básicas">
              <div className="grid gap-3 md:grid-cols-2">
                <Input
                  label="Nome"
                  placeholder="Nome *"
                  value={form.name}
                  onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                />
                <Input
                  label="Fabricante"
                  placeholder="Fabricante *"
                  value={form.brand}
                  onChange={(event) => setForm((current) => ({ ...current, brand: event.target.value }))}
                />
                <Input
                  label="Prefixo do código interno"
                  placeholder="Prefixo do código interno"
                  value={form.prefix}
                  onChange={(event) => setForm((current) => ({ ...current, prefix: event.target.value }))}
                />
                <Input
                  label="Protocolo"
                  placeholder="Protocolo"
                  value={form.protocol}
                  onChange={(event) => setForm((current) => ({ ...current, protocol: event.target.value }))}
                />
                <Input
                  label="Conectividade"
                  placeholder="Conectividade"
                  value={form.connectivity}
                  onChange={(event) => setForm((current) => ({ ...current, connectivity: event.target.value }))}
                />
                <Input
                  label="Versão"
                  placeholder="Versão"
                  value={form.version}
                  onChange={(event) => setForm((current) => ({ ...current, version: event.target.value }))}
                />
                <Input
                  label="Frequência"
                  placeholder="Frequência"
                  value={form.frequency}
                  onChange={(event) => setForm((current) => ({ ...current, frequency: event.target.value }))}
                />
              </div>
            </Field>
          )}

          {activeTab === "tempos" && (
            <Field label="Tempos técnicos">
              {renderDynamicItems("technicalTimes")}
            </Field>
          )}

          {activeTab === "modos" && (
            <Field label="Modos e produção">
              {renderDynamicItems("productionModes")}
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                <Input
                  type="date"
                  label="Data de produção"
                  placeholder="Data de produção"
                  value={form.productionDate}
                  onChange={(event) => setForm((current) => ({ ...current, productionDate: event.target.value }))}
                />
              </div>
            </Field>
          )}

          {activeTab === "padrao" && (
            <Field label="Padrão do cliente">
              <div className="space-y-2">
                <label className="flex items-center gap-2 text-sm text-white/70">
                  <input
                    type="checkbox"
                    checked={form.isClientDefault}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        isClientDefault: event.target.checked,
                        defaultClientId: event.target.checked ? current.defaultClientId : "",
                      }))
                    }
                    className="h-4 w-4 rounded border-white/30 bg-white/10"
                  />
                  Tornar modelo padrão para um cliente
                </label>
                {form.isClientDefault && (
                  <AutocompleteSelect
                    label="Cliente"
                    placeholder="Selecionar cliente"
                    value={form.defaultClientId}
                    onChange={(value) => setForm((current) => ({ ...current, defaultClientId: value }))}
                    options={clientOptions}
                    loadOptions={loadClientOptions}
                    allowClear
                  />
                )}
              </div>
            </Field>
          )}

          {activeTab === "obs" && (
            <Field label="Observação">
              <label className="text-xs uppercase tracking-[0.12em] text-white/60" htmlFor="model-notes">
                Observações
              </label>
              <textarea
                id="model-notes"
                rows={3}
                value={form.notes}
                onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))}
                className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
              />
            </Field>
          )}

          {activeTab === "interfaces" && (
            <Field label="Quantidades de interfaces">
              <div className="grid gap-3 md:grid-cols-4">
                <Input
                  type="number"
                  min="0"
                  label="Entradas (DI)"
                  placeholder="Entradas (DI)"
                  value={form.portCounts.di}
                  onChange={(event) => updatePortCount("di", event.target.value)}
                />
                <Input
                  type="number"
                  min="0"
                  label="Saídas (DO)"
                  placeholder="Saídas (DO)"
                  value={form.portCounts.do}
                  onChange={(event) => updatePortCount("do", event.target.value)}
                />
                <Input
                  type="number"
                  min="0"
                  label="RS232"
                  placeholder="RS232"
                  value={form.portCounts.rs232}
                  onChange={(event) => updatePortCount("rs232", event.target.value)}
                />
                <Input
                  type="number"
                  min="0"
                  label="RS485"
                  placeholder="RS485"
                  value={form.portCounts.rs485}
                  onChange={(event) => updatePortCount("rs485", event.target.value)}
                />
                <Input
                  type="number"
                  min="0"
                  label="CAN"
                  placeholder="CAN"
                  value={form.portCounts.can}
                  onChange={(event) => updatePortCount("can", event.target.value)}
                />
                <Input
                  type="number"
                  min="0"
                  label="LoRa"
                  placeholder="LoRa"
                  value={form.portCounts.lora}
                  onChange={(event) => updatePortCount("lora", event.target.value)}
                />
                <Input
                  type="number"
                  min="0"
                  label="Wi-Fi"
                  placeholder="Wi-Fi"
                  value={form.portCounts.wifi}
                  onChange={(event) => updatePortCount("wifi", event.target.value)}
                />
                <Input
                  type="number"
                  min="0"
                  label="Bluetooth"
                  placeholder="Bluetooth"
                  value={form.portCounts.bluetooth}
                  onChange={(event) => updatePortCount("bluetooth", event.target.value)}
                />
              </div>
            </Field>
          )}

          <div className="flex justify-end gap-2">
            <Button type="button" onClick={() => setDrawerOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Salvando…" : "Salvar"}
            </Button>
          </div>
        </form>
      </Drawer>
    </div>
  );
}
