import React, { useEffect, useMemo, useState } from "react";
import api from "../lib/api";
import { API_ROUTES } from "../lib/api-routes";

const STORAGE_KEY = "euro-one.users.visible-columns";
const allColumns = [
  { key: "name", label: "Nome" },
  { key: "email", label: "E-mail" },
  { key: "role", label: "Perfil" },
  { key: "clientId", label: "Cliente" },
];

function loadVisibleColumns() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed) && parsed.length) return parsed;
    }
  } catch (error) {
    console.warn("Falha ao carregar preferências de colunas", error);
  }
  return allColumns.map((column) => column.key);
}

function persistVisibleColumns(columns) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(columns));
  } catch (error) {
    console.warn("Falha ao salvar colunas", error);
  }
}

export default function Users() {
  const [users, setUsers] = useState([]);
  const [form, setForm] = useState({ role: "user" });
  const [editingId, setEditingId] = useState(null);
  const [error, setError] = useState(null);
  const [visibleColumns, setVisibleColumns] = useState(loadVisibleColumns());

  const activeColumns = useMemo(
    () => allColumns.filter((column) => visibleColumns.includes(column.key)),
    [visibleColumns],
  );

  useEffect(() => {
    persistVisibleColumns(visibleColumns);
  }, [visibleColumns]);

  useEffect(() => {
    api
      .get(API_ROUTES.users)
      .then((response) => setUsers(response?.data?.users || []))
      .catch((err) => setError(err));
  }, []);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError(null);
    try {
      if (editingId) {
        const response = await api.put(`${API_ROUTES.users}/${editingId}`, form);
        setUsers((list) => list.map((user) => (user.id === editingId ? response.data.user : user)));
      } else {
        const response = await api.post(API_ROUTES.users, form);
        setUsers((list) => [...list, response.data.user]);
      }
      setForm({ role: "user" });
      setEditingId(null);
    } catch (err) {
      setError(err);
    }
  };

  const startEdit = (user) => {
    setEditingId(user.id);
    setForm({ name: user.name, email: user.email, role: user.role, clientId: user.clientId });
  };

  const remove = async (id) => {
    if (!window.confirm("Deseja remover este usuário?")) return;
    await api.delete(`${API_ROUTES.users}/${id}`);
    setUsers((list) => list.filter((user) => user.id !== id));
  };

  return (
    <div className="space-y-6 text-white/80">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Usuários e perfis</h1>
      </div>

      <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
        <form className="grid gap-3 md:grid-cols-2" onSubmit={handleSubmit}>
          <label className="flex flex-col gap-1 text-sm">
            Nome
            <input
              required
              value={form.name || ""}
              onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
              className="rounded-lg border border-white/10 bg-white/10 p-2 text-white"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            E-mail
            <input
              required
              type="email"
              value={form.email || ""}
              onChange={(e) => setForm((prev) => ({ ...prev, email: e.target.value }))}
              className="rounded-lg border border-white/10 bg-white/10 p-2 text-white"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Perfil
            <select
              value={form.role || "user"}
              onChange={(e) => setForm((prev) => ({ ...prev, role: e.target.value }))}
              className="rounded-lg border border-white/10 bg-white/10 p-2 text-white"
            >
              <option value="admin">Admin</option>
              <option value="manager">Manager</option>
              <option value="user">Viewer</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Client ID
            <input
              value={form.clientId || ""}
              onChange={(e) => setForm((prev) => ({ ...prev, clientId: e.target.value }))}
              className="rounded-lg border border-white/10 bg-white/10 p-2 text-white"
            />
          </label>
          <div className="md:col-span-2 flex items-center gap-3">
            <button type="submit" className="rounded-lg bg-blue-600 px-4 py-2 text-white shadow">
              {editingId ? "Salvar" : "Adicionar"}
            </button>
            {editingId && (
              <button
                type="button"
                onClick={() => {
                  setEditingId(null);
                  setForm({ role: "user" });
                }}
                className="text-sm text-white/70 underline"
              >
                Cancelar edição
              </button>
            )}
            {error && <span className="text-sm text-red-300">{error.message}</span>}
          </div>
        </form>
      </div>

      <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
        <div className="mb-3 text-sm font-semibold text-white">Colunas visíveis</div>
        <div className="flex flex-wrap gap-3 text-sm">
          {allColumns.map((column) => (
            <label key={column.key} className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={visibleColumns.includes(column.key)}
                onChange={(e) => {
                  const next = e.target.checked
                    ? [...visibleColumns, column.key]
                    : visibleColumns.filter((item) => item !== column.key);
                  setVisibleColumns(next);
                }}
              />
              {column.label}
            </label>
          ))}
        </div>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-white/10 bg-white/5">
        <table className="min-w-full text-sm">
          <thead className="bg-white/10 text-left text-xs uppercase text-white/60">
            <tr>
              {activeColumns.map((column) => (
                <th key={column.key} className="px-4 py-3">
                  {column.label}
                </th>
              ))}
              <th className="px-4 py-3">Ações</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/10">
            {users.map((user) => (
              <tr key={user.id} className="hover:bg-white/5">
                {activeColumns.map((column) => (
                  <td key={column.key} className="px-4 py-2 text-white/80">
                    {user[column.key] ?? "-"}
                  </td>
                ))}
                <td className="px-4 py-2">
                  <div className="flex gap-2 text-xs">
                    <button className="text-blue-300 underline" onClick={() => startEdit(user)}>
                      Editar
                    </button>
                    <button className="text-red-300 underline" onClick={() => remove(user.id)}>
                      Excluir
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {!users.length && (
              <tr>
                <td className="px-4 py-3 text-white/60" colSpan={activeColumns.length + 1}>
                  Nenhum usuário cadastrado.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
