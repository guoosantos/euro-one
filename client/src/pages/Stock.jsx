import React, { useEffect, useState } from "react";
import { Plus, RefreshCw, Trash2 } from "lucide-react";

import { CoreApi } from "../lib/coreApi.js";
import { useTenant } from "../lib/tenant-context.jsx";
import PageHeader from "../ui/PageHeader";
import Button from "../ui/Button";
import Input from "../ui/Input";
import Select from "../ui/Select";
import Modal from "../ui/Modal";

const STATUS_OPTIONS = [
  { value: "em-estoque", label: "Em estoque" },
  { value: "reservado", label: "Reservado" },
  { value: "instalado", label: "Instalado" },
  { value: "defeito", label: "Defeito" },
];

export default function Stock() {
  const { tenantId, user } = useTenant();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState({ type: "", name: "", quantity: 1, status: "em-estoque", notes: "" });

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
      setOpen(false);
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
    setOpen(true);
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Estoque de dispositivos"
        description="Controle rápido de itens vinculados ao tenant (dispositivos, chips e acessórios)."
        right={
          <div className="flex gap-2">
            <Button variant="ghost" onClick={load} icon={RefreshCw}>
              Atualizar
            </Button>
            <Button onClick={() => setOpen(true)} icon={Plus}>
              Novo item
            </Button>
          </div>
        }
      />

      {error && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">{error.message}</div>
      )}

      <div className="rounded-2xl border border-white/10 bg-white/5">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm text-white/80">
            <thead className="bg-white/5 text-xs uppercase tracking-wide text-white/60">
              <tr>
                <th className="px-4 py-3 text-left">Tipo / Nome</th>
                <th className="px-4 py-3 text-left">Quantidade</th>
                <th className="px-4 py-3 text-left">Status</th>
                <th className="px-4 py-3 text-left">Observações</th>
                <th className="px-4 py-3 text-left">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/10">
              {loading && (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-white/60">
                    Carregando estoque…
                  </td>
                </tr>
              )}
              {!loading && items.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-white/60">
                    Nenhum item cadastrado.
                  </td>
                </tr>
              )}
              {!loading &&
                items.map((item) => (
                  <tr key={item.id} className="hover:bg-white/5">
                    <td className="px-4 py-3 text-white">{item.name || item.type}</td>
                    <td className="px-4 py-3">{item.quantity ?? 0}</td>
                    <td className="px-4 py-3">{STATUS_OPTIONS.find((opt) => opt.value === item.status)?.label || item.status || "—"}</td>
                    <td className="px-4 py-3">{item.notes || "—"}</td>
                    <td className="px-4 py-3 space-x-2 whitespace-nowrap">
                      <Button size="sm" variant="ghost" onClick={() => openEdit(item)}>
                        Editar
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => handleDelete(item.id)} icon={Trash2}>
                        Remover
                      </Button>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>

      <Modal open={open} onClose={() => setOpen(false)} title={editingId ? "Editar item" : "Novo item"} width="max-w-2xl">
        <form onSubmit={handleSave} className="grid gap-3 md:grid-cols-2">
          <Input
            label="Tipo do item"
            value={form.type}
            onChange={(event) => setForm((current) => ({ ...current, type: event.target.value }))}
            placeholder="Ex.: Rastreador, Chip, Antena"
          />
          <Input
            label="Nome / Detalhe"
            value={form.name}
            onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
            placeholder="Modelo ou identificação"
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
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Salvando…" : editingId ? "Atualizar" : "Salvar"}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
