import React, { useEffect, useMemo, useState } from "react";

import PageHeader from "../components/ui/PageHeader.jsx";
import DataTable from "../components/ui/DataTable.jsx";
import EmptyState from "../components/ui/EmptyState.jsx";
import api from "../lib/api.js";
import { useTenant } from "../lib/tenant-context.jsx";

const STATUS_OPTIONS = [
  { value: "ativo", label: "Ativo" },
  { value: "inativo", label: "Inativo" },
];

const defaultForm = {
  name: "",
  email: "",
  phone: "",
  city: "",
  state: "",
  status: "ativo",
  clientId: "",
};

export default function Technicians() {
  const { tenantId, tenants, hasAdminAccess, user } = useTenant();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [message, setMessage] = useState(null);
  const [search, setSearch] = useState("");
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(defaultForm);

  const resolvedClientId = hasAdminAccess ? form.clientId || tenantId || tenants[0]?.id || "" : tenantId || user?.clientId || "";

  const filteredItems = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return items;
    return items.filter((item) => {
      const haystack = [item.name, item.email, item.phone, item.city, item.state, item.status]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(term);
    });
  }, [items, search]);

  const resetForm = () => {
    setEditingId(null);
    setForm((prev) => ({
      ...defaultForm,
      clientId: hasAdminAccess ? resolvedClientId : prev.clientId,
    }));
  };

  const loadTechnicians = async (clientId) => {
    setLoading(true);
    setError(null);
    try {
      const params = clientId ? { clientId } : undefined;
      const response = await api.get("core/technicians", { params });
      const list = response?.data?.items || [];
      setItems(Array.isArray(list) ? list : []);
    } catch (loadError) {
      console.error("Falha ao carregar técnicos", loadError);
      setError(loadError);
      setItems([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!resolvedClientId && hasAdminAccess) return;
    loadTechnicians(resolvedClientId);
  }, [resolvedClientId, hasAdminAccess]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const payload = {
        name: form.name.trim(),
        email: form.email.trim(),
        phone: form.phone.trim(),
        city: form.city.trim(),
        state: form.state.trim(),
        status: form.status,
        clientId: hasAdminAccess ? resolvedClientId : undefined,
      };

      if (!payload.name || !payload.email) {
        throw new Error("Nome e e-mail são obrigatórios");
      }

      if (editingId) {
        await api.put(`core/technicians/${editingId}`, payload);
        setMessage("Técnico atualizado com sucesso.");
      } else {
        await api.post("core/technicians", payload);
        setMessage("Técnico criado com sucesso.");
      }

      resetForm();
      loadTechnicians(resolvedClientId);
    } catch (submitError) {
      console.error("Falha ao salvar técnico", submitError);
      setError(submitError);
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = (technician) => {
    setEditingId(technician.id);
    setForm({
      name: technician.name || "",
      email: technician.email || "",
      phone: technician.phone || "",
      city: technician.city || "",
      state: technician.state || "",
      status: technician.status || "ativo",
      clientId: technician.clientId || resolvedClientId,
    });
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Técnico"
        subtitle="Cadastre e gerencie técnicos disponíveis para ordens de serviço."
        actions={
          <button
            type="button"
            onClick={resetForm}
            className="rounded-xl bg-white/10 px-4 py-2 text-sm text-white transition hover:bg-white/15"
          >
            Novo técnico
          </button>
        }
      />

      <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
        <form className="grid gap-3 md:grid-cols-3" onSubmit={handleSubmit}>
          <label className="block text-xs text-white/60">
            Nome *
            <input
              value={form.name}
              onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
              className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
              required
            />
          </label>
          <label className="block text-xs text-white/60">
            E-mail/Login *
            <input
              type="email"
              value={form.email}
              onChange={(event) => setForm((prev) => ({ ...prev, email: event.target.value }))}
              className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
              required
            />
          </label>
          <label className="block text-xs text-white/60">
            Telefone
            <input
              value={form.phone}
              onChange={(event) => setForm((prev) => ({ ...prev, phone: event.target.value }))}
              className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
            />
          </label>
          <label className="block text-xs text-white/60">
            Cidade
            <input
              value={form.city}
              onChange={(event) => setForm((prev) => ({ ...prev, city: event.target.value }))}
              className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
            />
          </label>
          <label className="block text-xs text-white/60">
            UF
            <input
              value={form.state}
              onChange={(event) => setForm((prev) => ({ ...prev, state: event.target.value }))}
              className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
            />
          </label>
          <label className="block text-xs text-white/60">
            Status
            <select
              value={form.status}
              onChange={(event) => setForm((prev) => ({ ...prev, status: event.target.value }))}
              className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
            >
              {STATUS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          {hasAdminAccess && (
            <label className="block text-xs text-white/60 md:col-span-3">
              Cliente
              <select
                value={resolvedClientId}
                onChange={(event) => {
                  const nextId = event.target.value;
                  setForm((prev) => ({ ...prev, clientId: nextId }));
                }}
                className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
              >
                {tenants.map((client) => (
                  <option key={client.id} value={client.id}>
                    {client.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <div className="md:col-span-3 flex flex-wrap items-center justify-end gap-3">
            {error && <span className="text-sm text-red-300">{error?.response?.data?.message || error.message}</span>}
            {message && <span className="text-sm text-emerald-300">{message}</span>}
            <button
              type="submit"
              disabled={saving}
              className="rounded-xl bg-sky-500 px-4 py-2 text-sm font-medium text-black transition hover:bg-sky-400 disabled:opacity-60"
            >
              {saving ? "Salvando..." : editingId ? "Atualizar técnico" : "Cadastrar técnico"}
            </button>
          </div>
        </form>
      </div>

      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Buscar técnico por nome, e-mail ou cidade"
            className="w-full rounded-xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-white placeholder:text-white/50 focus:border-white/30 focus:outline-none md:w-80"
          />
          <button
            type="button"
            onClick={() => loadTechnicians(resolvedClientId)}
            className="rounded-xl bg-white/10 px-4 py-2 text-sm text-white transition hover:bg-white/15"
          >
            Atualizar
          </button>
        </div>

        <div className="overflow-hidden rounded-2xl border border-white/10">
          <DataTable>
            <thead className="bg-white/5 text-xs uppercase tracking-wide text-white/70">
              <tr className="text-left">
                <th className="px-4 py-3">Nome</th>
                <th className="px-4 py-3">E-mail</th>
                <th className="px-4 py-3">Telefone</th>
                <th className="px-4 py-3">Cidade/UF</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/10">
              {loading && (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-sm text-white/70">
                    Carregando técnicos...
                  </td>
                </tr>
              )}
              {!loading && filteredItems.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8">
                    <EmptyState title="Nenhum técnico encontrado." subtitle="Cadastre um técnico para usar nas ordens de serviço." />
                  </td>
                </tr>
              )}
              {!loading &&
                filteredItems.map((technician) => (
                  <tr key={technician.id} className="hover:bg-white/5">
                    <td className="px-4 py-3 text-white">{technician.name}</td>
                    <td className="px-4 py-3 text-white/70">{technician.email || "—"}</td>
                    <td className="px-4 py-3 text-white/70">{technician.phone || "—"}</td>
                    <td className="px-4 py-3 text-white/70">
                      {[technician.city, technician.state].filter(Boolean).join("/") || "—"}
                    </td>
                    <td className="px-4 py-3">
                      <span className="rounded-lg bg-white/10 px-2 py-1 text-xs text-white/80">
                        {technician.status || "—"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => handleEdit(technician)}
                        className="rounded-xl border border-white/10 px-3 py-2 text-xs text-white transition hover:border-white/30"
                      >
                        Editar
                      </button>
                    </td>
                  </tr>
                ))}
            </tbody>
          </DataTable>
        </div>
      </div>
    </div>
  );
}
