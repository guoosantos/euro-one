import React, { useEffect, useState } from "react";

import api from "../lib/api";
import { useTenant } from "../lib/tenant-context";

const initialForm = {
  name: "",
  email: "",
  password: "",
  deviceLimit: 50,
  userLimit: 20,
};

export default function AdminClients() {
  const { role, refreshClients } = useTenant();
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [form, setForm] = useState(initialForm);
  const [editingId, setEditingId] = useState(null);
  const [message, setMessage] = useState(null);

  const isAdmin = role === "admin";

  useEffect(() => {
    if (isAdmin) {
      loadClients();
    }
  }, [isAdmin]);

  async function loadClients() {
    setLoading(true);
    setError(null);
    try {
      const response = await api.get("/clients");
      const list = response?.data?.clients || response?.data || [];
      setClients(Array.isArray(list) ? list : []);
      refreshClients();
    } catch (loadError) {
      console.error("Erro ao carregar clientes", loadError);
      setError(loadError);
      setClients([]);
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const payload = { ...form };
      if (!payload.password) {
        delete payload.password;
      }
      if (editingId) {
        await api.put(`/clients/${editingId}`, payload);
        setMessage("Cliente atualizado com sucesso");
      } else {
        await api.post("/clients", payload);
        setMessage("Cliente criado com sucesso");
      }
      setForm(initialForm);
      setEditingId(null);
      await loadClients();
    } catch (submitError) {
      console.error("Falha ao salvar cliente", submitError);
      setError(submitError);
    } finally {
      setSaving(false);
    }
  }

  function handleEdit(client) {
    setEditingId(client.id);
    setForm({
      name: client.name,
      email: client.email,
      password: "",
      deviceLimit: client.deviceLimit ?? 50,
      userLimit: client.userLimit ?? 20,
    });
  }

  async function handleDelete(client) {
    if (!window.confirm(`Remover ${client.name}? Essa ação não pode ser desfeita.`)) return;
    try {
      await api.delete(`/clients/${client.id}`);
      setMessage("Cliente removido");
      await loadClients();
    } catch (deleteError) {
      console.error("Falha ao remover cliente", deleteError);
      setError(deleteError);
    }
  }

  if (!isAdmin) {
    return (
      <div className="card">
        <h2 className="text-lg font-semibold">Acesso restrito</h2>
        <p className="mt-2 text-sm opacity-70">
          Apenas administradores podem gerenciar clientes. Solicite permissão à equipe Euro One.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <section className="card space-y-4">
        <header className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold">Clientes</h1>
            <p className="text-xs opacity-70">Crie locatários (usuários manager no Traccar) e defina limites de dispositivos.</p>
          </div>
          <button
            type="button"
            onClick={() => {
              setForm(initialForm);
              setEditingId(null);
            }}
            className="rounded-lg border border-border px-3 py-2 text-sm hover:bg-white/5"
          >
            Novo cliente
          </button>
        </header>

        <form className="grid gap-3 md:grid-cols-2" onSubmit={handleSubmit}>
          <label className="text-sm">
            <span className="block text-xs uppercase tracking-wide opacity-60">Nome da empresa</span>
            <input
              type="text"
              value={form.name}
              required
              onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
              className="mt-1 w-full rounded-lg border border-border bg-layer px-3 py-2 text-sm focus:border-primary focus:outline-none"
            />
          </label>

          <label className="text-sm">
            <span className="block text-xs uppercase tracking-wide opacity-60">E-mail</span>
            <input
              type="email"
              value={form.email}
              required
              onChange={(event) => setForm((prev) => ({ ...prev, email: event.target.value }))}
              className="mt-1 w-full rounded-lg border border-border bg-layer px-3 py-2 text-sm focus:border-primary focus:outline-none"
            />
          </label>

          <label className="text-sm">
            <span className="block text-xs uppercase tracking-wide opacity-60">Senha</span>
            <input
              type="password"
              value={form.password}
              required={!editingId}
              placeholder={editingId ? "Deixe em branco para manter" : "Senha temporária"}
              onChange={(event) => setForm((prev) => ({ ...prev, password: event.target.value }))}
              className="mt-1 w-full rounded-lg border border-border bg-layer px-3 py-2 text-sm focus:border-primary focus:outline-none"
            />
          </label>

          <label className="text-sm">
            <span className="block text-xs uppercase tracking-wide opacity-60">Limite de dispositivos</span>
            <input
              type="number"
              min={0}
              value={form.deviceLimit}
              onChange={(event) => setForm((prev) => ({ ...prev, deviceLimit: Number(event.target.value) }))}
              className="mt-1 w-full rounded-lg border border-border bg-layer px-3 py-2 text-sm focus:border-primary focus:outline-none"
            />
          </label>

          <label className="text-sm">
            <span className="block text-xs uppercase tracking-wide opacity-60">Limite de usuários</span>
            <input
              type="number"
              min={0}
              value={form.userLimit}
              onChange={(event) => setForm((prev) => ({ ...prev, userLimit: Number(event.target.value) }))}
              className="mt-1 w-full rounded-lg border border-border bg-layer px-3 py-2 text-sm focus:border-primary focus:outline-none"
            />
          </label>

          <div className="md:col-span-2 flex items-center justify-end gap-3">
            {error && <span className="text-sm text-red-300">{error?.response?.data?.message || error.message}</span>}
            {message && <span className="text-sm text-emerald-300">{message}</span>}
            <button
              type="submit"
              disabled={saving}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90 disabled:opacity-60"
            >
              {saving ? "Salvando…" : editingId ? "Atualizar cliente" : "Adicionar cliente"}
            </button>
          </div>
        </form>
      </section>

      <section className="card">
        <header className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Clientes cadastrados</h2>
          <button
            type="button"
            onClick={loadClients}
            className="rounded-lg border border-border px-3 py-2 text-xs hover:bg-white/5"
          >
            Recarregar
          </button>
        </header>

        {loading ? (
          <p className="text-sm opacity-70">Carregando clientes…</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wide opacity-60">
                <tr>
                  <th className="py-2 pr-4">Empresa</th>
                  <th className="py-2 pr-4">E-mail</th>
                  <th className="py-2 pr-4">Dispositivos</th>
                  <th className="py-2 pr-4">Usuários</th>
                  <th className="py-2 pr-4 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {clients.map((client) => (
                  <tr key={client.id} className="hover:bg-white/5">
                    <td className="py-2 pr-4 text-white">{client.name}</td>
                    <td className="py-2 pr-4 text-white/70">{client.email}</td>
                    <td className="py-2 pr-4">{client.deviceLimit ?? "—"}</td>
                    <td className="py-2 pr-4">{client.userLimit ?? "—"}</td>
                    <td className="py-2 pr-4 text-right">
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => handleEdit(client)}
                          className="rounded-lg border border-border px-3 py-1 text-xs hover:bg-white/5"
                        >
                          Editar
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(client)}
                          className="rounded-lg border border-red-500/40 px-3 py-1 text-xs text-red-300 hover:bg-red-500/10"
                        >
                          Remover
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {!clients.length && (
                  <tr>
                    <td colSpan={5} className="py-4 text-center text-sm opacity-70">
                      Nenhum cliente cadastrado.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
