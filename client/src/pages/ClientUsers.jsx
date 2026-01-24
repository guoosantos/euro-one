import React, { useEffect, useMemo, useState } from "react";

import api from "../lib/api";
import { API_ROUTES } from "../lib/api-routes.js";
import { useTenant } from "../lib/tenant-context";
import PageHeader from "../components/ui/PageHeader.jsx";
import { useConfirmDialog } from "../components/ui/ConfirmDialogProvider.jsx";
import usePageToast from "../lib/hooks/usePageToast.js";
import PageToast from "../components/ui/PageToast.jsx";
import { confirmDeleteAction } from "../lib/confirm-delete.js";

const defaultUserForm = {
  name: "",
  email: "",
  password: "",
  role: "user",
  clientId: "",
};

const roleLabels = {
  admin: "Administrador",
  manager: "Gestor",
  user: "Operador",
  driver: "Motorista",
  viewer: "Visualizador",
};

export default function ClientUsers() {
  const { role, tenants, tenantId, user } = useTenant();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [form, setForm] = useState(defaultUserForm);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [message, setMessage] = useState(null);
  const { confirmDelete } = useConfirmDialog();
  const { toast, showToast } = usePageToast();

  const managedTenants = useMemo(() => {
    if (role === "admin") {
      return tenants;
    }
    if (user) {
      return [
        {
          id: user.id,
          name: user.attributes?.companyName || user.name || "Minha frota",
        },
      ];
    }
    return tenants;
  }, [role, tenants, user]);

  const selectedTenantId = form.clientId || tenantId || managedTenants[0]?.id || "";

  useEffect(() => {
    if (!selectedTenantId && managedTenants.length) {
      setForm((prev) => ({ ...prev, clientId: managedTenants[0].id }));
    }
  }, [managedTenants, selectedTenantId]);

  useEffect(() => {
    if (selectedTenantId) {
      loadUsers(selectedTenantId);
    }
  }, [selectedTenantId]);

  async function loadUsers(clientId) {
    setLoading(true);
    setError(null);
    try {
      const response = await api.get(API_ROUTES.users, { params: role === "admin" ? { clientId } : {} });
      const list = response?.data?.users || response?.data || [];
      setUsers(Array.isArray(list) ? list : []);
    } catch (loadError) {
      console.error("Falha ao carregar usuários", loadError);
      setError(loadError);
      setUsers([]);
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
      const payload = { ...form, clientId: selectedTenantId };
      if (!payload.password) {
        delete payload.password;
      }
      if (editingId) {
        await api.put(`/users/${editingId}`, payload);
        setMessage("Usuário atualizado");
      } else {
        await api.post(API_ROUTES.users, payload);
        setMessage("Usuário criado");
      }
      setForm({ ...defaultUserForm, clientId: selectedTenantId });
      setEditingId(null);
      await loadUsers(selectedTenantId);
    } catch (submitError) {
      console.error("Falha ao salvar usuário", submitError);
      setError(submitError);
    } finally {
      setSaving(false);
    }
  }

  function handleEdit(entry) {
    setEditingId(entry.id);
    setForm({
      name: entry.name,
      email: entry.email,
      password: "",
      role: entry.role || "user",
      clientId: selectedTenantId,
    });
  }

  async function handleDelete(entry) {
    await confirmDeleteAction({
      confirmDelete,
      title: "Excluir usuário",
      message: `Tem certeza que deseja excluir o usuário ${entry.name}? Essa ação não pode ser desfeita.`,
      confirmLabel: "Excluir",
      onDelete: async () => {
        try {
          await api.delete(`/users/${entry.id}`);
          setMessage("Excluído com sucesso.");
          showToast("Excluído com sucesso.");
          await loadUsers(selectedTenantId);
        } catch (requestError) {
          showToast("Falha ao excluir.", "error");
          throw requestError;
        }
      },
    });
  }

  if (role !== "admin" && role !== "manager") {
    return (
      <div className="card">
        <h2 className="text-lg font-semibold">Acesso restrito</h2>
        <p className="mt-2 text-sm opacity-70">Somente administradores ou gestores podem gerenciar usuários.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <section className="card space-y-4">
        <PageHeader
          overline="Central de usuários"
          title="Usuários"
          subtitle="Cadastre operadores, motoristas ou gestores vinculados ao cliente selecionado."
          rightSlot={
            <select
              value={selectedTenantId}
              onChange={(event) => {
                const nextId = event.target.value;
                setForm((prev) => ({ ...prev, clientId: nextId }));
                loadUsers(nextId);
              }}
              className="w-full rounded-lg border border-border bg-layer px-3 py-2 text-sm md:w-72"
            >
              {managedTenants.map((tenant) => (
                <option key={tenant.id} value={tenant.id}>
                  {tenant.name}
                </option>
              ))}
            </select>
          }
        />

        <form className="grid gap-3 md:grid-cols-2" onSubmit={handleSubmit}>
          <label className="text-sm">
            <span className="block text-xs uppercase tracking-wide opacity-60">Nome</span>
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
            <span className="block text-xs uppercase tracking-wide opacity-60">Perfil</span>
            <select
              value={form.role}
              onChange={(event) => setForm((prev) => ({ ...prev, role: event.target.value }))}
              className="mt-1 w-full rounded-lg border border-border bg-layer px-3 py-2 text-sm focus:border-primary focus:outline-none"
            >
              {Object.entries(roleLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>

          <div className="md:col-span-2 flex items-center justify-end gap-3">
            {error && <span className="text-sm text-red-300">{error?.response?.data?.message || error.message}</span>}
            {message && <span className="text-sm text-emerald-300">{message}</span>}
            <button
              type="submit"
              disabled={saving}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90 disabled:opacity-60"
            >
              {saving ? "Salvando…" : editingId ? "Atualizar usuário" : "Adicionar usuário"}
            </button>
          </div>
        </form>
      </section>

      <section className="card">
        <header className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Usuários vinculados</h2>
          <button
            type="button"
            onClick={() => loadUsers(selectedTenantId)}
            className="rounded-lg border border-border px-3 py-2 text-xs hover:bg-white/5"
          >
            Recarregar
          </button>
        </header>

        {loading ? (
          <p className="text-sm opacity-70">Carregando usuários…</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wide opacity-60">
                <tr>
                  <th className="py-2 pr-4">Nome</th>
                  <th className="py-2 pr-4">E-mail</th>
                  <th className="py-2 pr-4">Perfil</th>
                  <th className="py-2 pr-4 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {users.map((entry) => (
                  <tr key={entry.id} className="hover:bg-white/5">
                    <td className="py-2 pr-4 text-white">{entry.name}</td>
                    <td className="py-2 pr-4 text-white/70">{entry.email}</td>
                    <td className="py-2 pr-4 text-white/70">{roleLabels[entry.role] || entry.role || "—"}</td>
                    <td className="py-2 pr-4 text-right">
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => handleEdit(entry)}
                          className="rounded-lg border border-border px-3 py-1 text-xs hover:bg-white/5"
                        >
                          Editar
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(entry)}
                          className="rounded-lg border border-red-500/40 px-3 py-1 text-xs text-red-300 hover:bg-red-500/10"
                        >
                          Remover
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {!users.length && (
                  <tr>
                    <td colSpan={4} className="py-4 text-center text-sm opacity-70">
                      Nenhum usuário cadastrado para este cliente.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <PageToast toast={toast} />
    </div>
  );
}
