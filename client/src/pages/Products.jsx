import { Pencil, Plus, Search } from "lucide-react";
import React, { useEffect, useMemo, useState } from "react";

import { CoreApi } from "../lib/coreApi.js";
import { useTenant } from "../lib/tenant-context.jsx";
import Button from "../ui/Button";
import Field from "../ui/Field";
import Input from "../ui/Input";
import Modal from "../ui/Modal";
import Select from "../ui/Select";
import PageHeader from "../components/ui/PageHeader.jsx";
import FilterBar from "../components/ui/FilterBar.jsx";
import DataCard from "../components/ui/DataCard.jsx";
import DataTable from "../components/ui/DataTable.jsx";
import EmptyState from "../components/ui/EmptyState.jsx";
import SkeletonTable from "../components/ui/SkeletonTable.jsx";

export default function Products() {
  const { tenants, tenantId, user } = useTenant();
  const [models, setModels] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState("");
  const [brandFilter, setBrandFilter] = useState("all");
  const [editingId, setEditingId] = useState(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: "",
    brand: "",
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
    ports: [{ label: "", type: "digital" }],
  });

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const modelList = await CoreApi.models();
      setModels(Array.isArray(modelList) ? modelList : []);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError : new Error("Falha ao carregar modelos"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const brandOptions = useMemo(() => {
    const brands = Array.from(new Set(models.map((model) => model.brand).filter(Boolean)));
    return ["all", ...brands];
  }, [models]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return models.filter((model) => {
      if (brandFilter !== "all" && model.brand !== brandFilter) return false;
      if (!term) return true;
      const haystack = [model.name, model.brand, model.protocol, model.connectivity]
        .filter(Boolean)
        .map((value) => String(value).toLowerCase());
      return haystack.some((value) => value.includes(term));
    });
  }, [brandFilter, models, search]);

  function updatePort(index, key, value) {
    setForm((current) => {
      const ports = Array.isArray(current.ports) ? [...current.ports] : [];
      ports[index] = { ...ports[index], [key]: value };
      return { ...current, ports };
    });
  }

  function addPort() {
    setForm((current) => ({ ...current, ports: [...(current.ports || []), { label: "", type: "digital" }] }));
  }

  function removePort(index) {
    setForm((current) => ({ ...current, ports: (current.ports || []).filter((_, idx) => idx !== index) }));
  }

  function openDrawer(model) {
    if (model) {
      setEditingId(model.id);
      setForm({
        name: model.name || "",
        brand: model.brand || "",
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
        ports: Array.isArray(model.ports) && model.ports.length ? model.ports : [{ label: "", type: "digital" }],
      });
    } else {
      setEditingId(null);
      setForm({
        name: "",
        brand: "",
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
        ports: [{ label: "", type: "digital" }],
      });
    }
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
      const payload = {
        name: form.name.trim(),
        brand: form.brand.trim(),
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
        ports: (form.ports || [])
          .map((port) => ({ label: port.label?.trim() || "", type: port.type?.trim() || "digital" }))
          .filter((port) => port.label),
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

  return (
    <div className="space-y-5">
      <PageHeader
        title="Modelos & Portas"
        titleClassName="text-xs font-semibold uppercase tracking-[0.14em] text-white/70"
        subtitle="Cadastre modelos e configurações de portas/protocolos."
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

      <DataCard>
        <FilterBar
          left={
            <>
              <div className="relative min-w-[240px] flex-1">
                <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-white/50" />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Buscar por modelo, fabricante ou protocolo"
                  className="w-full rounded-xl border border-white/10 bg-black/30 py-2 pl-10 pr-4 text-sm text-white placeholder:text-white/50 focus:border-white/30 focus:outline-none"
                />
              </div>
              <select
                value={brandFilter}
                onChange={(event) => setBrandFilter(event.target.value)}
                className="rounded-xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
              >
                {brandOptions.map((brand) => (
                  <option key={brand} value={brand}>
                    {brand === "all" ? "Todas as marcas" : brand}
                  </option>
                ))}
              </select>
            </>
          }
        />
      </DataCard>

      <DataCard className="overflow-hidden p-0">
        <DataTable>
          <thead className="bg-white/5 text-xs uppercase tracking-[0.14em] text-white/70">
            <tr>
              <th className="px-4 py-3 text-left">Modelo</th>
              <th className="px-4 py-3 text-left">Fabricante</th>
              <th className="px-4 py-3 text-left">Versão</th>
              <th className="px-4 py-3 text-left">Frequência</th>
              <th className="px-4 py-3 text-left">Bloqueio</th>
              <th className="px-4 py-3 text-left">Portas</th>
              <th className="px-4 py-3 text-right">Ações</th>
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
            {!loading && error && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-red-200/80">
                  {error.message}
                </td>
              </tr>
            )}
            {!loading && !error && filtered.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8">
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
                    <td className="px-4 py-3 text-white/70">{model.frequency || "—"}</td>
                    <td className="px-4 py-3 text-white/70">{model.blockMode || model.jammerBlockTime || "—"}</td>
                    <td className="px-4 py-3 text-white/70">
                      {Array.isArray(model.ports) && model.ports.length
                        ? model.ports.map((port) => port.label).filter(Boolean).join(", ")
                        : "—"}
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
      </DataCard>

      <Modal open={drawerOpen} onClose={() => setDrawerOpen(false)} title={editingId ? "Editar modelo" : "Novo modelo"} width="max-w-3xl">
        <form onSubmit={handleSave} className="space-y-4">
          <Field label="Informações básicas">
            <div className="grid gap-3 md:grid-cols-2">
              <Input
                placeholder="Nome *"
                value={form.name}
                onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
              />
              <Input
                placeholder="Fabricante *"
                value={form.brand}
                onChange={(event) => setForm((current) => ({ ...current, brand: event.target.value }))}
              />
              <Input
                placeholder="Protocolo"
                value={form.protocol}
                onChange={(event) => setForm((current) => ({ ...current, protocol: event.target.value }))}
              />
              <Input
                placeholder="Conectividade"
                value={form.connectivity}
                onChange={(event) => setForm((current) => ({ ...current, connectivity: event.target.value }))}
              />
              <Input
                placeholder="Versão"
                value={form.version}
                onChange={(event) => setForm((current) => ({ ...current, version: event.target.value }))}
              />
              <Input
                placeholder="Frequência"
                value={form.frequency}
                onChange={(event) => setForm((current) => ({ ...current, frequency: event.target.value }))}
              />
            </div>
          </Field>

          <Field label="Tempos técnicos">
            <div className="grid gap-3 md:grid-cols-3">
              <Input
                placeholder="Tempo bloqueio Jammer"
                value={form.jammerBlockTime}
                onChange={(event) => setForm((current) => ({ ...current, jammerBlockTime: event.target.value }))}
              />
              <Input
                placeholder="Tempo bloqueio painel"
                value={form.panelBlockTime}
                onChange={(event) => setForm((current) => ({ ...current, panelBlockTime: event.target.value }))}
              />
              <Input
                placeholder="Tempo detecção Jammer"
                value={form.jammerDetectionTime}
                onChange={(event) => setForm((current) => ({ ...current, jammerDetectionTime: event.target.value }))}
              />
            </div>
          </Field>

          <Field label="Modos e produção">
            <div className="grid gap-3 md:grid-cols-2">
              <Input
                placeholder="Modo bloqueio"
                value={form.blockMode}
                onChange={(event) => setForm((current) => ({ ...current, blockMode: event.target.value }))}
              />
              <Input
                placeholder="Modo reset"
                value={form.resetMode}
                onChange={(event) => setForm((current) => ({ ...current, resetMode: event.target.value }))}
              />
              <Input
                placeholder="Modo oficina"
                value={form.workshopMode}
                onChange={(event) => setForm((current) => ({ ...current, workshopMode: event.target.value }))}
              />
              <Input
                type="date"
                placeholder="Data de produção"
                value={form.productionDate}
                onChange={(event) => setForm((current) => ({ ...current, productionDate: event.target.value }))}
              />
            </div>
          </Field>

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
                <select
                  value={form.defaultClientId}
                  onChange={(event) => setForm((current) => ({ ...current, defaultClientId: event.target.value }))}
                  className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
                >
                  <option value="">Selecionar cliente</option>
                  {(tenants || []).map((tenant) => (
                    <option key={tenant.id} value={tenant.id}>
                      {tenant.name || tenant.company || tenant.id}
                    </option>
                  ))}
                  {!tenants?.length && (
                    <option value={tenantId || user?.clientId || ""}>Cliente atual</option>
                  )}
                </select>
              )}
            </div>
          </Field>

          <Field label="Observação">
            <textarea
              rows={3}
              value={form.notes}
              onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))}
              className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
            />
          </Field>

          <Field label="Portas">
            <div className="space-y-3">
              {(form.ports || []).map((port, index) => (
                <div key={`product-port-${index}`} className="grid gap-3 md:grid-cols-5">
                  <Input
                    placeholder="Nome"
                    value={port.label}
                    onChange={(event) => updatePort(index, "label", event.target.value)}
                    className="md:col-span-3"
                  />
                  <Select
                    value={port.type}
                    onChange={(event) => updatePort(index, "type", event.target.value)}
                    className="md:col-span-1"
                  >
                    <option value="digital">Digital</option>
                    <option value="analógica">Analógica</option>
                    <option value="entrada">Entrada</option>
                    <option value="saida">Saída</option>
                  </Select>
                  <Button type="button" onClick={() => removePort(index)} disabled={(form.ports || []).length <= 1}>
                    Remover
                  </Button>
                </div>
              ))}
              <Button type="button" onClick={addPort}>
                + Adicionar porta
              </Button>
            </div>
          </Field>

          <div className="flex justify-end gap-2">
            <Button type="button" onClick={() => setDrawerOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Salvando…" : "Salvar"}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
