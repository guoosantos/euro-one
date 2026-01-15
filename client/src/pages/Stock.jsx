import React, { useEffect, useMemo, useState } from "react";
import { EllipsisVertical, Package, Plus, RefreshCw, Search, Trash2 } from "lucide-react";

import { CoreApi } from "../lib/coreApi.js";
import { useTenant } from "../lib/tenant-context.jsx";
import PageHeader from "../ui/PageHeader";
import Button from "../ui/Button";
import Input from "../ui/Input";
import Select from "../ui/Select";
import DataState from "../ui/DataState.jsx";

const STATUS_OPTIONS = [
  { value: "em-estoque", label: "Em estoque" },
  { value: "reservado", label: "Reservado" },
  { value: "instalado", label: "Instalado" },
  { value: "defeito", label: "Defeito" },
];

const LOW_STOCK_THRESHOLD = 5;

export default function Stock() {
  const { tenantId, user } = useTenant();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState({ type: "", name: "", quantity: 1, status: "em-estoque", notes: "" });
  const [activeTab, setActiveTab] = useState("geral");
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [supplierFilter, setSupplierFilter] = useState("all");
  const [onlyLowStock, setOnlyLowStock] = useState(false);
  const [onlyActive, setOnlyActive] = useState(false);

  const resolvedClientId = tenantId || user?.clientId || null;

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const list = await CoreApi.listStockItems(resolvedClientId ? { clientId: resolvedClientId } : undefined);
      setItems(Array.isArray(list) ? list : []);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError : new Error("Falha ao carregar estoque"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (resolvedClientId || user) {
      load();
    }
  }, [resolvedClientId, user]);

  function resetForm() {
    setEditingId(null);
    setForm({ type: "", name: "", quantity: 1, status: "em-estoque", notes: "" });
    setActiveTab("geral");
  }

  async function handleSave(event) {
    event.preventDefault();
    if (!form.type.trim() && !form.name.trim()) {
      alert("Informe o tipo ou nome do item");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        type: form.type.trim() || undefined,
        name: form.name.trim() || undefined,
        quantity: Number(form.quantity) || 0,
        status: form.status,
        notes: form.notes.trim() || undefined,
        clientId: tenantId || user?.clientId,
      };
      if (editingId) {
        await CoreApi.updateStockItem(editingId, payload);
      } else {
        await CoreApi.createStockItem(payload);
      }
      await load();
      resetForm();
      setDrawerOpen(false);
    } catch (requestError) {
      alert(requestError?.message || "Falha ao salvar item");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id) {
    if (!id) return;
    if (!window.confirm("Remover item do estoque?")) return;
    try {
      await CoreApi.deleteStockItem(id, { clientId: tenantId || user?.clientId });
      await load();
    } catch (requestError) {
      alert(requestError?.message || "Não foi possível remover o item");
    }
  }

  function openEdit(item) {
    setEditingId(item.id);
    setForm({
      type: item.type || "",
      name: item.name || "",
      quantity: item.quantity ?? 1,
      status: item.status || "em-estoque",
      notes: item.notes || "",
    });
    setDrawerOpen(true);
    setActiveTab("geral");
  }

  const categories = useMemo(
    () => Array.from(new Set(items.map((item) => item.type).filter(Boolean))),
    [items],
  );

  const suppliers = useMemo(
    () => Array.from(new Set(items.map((item) => item.supplier).filter(Boolean))),
    [items],
  );

  const filteredItems = useMemo(() => {
    const term = search.trim().toLowerCase();
    return items.filter((item) => {
      const name = (item.name || "").toLowerCase();
      const sku = (item.type || "").toLowerCase();
      const supplier = (item.supplier || "").toLowerCase();
      const quantity = Number(item.quantity) || 0;
      const lowStock = quantity <= LOW_STOCK_THRESHOLD;
      const active = item.status !== "defeito";

      if (term && ![name, sku, supplier].some((value) => value.includes(term))) return false;
      if (categoryFilter !== "all" && item.type !== categoryFilter) return false;
      if (supplierFilter !== "all" && item.supplier !== supplierFilter) return false;
      if (onlyLowStock && !lowStock) return false;
      if (onlyActive && !active) return false;
      return true;
    });
  }, [categoryFilter, items, onlyActive, onlyLowStock, search, supplierFilter]);

  const formatDateLabel = (value) => {
    if (!value) return "—";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "—";
    return date.toLocaleString();
  };

  const renderQuantityChip = (item) => {
    const quantity = Number(item.quantity) || 0;
    const isLow = quantity <= LOW_STOCK_THRESHOLD;
    return (
      <div className="flex items-center gap-2">
        <span className="text-sm text-white">{quantity}</span>
        {isLow && (
          <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-amber-200">
            Baixo
          </span>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Estoque"
        description="Inventário enxuto com foco em produto, SKU e movimentações."
        right={
          <div className="flex gap-2">
            <Button variant="ghost" onClick={load} icon={RefreshCw}>
              Atualizar
            </Button>
            <Button onClick={() => { resetForm(); setDrawerOpen(true); }} icon={Plus}>
              Novo item
            </Button>
          </div>
        }
      />

      <div className="space-y-3 rounded-2xl border border-white/10 bg-[#0d131c] px-4 py-3 shadow-lg">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[240px]">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/50" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Buscar produto, SKU, código de barras"
              className="w-full rounded-lg border border-white/10 bg-white/5 py-2 pl-9 pr-3 text-sm text-white placeholder:text-white/50 focus:border-primary focus:outline-none"
            />
          </div>
          <select
            value={categoryFilter}
            onChange={(event) => setCategoryFilter(event.target.value)}
            className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white focus:border-primary focus:outline-none"
          >
            <option value="all">Categoria</option>
            {categories.map((cat) => (
              <option key={cat} value={cat}>
                {cat}
              </option>
            ))}
          </select>
          <select
            value={supplierFilter}
            onChange={(event) => setSupplierFilter(event.target.value)}
            className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white focus:border-primary focus:outline-none"
          >
            <option value="all">Fornecedor</option>
            {suppliers.map((sup) => (
              <option key={sup} value={sup}>
                {sup}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs uppercase tracking-[0.1em] text-white/70">
            <input
              type="checkbox"
              checked={onlyLowStock}
              onChange={() => setOnlyLowStock((prev) => !prev)}
              className="h-4 w-4 rounded border-white/30 bg-transparent"
            />
            Baixo estoque
          </label>
          <label className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs uppercase tracking-[0.1em] text-white/70">
            <input
              type="checkbox"
              checked={onlyActive}
              onChange={() => setOnlyActive((prev) => !prev)}
              className="h-4 w-4 rounded border-white/30 bg-transparent"
            />
            Ativo
          </label>
          <div className="ml-auto flex gap-2">
            <Button variant="ghost" className="inline-flex items-center gap-2">
              <Package className="h-4 w-4" />
              Entrada
            </Button>
            <Button variant="ghost" className="inline-flex items-center gap-2">
              <Package className="h-4 w-4 rotate-180" />
              Saída
            </Button>
          </div>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">{error.message}</div>
      )}

      <div className="rounded-2xl border border-white/10 bg-[#0d131c]/80 shadow-xl">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm text-white/80">
            <thead className="bg-white/5 text-xs uppercase tracking-[0.12em] text-white/60">
              <tr>
                <th className="px-4 py-3 text-left">Produto</th>
                <th className="px-4 py-3 text-left">Categoria</th>
                <th className="px-4 py-3 text-left">Quantidade</th>
                <th className="px-4 py-3 text-left">Custo / Preço</th>
                <th className="px-4 py-3 text-left">Atualizado em</th>
                <th className="px-4 py-3 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {loading && (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-white/60">
                    Carregando estoque…
                  </td>
                </tr>
              )}
              {!loading && filteredItems.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center">
                    <DataState
                      tone="muted"
                      state="info"
                      title="Nenhum item encontrado"
                      description="Ajuste os filtros ou cadastre um novo item."
                      action={(
                        <button
                          type="button"
                          className="rounded-lg border border-primary/40 bg-primary/10 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.12em]"
                          onClick={() => { resetForm(); setDrawerOpen(true); }}
                        >
                          Novo item
                        </button>
                      )}
                      className="bg-[#0f141c]"
                    />
                  </td>
                </tr>
              )}
              {!loading &&
                filteredItems.map((item) => {
                  const quantity = Number(item.quantity) || 0;
                  const statusLabel =
                    STATUS_OPTIONS.find((opt) => opt.value === item.status)?.label || item.status || "—";
                  return (
                    <tr key={item.id} className="hover:bg-white/5">
                      <td className="px-4 py-3">
                        <div className="text-white font-semibold">{item.name || "Produto sem nome"}</div>
                        <div className="text-[12px] text-white/60">{item.type || "SKU indefinido"}</div>
                      </td>
                      <td className="px-4 py-3">{item.type || "—"}</td>
                      <td className="px-4 py-3">{renderQuantityChip(item)}</td>
                      <td className="px-4 py-3 text-white/70">—</td>
                      <td className="px-4 py-3">
                        <div className="text-white">{formatDateLabel(item.updatedAt || item.createdAt)}</div>
                        <div className="text-[11px] text-white/60">{statusLabel}</div>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <ItemActions
                          onEdit={() => openEdit(item)}
                          onDelete={() => handleDelete(item.id)}
                          onEntry={() => alert("Registrar entrada em breve.")}
                          onExit={() => alert("Registrar saída em breve.")}
                        />
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      </div>

      <Drawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        title={editingId ? "Editar item" : "Novo item"}
        description="Geral | Movimentações | Fornecedores | Ajustes"
      >
        <div className="flex gap-2 overflow-x-auto pb-2 text-[11px] uppercase tracking-[0.1em] text-white/60">
          {["geral", "movimentacoes", "fornecedores", "ajustes"].map((key) => (
            <button
              key={key}
              onClick={() => setActiveTab(key)}
              className={`rounded-md px-3 py-2 transition ${activeTab === key ? "bg-primary/20 text-white border border-primary/40" : "border border-transparent hover:border-white/20"}`}
            >
              {key === "geral" && "Geral"}
              {key === "movimentacoes" && "Movimentações"}
              {key === "fornecedores" && "Fornecedores"}
              {key === "ajustes" && "Ajustes"}
            </button>
          ))}
        </div>

        {activeTab === "geral" && (
          <form onSubmit={handleSave} className="grid gap-4 md:grid-cols-2">
            <Input
              label="Produto"
              value={form.name}
              onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
              placeholder="Nome do produto"
            />
            <Input
              label="SKU / Tipo"
              value={form.type}
              onChange={(event) => setForm((current) => ({ ...current, type: event.target.value }))}
              placeholder="Código interno"
            />
            <Input
              label="Quantidade"
              type="number"
              min={0}
              value={form.quantity}
              onChange={(event) => setForm((current) => ({ ...current, quantity: event.target.value }))}
            />
            <Select
              label="Status"
              value={form.status}
              onChange={(event) => setForm((current) => ({ ...current, status: event.target.value }))}
            >
              {STATUS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
            <div className="md:col-span-2">
              <label className="text-sm text-white/70">Observações</label>
              <textarea
                className="mt-1 w-full rounded-xl border border-white/10 bg-white/10 px-3 py-2"
                rows={3}
                value={form.notes}
                onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))}
              />
            </div>
            <div className="md:col-span-2 flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setDrawerOpen(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? "Salvando…" : editingId ? "Atualizar" : "Salvar"}
              </Button>
            </div>
          </form>
        )}

        {activeTab === "movimentacoes" && (
          <DataState
            tone="muted"
            state="info"
            title="Movimentações"
            description="Histórico de entradas e saídas ficará disponível aqui."
            className="bg-white/5"
          />
        )}

        {activeTab === "fornecedores" && (
          <DataState
            tone="muted"
            state="info"
            title="Fornecedores"
            description="Associe fornecedores e contatos ao item."
            className="bg-white/5"
          />
        )}

        {activeTab === "ajustes" && (
          <DataState
            tone="muted"
            state="info"
            title="Ajustes"
            description="Atualize estoque, status e observações em massa."
            className="bg-white/5"
          />
        )}
      </Drawer>
    </div>
  );
}

function ItemActions({ onEdit, onDelete, onEntry, onExit }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative inline-block text-left">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/10 text-white hover:border-white/30"
        aria-label="Ações"
      >
        <EllipsisVertical className="h-4 w-4" />
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-48 overflow-hidden rounded-xl border border-white/10 bg-[#0f141c] shadow-xl">
          <button
            type="button"
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-white hover:bg-white/5"
            onClick={() => {
              onEdit?.();
              setOpen(false);
            }}
          >
            ✏️ Editar
          </button>
          <button
            type="button"
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-white hover:bg-white/5"
            onClick={() => {
              onEntry?.();
              setOpen(false);
            }}
          >
            ➕ Entrada
          </button>
          <button
            type="button"
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-white hover:bg-white/5"
            onClick={() => {
              onExit?.();
              setOpen(false);
            }}
          >
            ➖ Saída
          </button>
          <button
            type="button"
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-red-200 hover:bg-red-500/10"
            onClick={() => {
              onDelete?.();
              setOpen(false);
            }}
          >
            <Trash2 className="h-4 w-4" />
            Remover
          </button>
        </div>
      )}
    </div>
  );
}

function Drawer({ open, onClose, title, description, children }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[9998] flex">
      <div className="flex-1 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative h-full w-full max-w-3xl border-l border-white/10 bg-[#0f141c] shadow-3xl">
        <div className="flex items-start justify-between gap-4 border-b border-white/10 px-6 py-5">
          <div>
            <h2 className="text-xl font-semibold text-white">{title}</h2>
            {description && <p className="text-sm text-white/60">{description}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-white/10 bg-white/5 p-2 text-white/70 transition hover:border-white/30 hover:text-white"
            aria-label="Fechar"
          >
            ✕
          </button>
        </div>
        <div className="h-[calc(100%-80px)] overflow-y-auto px-6 py-4">{children}</div>
      </div>
    </div>
  );
}
