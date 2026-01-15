import { EllipsisVertical, Plus, Search } from "lucide-react";
import React, { useEffect, useMemo, useState } from "react";

import { CoreApi } from "../lib/coreApi.js";
import Button from "../ui/Button";
import DataState from "../ui/DataState.jsx";
import Field from "../ui/Field";
import Input from "../ui/Input";
import Modal from "../ui/Modal";
import PageHeader from "../ui/PageHeader";
import Select from "../ui/Select";

function formatDate(value) {
  if (!value) return "—";
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return "—";
  return new Date(parsed).toLocaleString();
}

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
        right={
          <Button onClick={() => openDrawer(null)} className="inline-flex items-center gap-2">
            <Plus className="h-4 w-4" />
            Novo modelo
          </Button>
        }
      />

      <div className="rounded-2xl border border-white/10 bg-[#0d131c] px-4 py-3 shadow-lg">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-[240px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/50" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Buscar por modelo, fabricante ou protocolo"
              className="w-full rounded-lg border border-white/10 bg-white/5 py-2 pl-9 pr-3 text-sm text-white placeholder:text-white/50 focus:border-primary focus:outline-none"
            />
          </div>
          <select
            value={brandFilter}
            onChange={(event) => setBrandFilter(event.target.value)}
            className="rounded-lg border border-white/10 bg-white/10 px-3 py-2 text-sm text-white focus:border-primary focus:outline-none"
          >
            {brandOptions.map((brand) => (
              <option key={brand} value={brand}>
                {brand === "all" ? "Todas as marcas" : brand}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-white/10 bg-[#0b1119] shadow-lg">
        <DataState loading={loading} error={error} empty={!filtered.length} emptyMessage="Nenhum modelo cadastrado">
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm text-white">
              <thead className="bg-white/5 text-xs uppercase tracking-[0.14em] text-white/60">
                <tr>
                  <th className="px-4 py-3 text-left">Modelo</th>
                  <th className="px-4 py-3 text-left">Fabricante</th>
                  <th className="px-4 py-3 text-left">Protocolo</th>
                  <th className="px-4 py-3 text-left">Portas</th>
                  <th className="px-4 py-3 text-left">Atualizado</th>
                  <th className="px-4 py-3 text-right">Ações</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((model) => (
                  <tr key={model.id} className="border-t border-white/5 hover:bg-white/5">
                    <td className="px-4 py-3">
                      <div className="font-semibold">{model.name}</div>
                    </td>
                    <td className="px-4 py-3 text-white/80">{model.brand || "—"}</td>
                    <td className="px-4 py-3 text-white/70">{model.protocol || "—"}</td>
                    <td className="px-4 py-3 text-white/70">{Array.isArray(model.ports) ? model.ports.length : 0}</td>
                    <td className="px-4 py-3 text-white/60">{formatDate(model.updatedAt || model.createdAt)}</td>
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
                ))}
              </tbody>
            </table>
          </div>
        </DataState>
      </div>

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
