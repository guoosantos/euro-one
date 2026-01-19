import React, { useEffect, useMemo, useState } from "react";

import api from "../lib/api";
import { API_ROUTES } from "../lib/api-routes";
import { useTenant } from "../lib/tenant-context";
import DataTable from "../components/ui/DataTable";
import PageHeader from "../components/ui/PageHeader";
import { useGroups } from "../lib/hooks/useGroups";

const defaultUserAccess = {
  vehicleAccess: { mode: "all", vehicleIds: [] },
  schedule: { days: [1, 2, 3, 4, 5], start: "08:00", end: "18:00" },
  ipRestriction: { mode: "all", ip: "" },
};

const defaultUserForm = {
  name: "",
  email: "",
  password: "",
  role: "user",
  clientId: "",
  vehicleGroupId: "",
  attributes: {
    userAccess: defaultUserAccess,
    permissionGroupId: "",
  },
};

const roleLabels = {
  admin: "Administrador",
  manager: "Gestor",
  user: "Operador",
  driver: "Motorista",
  viewer: "Visualizador",
};

const tabs = [
  { id: "users", label: "Usuários" },
  { id: "vehicle-groups", label: "Grupos de veículos" },
];

function Drawer({ open, onClose, title, description, children }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[9998] flex">
      <div className="flex-1 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative h-full w-full max-w-3xl border-l border-white/10 bg-[#0f141c] shadow-3xl">
        <div className="flex items-start justify-between gap-4 border-b border-white/10 px-6 py-5">
          <div>
            <p className="text-xs uppercase tracking-[0.12em] text-white/50">Usuários</p>
            <h2 className="text-xl font-semibold text-white">{title}</h2>
            {description && <p className="text-sm text-white/60">{description}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-white/10 bg-white/5 p-2 text-white/70 transition hover:border-white/30 hover:text-white"
            aria-label="Fechar"
          >
            ×
          </button>
        </div>
        <div className="h-[calc(100%-80px)] overflow-y-auto px-6 py-4">{children}</div>
      </div>
    </div>
  );
}

export default function Users() {
  const { role, tenants, tenantId, tenant, user } = useTenant();
  const [users, setUsers] = useState([]);
  const [vehicles, setVehicles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [form, setForm] = useState(defaultUserForm);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [message, setMessage] = useState(null);
  const [activeTab, setActiveTab] = useState("users");
  const [groupDrawerOpen, setGroupDrawerOpen] = useState(false);
  const [editingGroup, setEditingGroup] = useState(null);
  const [groupForm, setGroupForm] = useState({ name: "", description: "", vehicleIds: [] });
  const [transferForm, setTransferForm] = useState({ fromUserId: "", toUserId: "" });

  const managedTenants = useMemo(() => {
    if (role === "admin") {
      return tenants;
    }
    if (tenant) {
      return [tenant];
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
  }, [role, tenants, tenant, user]);

  const selectedTenantId = form.clientId || tenantId || managedTenants[0]?.id || "";
  const allowedRoles = role === "admin" ? Object.keys(roleLabels) : ["user", "driver", "viewer"];
  const isManager = role === "manager";

  const { groups, createGroup, updateGroup, deleteGroup } = useGroups({
    params: selectedTenantId ? { clientId: selectedTenantId } : {},
  });
  const vehicleGroups = useMemo(
    () => groups.filter((entry) => entry.attributes?.kind === "VEHICLE_GROUP"),
    [groups],
  );
  const permissionGroups = useMemo(
    () => groups.filter((entry) => entry.attributes?.kind === "PERMISSION_GROUP"),
    [groups],
  );

  useEffect(() => {
    if (!selectedTenantId && managedTenants.length) {
      setForm((prev) => ({ ...prev, clientId: managedTenants[0].id }));
    }
  }, [managedTenants, selectedTenantId]);

  useEffect(() => {
    if (selectedTenantId && (role === "admin" || role === "manager")) {
      loadUsers(selectedTenantId);
      loadVehicles(selectedTenantId);
    }
  }, [selectedTenantId, role]);

  async function loadUsers(clientId) {
    setLoading(true);
    setError(null);
    try {
      const params = role === "admin" || isManager ? { clientId } : {};
      const response = await api.get(API_ROUTES.users, { params });
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

  async function loadVehicles(clientId) {
    try {
      const response = await api.get(API_ROUTES.core.vehicles, { params: { clientId } });
      const list = response?.data?.vehicles || response?.data || [];
      setVehicles(Array.isArray(list) ? list : []);
    } catch (loadError) {
      console.error("Falha ao carregar veículos", loadError);
      setVehicles([]);
    }
  }

  function updateFormAttributes(path, value) {
    setForm((prev) => ({
      ...prev,
      attributes: {
        ...prev.attributes,
        [path]: value,
      },
    }));
  }

  function updateUserAccess(path, value) {
    setForm((prev) => ({
      ...prev,
      attributes: {
        ...prev.attributes,
        userAccess: {
          ...prev.attributes.userAccess,
          [path]: value,
        },
      },
    }));
  }

  function updateVehicleAccess(updates) {
    setForm((prev) => ({
      ...prev,
      attributes: {
        ...prev.attributes,
        userAccess: {
          ...prev.attributes.userAccess,
          vehicleAccess: {
            ...prev.attributes.userAccess.vehicleAccess,
            ...updates,
          },
        },
      },
    }));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (role !== "admin" && role !== "manager") return;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const safeRole = allowedRoles.includes(form.role) ? form.role : "user";
      const payload = {
        name: form.name,
        email: form.email,
        password: form.password,
        role: safeRole,
        clientId: selectedTenantId,
        attributes: {
          ...form.attributes,
          userAccess: form.attributes.userAccess,
          permissionGroupId: form.attributes.permissionGroupId || null,
        },
      };
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
    const safeRole = allowedRoles.includes(entry.role) ? entry.role : "user";
    const nextAccess = entry.attributes?.userAccess || defaultUserAccess;
    setEditingId(entry.id);
    setForm({
      name: entry.name,
      email: entry.email,
      password: "",
      role: safeRole,
      clientId: selectedTenantId,
      vehicleGroupId: "",
      attributes: {
        userAccess: {
          vehicleAccess: nextAccess.vehicleAccess || defaultUserAccess.vehicleAccess,
          schedule: nextAccess.schedule || defaultUserAccess.schedule,
          ipRestriction: nextAccess.ipRestriction || defaultUserAccess.ipRestriction,
        },
        permissionGroupId: entry.attributes?.permissionGroupId || "",
      },
    });
  }

  async function handleDelete(entry) {
    if (!window.confirm(`Remover usuário ${entry.name}?`)) return;
    try {
      await api.delete(`/users/${entry.id}`);
      setMessage("Usuário removido");
      await loadUsers(selectedTenantId);
    } catch (deleteError) {
      console.error("Falha ao remover usuário", deleteError);
      setError(deleteError);
    }
  }

  function handleGroupSelection(groupId) {
    const group = vehicleGroups.find((entry) => entry.id === groupId);
    if (!group) return;
    const vehicleIds = Array.isArray(group.attributes?.vehicleIds) ? group.attributes.vehicleIds : [];
    updateVehicleAccess({ mode: "selected", vehicleIds });
    setForm((prev) => ({ ...prev, vehicleGroupId: groupId }));
  }

  async function handleTransferAccess(event) {
    event.preventDefault();
    if (!transferForm.fromUserId || !transferForm.toUserId) return;
    try {
      await api.post(`/users/${transferForm.fromUserId}/transfer-access`, {
        toUserId: transferForm.toUserId,
      });
      setMessage("Pacote de acesso transferido");
      setTransferForm({ fromUserId: "", toUserId: "" });
      await loadUsers(selectedTenantId);
    } catch (transferError) {
      console.error("Falha ao transferir acesso", transferError);
      setError(transferError);
    }
  }

  function openGroupDrawer(group = null) {
    setEditingGroup(group);
    setGroupForm({
      name: group?.name || "",
      description: group?.description || "",
      vehicleIds: group?.attributes?.vehicleIds || [],
    });
    setGroupDrawerOpen(true);
  }

  async function handleGroupSubmit(event) {
    event.preventDefault();
    try {
      const payload = {
        name: groupForm.name,
        description: groupForm.description,
        clientId: selectedTenantId,
        attributes: { kind: "VEHICLE_GROUP", vehicleIds: groupForm.vehicleIds },
      };
      if (editingGroup) {
        await updateGroup(editingGroup.id, payload);
      } else {
        await createGroup(payload);
      }
      setGroupDrawerOpen(false);
      setEditingGroup(null);
      setGroupForm({ name: "", description: "", vehicleIds: [] });
    } catch (groupError) {
      console.error("Falha ao salvar grupo", groupError);
      setError(groupError);
    }
  }

  async function handleGroupDelete(entry) {
    if (!window.confirm(`Remover grupo ${entry.name}?`)) return;
    try {
      await deleteGroup(entry.id);
    } catch (groupError) {
      console.error("Falha ao remover grupo", groupError);
      setError(groupError);
    }
  }

  if (role !== "admin" && role !== "manager") {
    return (
      <div className="rounded-2xl border border-white/10 p-6 text-white">
        <h2 className="text-lg font-semibold">Acesso restrito</h2>
        <p className="mt-2 text-sm text-white/70">
          Somente administradores ou gestores podem gerenciar usuários.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6 text-white">
      <PageHeader
        title="Usuários"
        subtitle="Cadastre operadores, defina grupos de veículos e regras avançadas de acesso."
        actions={
          <select
            value={selectedTenantId}
            onChange={(event) => {
              const nextId = event.target.value;
              setForm((prev) => ({ ...prev, clientId: nextId }));
              loadUsers(nextId);
              loadVehicles(nextId);
            }}
            className="rounded-xl border border-border bg-layer px-3 py-2 text-sm text-white"
            disabled={role !== "admin"}
          >
            {managedTenants.map((tenantOption) => (
              <option key={tenantOption.id} value={tenantOption.id}>
                {tenantOption.name}
              </option>
            ))}
          </select>
        }
      />

      <div className="flex flex-wrap gap-2">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={`rounded-xl px-4 py-2 text-sm transition ${
              activeTab === tab.id ? "bg-sky-500 text-black" : "bg-white/10 text-white hover:bg-white/15"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === "users" && (
        <>
          <form onSubmit={handleSubmit} className="space-y-6 border border-white/10 p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold">Cadastro de usuário</h2>
                <p className="text-xs text-white/60">Defina dados básicos, grupo de permissões e acessos avançados.</p>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setForm({ ...defaultUserForm, clientId: selectedTenantId })}
                  className="rounded-xl border border-border px-4 py-2 text-sm text-white/70 hover:bg-white/10"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-xl bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90 disabled:opacity-60"
                >
                  {saving ? "Salvando…" : editingId ? "Salvar alterações" : "Salvar usuário"}
                </button>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <label className="text-sm">
                <span className="block text-xs uppercase tracking-wide text-white/60">Nome</span>
                <input
                  type="text"
                  value={form.name}
                  required
                  onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
                  className="mt-1 w-full rounded-lg border border-border bg-layer px-3 py-2 text-sm"
                />
              </label>

              <label className="text-sm">
                <span className="block text-xs uppercase tracking-wide text-white/60">E-mail</span>
                <input
                  type="email"
                  value={form.email}
                  required
                  onChange={(event) => setForm((prev) => ({ ...prev, email: event.target.value }))}
                  className="mt-1 w-full rounded-lg border border-border bg-layer px-3 py-2 text-sm"
                />
              </label>

              <label className="text-sm">
                <span className="block text-xs uppercase tracking-wide text-white/60">Senha</span>
                <input
                  type="password"
                  value={form.password}
                  required={!editingId}
                  placeholder={editingId ? "Deixe em branco para manter" : "Senha temporária"}
                  onChange={(event) => setForm((prev) => ({ ...prev, password: event.target.value }))}
                  className="mt-1 w-full rounded-lg border border-border bg-layer px-3 py-2 text-sm"
                />
              </label>

              <label className="text-sm">
                <span className="block text-xs uppercase tracking-wide text-white/60">Perfil</span>
                <select
                  value={allowedRoles.includes(form.role) ? form.role : "user"}
                  onChange={(event) => setForm((prev) => ({ ...prev, role: event.target.value }))}
                  className="mt-1 w-full rounded-lg border border-border bg-layer px-3 py-2 text-sm"
                >
                  {allowedRoles.map((value) => (
                    <option key={value} value={value}>
                      {roleLabels[value]}
                    </option>
                  ))}
                </select>
              </label>

              <label className="text-sm md:col-span-2">
                <span className="block text-xs uppercase tracking-wide text-white/60">Grupo de permissões</span>
                <select
                  value={form.attributes.permissionGroupId || ""}
                  onChange={(event) => updateFormAttributes("permissionGroupId", event.target.value)}
                  className="mt-1 w-full rounded-lg border border-border bg-layer px-3 py-2 text-sm"
                >
                  <option value="">Selecionar grupo de permissões</option>
                  {permissionGroups.map((group) => (
                    <option key={group.id} value={group.id}>
                      {group.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="grid gap-4 border-t border-white/10 pt-6 md:grid-cols-2">
              <div className="space-y-3">
                <h3 className="text-sm font-semibold">Acesso por veículo</h3>
                <label className="text-xs text-white/60">
                  <input
                    type="radio"
                    name="vehicleAccessMode"
                    checked={form.attributes.userAccess.vehicleAccess.mode === "all"}
                    onChange={() => updateVehicleAccess({ mode: "all", vehicleIds: [] })}
                    className="mr-2"
                  />
                  Todos os veículos
                </label>
                <label className="text-xs text-white/60">
                  <input
                    type="radio"
                    name="vehicleAccessMode"
                    checked={form.attributes.userAccess.vehicleAccess.mode === "selected"}
                    onChange={() => updateVehicleAccess({ mode: "selected" })}
                    className="mr-2"
                  />
                  Selecionar veículos específicos
                </label>
                <div className="rounded-lg border border-white/10 p-3 text-xs text-white/70">
                  <div className="flex items-center justify-between gap-2">
                    <span>Grupo de veículos</span>
                    <select
                      value={form.vehicleGroupId}
                      onChange={(event) => handleGroupSelection(event.target.value)}
                      className="rounded border border-border bg-layer px-2 py-1 text-xs"
                    >
                      <option value="">Selecionar grupo</option>
                      {vehicleGroups.map((group) => (
                        <option key={group.id} value={group.id}>
                          {group.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="mt-3 grid max-h-40 gap-2 overflow-y-auto">
                    {vehicles.map((vehicle) => {
                      const checked = form.attributes.userAccess.vehicleAccess.vehicleIds.includes(vehicle.id);
                      return (
                        <label key={vehicle.id} className="flex items-center gap-2 text-xs text-white/70">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => {
                              const nextIds = checked
                                ? form.attributes.userAccess.vehicleAccess.vehicleIds.filter((id) => id !== vehicle.id)
                                : [...form.attributes.userAccess.vehicleAccess.vehicleIds, vehicle.id];
                              updateVehicleAccess({ mode: "selected", vehicleIds: nextIds });
                            }}
                          />
                          {vehicle.plate || vehicle.name || vehicle.model || "Veículo"}
                        </label>
                      );
                    })}
                    {!vehicles.length && <span className="text-xs text-white/40">Nenhum veículo encontrado.</span>}
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                <div>
                  <h3 className="text-sm font-semibold">Dias e horários permitidos</h3>
                  <div className="mt-2 grid grid-cols-4 gap-2 text-xs">
                    {["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"].map((label, index) => {
                      const checked = form.attributes.userAccess.schedule.days.includes(index);
                      return (
                        <label key={label} className="flex items-center gap-2 text-white/70">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => {
                              const nextDays = checked
                                ? form.attributes.userAccess.schedule.days.filter((day) => day !== index)
                                : [...form.attributes.userAccess.schedule.days, index];
                              updateUserAccess("schedule", {
                                ...form.attributes.userAccess.schedule,
                                days: nextDays,
                              });
                            }}
                          />
                          {label}
                        </label>
                      );
                    })}
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-3">
                    <label className="text-xs text-white/60">
                      Início
                      <input
                        type="time"
                        value={form.attributes.userAccess.schedule.start}
                        onChange={(event) =>
                          updateUserAccess("schedule", {
                            ...form.attributes.userAccess.schedule,
                            start: event.target.value,
                          })
                        }
                        className="mt-1 w-full rounded-lg border border-border bg-layer px-3 py-2 text-sm"
                      />
                    </label>
                    <label className="text-xs text-white/60">
                      Fim
                      <input
                        type="time"
                        value={form.attributes.userAccess.schedule.end}
                        onChange={(event) =>
                          updateUserAccess("schedule", {
                            ...form.attributes.userAccess.schedule,
                            end: event.target.value,
                          })
                        }
                        className="mt-1 w-full rounded-lg border border-border bg-layer px-3 py-2 text-sm"
                      />
                    </label>
                  </div>
                </div>

                <div>
                  <h3 className="text-sm font-semibold">Restrição por IP</h3>
                  <div className="mt-2 space-y-2 text-xs text-white/70">
                    <label className="flex items-center gap-2">
                      <input
                        type="radio"
                        name="ipRestrictionMode"
                        checked={form.attributes.userAccess.ipRestriction.mode === "all"}
                        onChange={() =>
                          updateUserAccess("ipRestriction", { mode: "all", ip: "" })
                        }
                      />
                      Liberar todos os IPs
                    </label>
                    <label className="flex items-center gap-2">
                      <input
                        type="radio"
                        name="ipRestrictionMode"
                        checked={form.attributes.userAccess.ipRestriction.mode === "single"}
                        onChange={() =>
                          updateUserAccess("ipRestriction", {
                            ...form.attributes.userAccess.ipRestriction,
                            mode: "single",
                          })
                        }
                      />
                      Restringir para um IP
                    </label>
                    {form.attributes.userAccess.ipRestriction.mode === "single" && (
                      <input
                        type="text"
                        value={form.attributes.userAccess.ipRestriction.ip || ""}
                        onChange={(event) =>
                          updateUserAccess("ipRestriction", {
                            mode: "single",
                            ip: event.target.value,
                          })
                        }
                        placeholder="Ex: 192.168.0.10"
                        className="mt-1 w-full rounded-lg border border-border bg-layer px-3 py-2 text-sm"
                      />
                    )}
                  </div>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-end gap-3">
              {error && (
                <span className="text-sm text-red-300">{error?.response?.data?.message || error.message}</span>
              )}
              {message && <span className="text-sm text-emerald-300">{message}</span>}
            </div>
          </form>

          <section className="border border-white/10 p-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold">Usuários vinculados</h2>
                <p className="text-xs text-white/60">Lista dos usuários e controles rápidos.</p>
              </div>
              <button
                type="button"
                onClick={() => loadUsers(selectedTenantId)}
                className="rounded-xl border border-border px-3 py-2 text-xs text-white/70 hover:bg-white/10"
              >
                Recarregar
              </button>
            </div>

            <div className="mt-4">
              {loading ? (
                <p className="text-sm text-white/70">Carregando usuários…</p>
              ) : (
                <DataTable>
                  <thead className="text-left text-xs uppercase tracking-wide text-white/60">
                    <tr>
                      <th className="py-2 pr-4">Nome</th>
                      <th className="py-2 pr-4">E-mail</th>
                      <th className="py-2 pr-4">Perfil</th>
                      <th className="py-2 pr-4 text-right">Ações</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/10">
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
                        <td colSpan={4} className="py-4 text-center text-sm text-white/60">
                          Nenhum usuário cadastrado para este cliente.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </DataTable>
              )}
            </div>
          </section>

          <section className="border border-white/10 p-6">
            <div className="mb-4">
              <h2 className="text-sm font-semibold">Transferência de acesso</h2>
              <p className="text-xs text-white/60">Copie o pacote de acesso de um usuário para outro.</p>
            </div>
            <form onSubmit={handleTransferAccess} className="grid gap-4 md:grid-cols-3">
              <label className="text-sm">
                <span className="block text-xs uppercase tracking-wide text-white/60">Usuário origem</span>
                <select
                  value={transferForm.fromUserId}
                  onChange={(event) => setTransferForm((prev) => ({ ...prev, fromUserId: event.target.value }))}
                  className="mt-1 w-full rounded-lg border border-border bg-layer px-3 py-2 text-sm"
                >
                  <option value="">Selecionar</option>
                  {users.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm">
                <span className="block text-xs uppercase tracking-wide text-white/60">Usuário destino</span>
                <select
                  value={transferForm.toUserId}
                  onChange={(event) => setTransferForm((prev) => ({ ...prev, toUserId: event.target.value }))}
                  className="mt-1 w-full rounded-lg border border-border bg-layer px-3 py-2 text-sm"
                >
                  <option value="">Selecionar</option>
                  {users.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.name}
                    </option>
                  ))}
                </select>
              </label>
              <div className="flex items-end">
                <button
                  type="submit"
                  className="w-full rounded-xl bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90"
                >
                  Transferir acesso
                </button>
              </div>
            </form>
          </section>
        </>
      )}

      {activeTab === "vehicle-groups" && (
        <section className="border border-white/10 p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold">Grupos de veículos</h2>
              <p className="text-xs text-white/60">
                Agrupe veículos para facilitar o controle de acesso por usuário.
              </p>
            </div>
            <button
              type="button"
              onClick={() => openGroupDrawer()}
              className="rounded-xl bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90"
            >
              Novo grupo
            </button>
          </div>
          <div className="mt-4">
            <DataTable>
              <thead className="text-left text-xs uppercase tracking-wide text-white/60">
                <tr>
                  <th className="py-2 pr-4">Nome</th>
                  <th className="py-2 pr-4">Descrição</th>
                  <th className="py-2 pr-4">Veículos</th>
                  <th className="py-2 pr-4 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/10">
                {vehicleGroups.map((entry) => (
                  <tr key={entry.id} className="hover:bg-white/5">
                    <td className="py-2 pr-4 text-white">{entry.name}</td>
                    <td className="py-2 pr-4 text-white/70">{entry.description || "—"}</td>
                    <td className="py-2 pr-4 text-white/70">
                      {entry.attributes?.vehicleIds?.length || 0}
                    </td>
                    <td className="py-2 pr-4 text-right">
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => openGroupDrawer(entry)}
                          className="rounded-lg border border-border px-3 py-1 text-xs hover:bg-white/5"
                        >
                          Editar
                        </button>
                        <button
                          type="button"
                          onClick={() => handleGroupDelete(entry)}
                          className="rounded-lg border border-red-500/40 px-3 py-1 text-xs text-red-300 hover:bg-red-500/10"
                        >
                          Remover
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {!vehicleGroups.length && (
                  <tr>
                    <td colSpan={4} className="py-4 text-center text-sm text-white/60">
                      Nenhum grupo cadastrado para este cliente.
                    </td>
                  </tr>
                )}
              </tbody>
            </DataTable>
          </div>
        </section>
      )}

      <Drawer
        open={groupDrawerOpen}
        onClose={() => setGroupDrawerOpen(false)}
        title={editingGroup ? "Editar grupo de veículos" : "Novo grupo de veículos"}
        description="Selecione os veículos que compõem o grupo."
      >
        <form onSubmit={handleGroupSubmit} className="space-y-4">
          <label className="text-sm">
            <span className="block text-xs uppercase tracking-wide text-white/60">Nome</span>
            <input
              type="text"
              value={groupForm.name}
              required
              onChange={(event) => setGroupForm((prev) => ({ ...prev, name: event.target.value }))}
              className="mt-1 w-full rounded-lg border border-border bg-layer px-3 py-2 text-sm"
            />
          </label>
          <label className="text-sm">
            <span className="block text-xs uppercase tracking-wide text-white/60">Descrição</span>
            <input
              type="text"
              value={groupForm.description}
              onChange={(event) => setGroupForm((prev) => ({ ...prev, description: event.target.value }))}
              className="mt-1 w-full rounded-lg border border-border bg-layer px-3 py-2 text-sm"
            />
          </label>
          <div className="space-y-2">
            <span className="block text-xs uppercase tracking-wide text-white/60">Veículos</span>
            <div className="grid max-h-72 gap-2 overflow-y-auto rounded-lg border border-white/10 p-3 text-xs">
              {vehicles.map((vehicle) => {
                const checked = groupForm.vehicleIds.includes(vehicle.id);
                return (
                  <label key={vehicle.id} className="flex items-center gap-2 text-white/70">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => {
                        const nextIds = checked
                          ? groupForm.vehicleIds.filter((id) => id !== vehicle.id)
                          : [...groupForm.vehicleIds, vehicle.id];
                        setGroupForm((prev) => ({ ...prev, vehicleIds: nextIds }));
                      }}
                    />
                    {vehicle.plate || vehicle.name || vehicle.model || "Veículo"}
                  </label>
                );
              })}
              {!vehicles.length && <span className="text-white/40">Nenhum veículo encontrado.</span>}
            </div>
          </div>
          <div className="flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={() => setGroupDrawerOpen(false)}
              className="rounded-xl border border-border px-4 py-2 text-sm text-white/70 hover:bg-white/10"
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="rounded-xl bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90"
            >
              Salvar grupo
            </button>
          </div>
        </form>
      </Drawer>
    </div>
  );
}
