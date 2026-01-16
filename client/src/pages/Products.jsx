import { EllipsisVertical, Plus, Search } from "lucide-react";
import React, { useEffect, useMemo, useState } from "react";

import { CoreApi } from "../lib/coreApi.js";
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
  const [models, setModels] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState("");
  const [brandFilter, setBrandFilter] = useState("all");
  const [editingId, setEditingId] = useState(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ name: "", brand: "", protocol: "", connectivity: "", ports: [{ label: "", type: "digital" }] });

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
        ports: Array.isArray(model.ports) && model.ports.length ? model.ports : [{ label: "", type: "digital" }],
      });
    } else {
      setEditingId(null);
      setForm({ name: "", brand: "", protocol: "", connectivity: "", ports: [{ label: "", type: "digital" }] });
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
              <th className="px-4 py-3 text-left">Protocolo</th>
              <th className="px-4 py-3 text-left">Portas</th>
              <th className="px-4 py-3 text-left">Sem comunicação</th>
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
                const noCommunication =
                  model?.noCommunication || model?.communication === false || model?.connectivity === "SEM_COMUNICACAO";
                return (
                  <tr key={model.id} className="border-t border-white/10 hover:bg-white/5">
                  <td className="px-4 py-3">
                    <div className="font-semibold">{model.name}</div>
                  </td>
                  <td className="px-4 py-3 text-white/80">{model.brand || "—"}</td>
                  <td className="px-4 py-3 text-white/70">{model.protocol || "—"}</td>
                  <td className="px-4 py-3 text-white/70">
                    {Array.isArray(model.ports) && model.ports.length
                      ? model.ports.map((port) => port.label).filter(Boolean).join(", ")
                      : "—"}
                  </td>
                  <td className="px-4 py-3 text-white/70">
                    <span className="rounded-lg bg-white/10 px-2 py-1 text-xs">{noCommunication ? "Sim" : "Não"}</span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="relative inline-block">
                      <button
                        type="button"
                        onClick={() => openDrawer(model)}
                        className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/10 text-white hover:border-white/30"
                      >
                        <EllipsisVertical className="h-4 w-4" />
                      </button>
                    </div>
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
            </div>
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
