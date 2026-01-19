import React, { useEffect, useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Eye,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  X,
} from "lucide-react";

import api from "../lib/api";
import { API_ROUTES } from "../lib/api-routes";
import { useTenant } from "../lib/tenant-context";
import DataTable from "../components/ui/DataTable";
import PageHeader from "../components/ui/PageHeader";
import FilterBar from "../components/ui/FilterBar";
import AutocompleteSelect from "../components/ui/AutocompleteSelect";
import { useGroups } from "../lib/hooks/useGroups";
import { formatVehicleLabel } from "../lib/hooks/useVehicles";
import { PERMISSION_REGISTRY } from "../lib/permissions/registry";

const defaultUserAccess = {
  vehicleAccess: { mode: "all", vehicleIds: [] },
  vehicleGroupIds: [],
  schedule: { days: [], start: "", end: "" },
  ipRestriction: { mode: "all", ip: "" },
};

const defaultUserForm = {
  name: "",
  email: "",
  username: "",
  password: "",
  role: "user",
  clientId: "",
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
  { id: "permission-groups", label: "Grupos de permissões" },
];

const accessTabs = [
  { id: "geral", label: "Geral" },
  { id: "acesso", label: "Acesso" },
];

const detailsTabs = [
  { id: "geral", label: "Geral" },
  { id: "veiculos", label: "Veículos" },
];

const daysOfWeek = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

const permissionLevels = [
  { value: "none", label: "Sem acesso" },
  { value: "view", label: "Somente visualizar" },
  { value: "full", label: "Acesso completo" },
];

const permissionMatrix = PERMISSION_REGISTRY;

function Drawer({ open, onClose, title, description, children, eyebrow = "Usuários" }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[9998] flex">
      <div className="flex-1 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative h-full w-full max-w-3xl border-l border-white/10 bg-[#0f141c] shadow-3xl">
        <div className="flex items-start justify-between gap-4 border-b border-white/10 px-6 py-5">
          <div>
            <p className="text-xs uppercase tracking-[0.12em] text-white/50">{eyebrow}</p>
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

function normalizeText(value) {
  return String(value || "").trim().toLowerCase();
}

function isValidIpAddress(value) {
  if (!value) return false;
  const ipv4Chunk = "(25[0-5]|2[0-4]\\d|1\\d{2}|[1-9]?\\d)";
  const ipv4Regex = new RegExp(`^${ipv4Chunk}(\\.${ipv4Chunk}){3}$`);
  const ipv6Regex =
    /^(?:[a-fA-F0-9]{1,4}:){7}[a-fA-F0-9]{1,4}$|^(?:[a-fA-F0-9]{1,4}:){1,7}:$|^:(?::[a-fA-F0-9]{1,4}){1,7}$/;
  return ipv4Regex.test(value) || ipv6Regex.test(value);
}

function uniqueList(items) {
  return Array.from(new Set(items.map((item) => String(item))));
}

function normalizePermissionLevel(level) {
  if (level === "none" || level === "view") return level;
  return "full";
}

function normalizePermissionPayload(permissions = {}) {
  const normalized = {};
  Object.entries(permissions || {}).forEach(([menuKey, pages]) => {
    const nextPages = {};
    Object.entries(pages || {}).forEach(([pageKey, value]) => {
      if (typeof value === "string") {
        nextPages[pageKey] = normalizePermissionLevel(value);
        return;
      }
      if (value && typeof value === "object") {
        const subpages = {};
        Object.entries(value.subpages || {}).forEach(([subKey, subValue]) => {
          subpages[subKey] = normalizePermissionLevel(subValue);
        });
        nextPages[pageKey] = {
          ...value,
          level: normalizePermissionLevel(value.level),
          subpages,
        };
      }
    });
    normalized[menuKey] = nextPages;
  });
  return normalized;
}

function resolveVehicleGroupIds(userAccess) {
  const groupIds = Array.isArray(userAccess?.vehicleGroupIds)
    ? userAccess.vehicleGroupIds
    : userAccess?.vehicleGroupId
      ? [userAccess.vehicleGroupId]
      : [];
  return uniqueList(groupIds.filter(Boolean));
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
  const [permissionDrawerOpen, setPermissionDrawerOpen] = useState(false);
  const [editingPermissionGroup, setEditingPermissionGroup] = useState(null);
  const [permissionForm, setPermissionForm] = useState({ name: "", description: "", permissions: {} });
  const [activeUserDrawerTab, setActiveUserDrawerTab] = useState("geral");
  const [userDrawerOpen, setUserDrawerOpen] = useState(false);
  const [detailsDrawerOpen, setDetailsDrawerOpen] = useState(false);
  const [detailsDrawerTab, setDetailsDrawerTab] = useState("geral");
  const [detailsUser, setDetailsUser] = useState(null);
  const [query, setQuery] = useState("");
  const [groupQuery, setGroupQuery] = useState("");
  const [permissionQuery, setPermissionQuery] = useState("");
  const [vehiclePickId, setVehiclePickId] = useState("");
  const [vehicleGroupPickId, setVehicleGroupPickId] = useState("");
  const [groupVehiclePickId, setGroupVehiclePickId] = useState("");
  const [detailsSearch, setDetailsSearch] = useState("");
  const [openPermissionMenus, setOpenPermissionMenus] = useState({});
  const [bulkPermissionLevels, setBulkPermissionLevels] = useState({});

  const canManageUsers = role === "admin" || role === "manager";

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

  const [selectedTenantId, setSelectedTenantId] = useState(
    tenantId || managedTenants[0]?.id || "",
  );

  const allowedRoles = role === "admin" ? Object.keys(roleLabels) : ["user", "driver", "viewer"];
  const isManager = role === "manager";

  const { groups, reload: reloadGroups, createGroup, updateGroup, deleteGroup } = useGroups({
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
      setSelectedTenantId(managedTenants[0].id);
    }
  }, [managedTenants, selectedTenantId]);

  useEffect(() => {
    if (selectedTenantId && canManageUsers) {
      loadUsers(selectedTenantId);
      loadVehicles(selectedTenantId);
    }
  }, [selectedTenantId, canManageUsers]);

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
    if (!canManageUsers) return;
    const ipMode = form.attributes.userAccess.ipRestriction.mode;
    const ipValue = form.attributes.userAccess.ipRestriction.ip;
    const isIpValid = ipMode !== "single" || isValidIpAddress(ipValue);
    if (!isIpValid) {
      setError(new Error("Informe um IP válido para a restrição."));
      return;
    }
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const safeRole = allowedRoles.includes(form.role) ? form.role : "user";
      const normalizedUserAccess = {
        ...form.attributes.userAccess,
        vehicleGroupIds: resolveVehicleGroupIds(form.attributes.userAccess),
      };
      const payload = {
        name: form.name,
        email: form.email,
        username: form.username || null,
        password: form.password,
        role: safeRole,
        clientId: selectedTenantId,
        attributes: {
          ...form.attributes,
          userAccess: normalizedUserAccess,
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
      setUserDrawerOpen(false);
      await loadUsers(selectedTenantId);
    } catch (submitError) {
      console.error("Falha ao salvar usuário", submitError);
      setError(submitError);
    } finally {
      setSaving(false);
    }
  }

  function openUserDrawer(entry = null) {
    setError(null);
    setMessage(null);
    setActiveUserDrawerTab("geral");
    if (entry) {
      const safeRole = allowedRoles.includes(entry.role) ? entry.role : "user";
      const userAccess = entry.attributes?.userAccess || {};
      setEditingId(entry.id);
      setForm({
        name: entry.name || "",
        email: entry.email || "",
        username: entry.username || "",
        password: "",
        role: safeRole,
        clientId: selectedTenantId,
        attributes: {
          userAccess: {
            vehicleAccess: userAccess.vehicleAccess || defaultUserAccess.vehicleAccess,
            vehicleGroupIds: resolveVehicleGroupIds(userAccess),
            schedule: userAccess.schedule || defaultUserAccess.schedule,
            ipRestriction: userAccess.ipRestriction || defaultUserAccess.ipRestriction,
          },
          permissionGroupId: entry.attributes?.permissionGroupId || "",
        },
      });
    } else {
      setEditingId(null);
      setForm({ ...defaultUserForm, clientId: selectedTenantId });
    }
    setUserDrawerOpen(true);
  }

  function openDetailsDrawer(entry) {
    setDetailsUser(entry);
    setDetailsDrawerTab("geral");
    setDetailsSearch("");
    setDetailsDrawerOpen(true);
  }

  function handleVehicleGroupAdd(groupId) {
    if (!groupId) return;
    const nextIds = uniqueList([...selectedVehicleGroupIds, groupId]);
    updateUserAccess("vehicleGroupIds", nextIds);
    setVehicleGroupPickId("");
  }

  function handleVehicleGroupRemove(groupId) {
    const nextIds = selectedVehicleGroupIds.filter((value) => String(value) !== String(groupId));
    updateUserAccess("vehicleGroupIds", nextIds);
  }

  function openGroupDrawer(group = null) {
    setEditingGroup(group);
    setGroupForm({
      name: group?.name || "",
      description: group?.description || "",
      vehicleIds: group?.attributes?.vehicleIds || [],
    });
    setGroupVehiclePickId("");
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

  function openPermissionDrawer(group = null) {
    setEditingPermissionGroup(group);
    setPermissionForm({
      name: group?.name || "",
      description: group?.description || "",
      permissions: normalizePermissionPayload(group?.attributes?.permissions || {}),
    });
    setPermissionDrawerOpen(true);
  }

  async function handlePermissionSubmit(event) {
    event.preventDefault();
    try {
      const payload = {
        name: permissionForm.name,
        description: permissionForm.description,
        clientId: selectedTenantId,
        attributes: {
          kind: "PERMISSION_GROUP",
          permissions: normalizePermissionPayload(permissionForm.permissions),
        },
      };
      if (editingPermissionGroup) {
        await updateGroup(editingPermissionGroup.id, payload);
      } else {
        await createGroup(payload);
      }
      setPermissionDrawerOpen(false);
      setEditingPermissionGroup(null);
      setPermissionForm({ name: "", description: "", permissions: {} });
    } catch (permissionError) {
      console.error("Falha ao salvar grupo de permissões", permissionError);
      setError(permissionError);
    }
  }

  async function handlePermissionDelete(entry) {
    if (!window.confirm(`Remover grupo ${entry.name}?`)) return;
    try {
      await deleteGroup(entry.id);
    } catch (permissionError) {
      console.error("Falha ao remover grupo de permissões", permissionError);
      setError(permissionError);
    }
  }

  function handlePermissionUpdate(menuKey, pageKey, level, subKey) {
    setPermissionForm((prev) => {
      const next = { ...prev.permissions };
      const menuPermissions = { ...(next[menuKey] || {}) };
      if (subKey) {
        const basePage = menuPermissions[pageKey];
        const pagePermissions =
          typeof basePage === "object" && basePage !== null && !Array.isArray(basePage)
            ? basePage
            : {};
        const subpages = { ...(pagePermissions.subpages || {}) };
        subpages[subKey] = level;
        menuPermissions[pageKey] = { ...pagePermissions, subpages };
      } else {
        menuPermissions[pageKey] = level;
      }
      next[menuKey] = menuPermissions;
      return { ...prev, permissions: next };
    });
  }

  function handleApplyMenuLevel(menuKey) {
    const level = bulkPermissionLevels[menuKey] || "none";
    setPermissionForm((prev) => {
      const next = { ...prev.permissions };
      const menuPermissions = { ...(next[menuKey] || {}) };
      const menu = permissionMatrix.find((item) => item.menuKey === menuKey);
      menu?.pages.forEach((page) => {
        if (page.subpages?.length) {
          const subpages = {};
          page.subpages.forEach((subpage) => {
            subpages[subpage.subKey] = level;
          });
          menuPermissions[page.pageKey] = { level, subpages };
        } else {
          menuPermissions[page.pageKey] = level;
        }
      });
      next[menuKey] = menuPermissions;
      return { ...prev, permissions: next };
    });
  }

  function getPermissionValue(menuKey, pageKey, subKey) {
    const menuPermissions = permissionForm.permissions?.[menuKey] || {};
    if (subKey) {
      return normalizePermissionLevel(menuPermissions?.[pageKey]?.subpages?.[subKey]) || "none";
    }
    const value = menuPermissions?.[pageKey];
    if (typeof value === "string") return normalizePermissionLevel(value);
    if (value?.level) return normalizePermissionLevel(value.level);
    return "none";
  }

  const vehicleMap = useMemo(() => {
    const map = new Map();
    vehicles.forEach((vehicle) => {
      map.set(String(vehicle.id), vehicle);
    });
    return map;
  }, [vehicles]);

  const vehicleGroupMap = useMemo(() => {
    const map = new Map();
    vehicleGroups.forEach((group) => {
      map.set(String(group.id), group);
    });
    return map;
  }, [vehicleGroups]);

  const vehicleOptions = useMemo(
    () =>
      vehicles.map((vehicle) => ({
        value: vehicle.id,
        label: formatVehicleLabel(vehicle),
        description: vehicle.plate || vehicle.model || "",
      })),
    [vehicles],
  );

  const vehicleGroupOptions = useMemo(
    () =>
      vehicleGroups.map((group) => ({
        value: group.id,
        label: group.name,
        description: `${group.attributes?.vehicleIds?.length || 0} veículos`,
      })),
    [vehicleGroups],
  );

  const selectedVehicleGroupIds = useMemo(
    () => resolveVehicleGroupIds(form.attributes.userAccess),
    [form.attributes.userAccess],
  );

  const selectedGroupVehicleIds = useMemo(() => {
    const ids = new Set();
    selectedVehicleGroupIds.forEach((groupId) => {
      const group = vehicleGroupMap.get(String(groupId));
      (group?.attributes?.vehicleIds || []).forEach((id) => ids.add(String(id)));
    });
    return Array.from(ids);
  }, [selectedVehicleGroupIds, vehicleGroupMap]);

  const selectedVehicleCount = useMemo(() => {
    if (form.attributes.userAccess.vehicleAccess.mode === "all") {
      return vehicles.length;
    }
    const combined = uniqueList([
      ...(form.attributes.userAccess.vehicleAccess.vehicleIds || []),
      ...selectedGroupVehicleIds,
    ]);
    return combined.length;
  }, [form.attributes.userAccess.vehicleAccess, selectedGroupVehicleIds, vehicles]);

  const filteredUsers = useMemo(() => {
    const term = normalizeText(query);
    if (!term) return users;
    return users.filter((entry) => {
      const haystack = [entry.name, entry.email, entry.username].filter(Boolean).join(" ").toLowerCase();
      return haystack.includes(term);
    });
  }, [query, users]);

  const filteredVehicleGroups = useMemo(() => {
    const term = normalizeText(groupQuery);
    if (!term) return vehicleGroups;
    return vehicleGroups.filter((entry) => {
      const haystack = [entry.name, entry.description].filter(Boolean).join(" ").toLowerCase();
      return haystack.includes(term);
    });
  }, [groupQuery, vehicleGroups]);

  const filteredPermissionGroups = useMemo(() => {
    const term = normalizeText(permissionQuery);
    if (!term) return permissionGroups;
    return permissionGroups.filter((entry) => {
      const haystack = [entry.name, entry.description].filter(Boolean).join(" ").toLowerCase();
      return haystack.includes(term);
    });
  }, [permissionQuery, permissionGroups]);

  const detailsVehicleGroups = useMemo(() => {
    if (!detailsUser) return [];
    const groupIds = resolveVehicleGroupIds(detailsUser.attributes?.userAccess);
    return groupIds.map((id) => vehicleGroupMap.get(String(id))).filter(Boolean);
  }, [detailsUser, vehicleGroupMap]);

  const detailsVehicles = useMemo(() => {
    if (!detailsUser) return [];
    const userAccess = detailsUser.attributes?.userAccess || defaultUserAccess;
    if (userAccess.vehicleAccess?.mode === "all") return vehicles;
    const ids = new Set((userAccess.vehicleAccess?.vehicleIds || []).map(String));
    resolveVehicleGroupIds(userAccess).forEach((groupId) => {
      const group = vehicleGroupMap.get(String(groupId));
      (group?.attributes?.vehicleIds || []).forEach((vehicleId) => ids.add(String(vehicleId)));
    });
    return vehicles.filter((vehicle) => ids.has(String(vehicle.id)));
  }, [detailsUser, vehicles, vehicleGroupMap]);

  const filteredDetailsVehicles = useMemo(() => {
    const term = normalizeText(detailsSearch);
    if (!term) return detailsVehicles;
    return detailsVehicles.filter((vehicle) => {
      const haystack = [vehicle.plate, vehicle.name, vehicle.model].filter(Boolean).join(" ").toLowerCase();
      return haystack.includes(term);
    });
  }, [detailsSearch, detailsVehicles]);

  if (!canManageUsers) {
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
    <div className="flex min-h-[calc(100vh-180px)] flex-col gap-6 text-white">
      <PageHeader
        overline="Central de usuários"
        title="Usuários"
        subtitle="Cadastre operadores, defina grupos e regras avançadas de acesso."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => {
                if (selectedTenantId) {
                  loadUsers(selectedTenantId);
                  loadVehicles(selectedTenantId);
                  reloadGroups();
                }
              }}
              className="rounded-xl bg-white/10 px-4 py-2 text-sm text-white transition hover:bg-white/15"
            >
              <span className="inline-flex items-center gap-2">
                <RefreshCw className="h-4 w-4" /> Atualizar
              </span>
            </button>
            <button
              type="button"
              onClick={() => openUserDrawer()}
              className="rounded-xl bg-sky-500 px-4 py-2 text-sm font-medium text-black transition hover:bg-sky-400"
            >
              <span className="inline-flex items-center gap-2">
                <Plus className="h-4 w-4" /> Novo usuário
              </span>
            </button>
          </div>
        }
      />

      {error && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {error?.response?.data?.message || error.message}
        </div>
      )}
      {message && <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">{message}</div>}

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
        <div className="space-y-4">
          <FilterBar
            left={
              <div className="relative min-w-[240px] flex-1">
                <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-white/50" />
                <input
                  placeholder="Buscar por nome, e-mail ou login"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  className="w-full rounded-xl border border-white/10 bg-black/30 py-2 pl-10 pr-4 text-sm text-white placeholder:text-white/50 focus:border-white/30 focus:outline-none"
                />
              </div>
            }
            right={
              <select
                value={selectedTenantId}
                onChange={(event) => {
                  const nextId = event.target.value;
                  setSelectedTenantId(nextId);
                  loadUsers(nextId);
                  loadVehicles(nextId);
                  reloadGroups();
                }}
                className="min-w-[220px] rounded-xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
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

          <div className="flex-1 overflow-hidden">
            <DataTable tableClassName="text-white/80">
              <thead className="bg-white/5 text-xs uppercase tracking-wide text-white/60">
                <tr>
                  <th className="px-4 py-3 text-left">Usuário</th>
                  <th className="px-4 py-3 text-left">Email</th>
                  <th className="px-4 py-3 text-left">Login</th>
                  <th className="px-4 py-3 text-left">Veículos</th>
                  <th className="px-4 py-3 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/10">
                {loading && (
                  <tr>
                    <td colSpan={5} className="px-4 py-6 text-sm text-white/60">
                      Carregando usuários...
                    </td>
                  </tr>
                )}
                {!loading && filteredUsers.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-6 text-sm text-white/60">
                      Nenhum usuário encontrado.
                    </td>
                  </tr>
                )}
                {!loading &&
                  filteredUsers.map((entry) => {
                    const userAccess = entry.attributes?.userAccess || defaultUserAccess;
                    const groupIds = resolveVehicleGroupIds(userAccess);
                    const groupVehicleIds = groupIds.flatMap(
                      (groupId) => vehicleGroupMap.get(String(groupId))?.attributes?.vehicleIds || [],
                    );
                    const vehicleCount =
                      userAccess.vehicleAccess?.mode === "all"
                        ? vehicles.length
                        : uniqueList([...(userAccess.vehicleAccess?.vehicleIds || []), ...groupVehicleIds]).length;
                    return (
                      <tr key={entry.id} className="hover:bg-white/5">
                        <td className="px-4 py-3 text-white">
                          <div className="font-semibold text-white">{entry.name}</div>
                          <div className="text-xs text-white/60">{roleLabels[entry.role] || entry.role || "—"}</div>
                        </td>
                        <td className="px-4 py-3 text-white/70">{entry.email}</td>
                        <td className="px-4 py-3 text-white/70">{entry.username || "—"}</td>
                        <td className="px-4 py-3 text-white/70">{vehicleCount}</td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => openUserDrawer(entry)}
                              className="inline-flex items-center gap-2 rounded-lg border border-white/10 px-3 py-1 text-xs text-white/80 hover:border-white/30"
                            >
                              <Pencil className="h-3.5 w-3.5" /> Editar
                            </button>
                            <button
                              type="button"
                              onClick={() => openDetailsDrawer(entry)}
                              className="inline-flex items-center gap-2 rounded-lg border border-white/10 px-3 py-1 text-xs text-white/80 hover:border-white/30"
                            >
                              <Eye className="h-3.5 w-3.5" /> Detalhes
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </DataTable>
          </div>
        </div>
      )}

      {activeTab === "vehicle-groups" && (
        <div className="space-y-4">
          <FilterBar
            left={
              <div className="relative min-w-[240px] flex-1">
                <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-white/50" />
                <input
                  placeholder="Buscar grupos de veículos"
                  value={groupQuery}
                  onChange={(event) => setGroupQuery(event.target.value)}
                  className="w-full rounded-xl border border-white/10 bg-black/30 py-2 pl-10 pr-4 text-sm text-white placeholder:text-white/50 focus:border-white/30 focus:outline-none"
                />
              </div>
            }
            right={
              <button
                type="button"
                onClick={() => openGroupDrawer()}
                className="rounded-xl bg-sky-500 px-4 py-2 text-sm font-medium text-black transition hover:bg-sky-400"
              >
                <span className="inline-flex items-center gap-2">
                  <Plus className="h-4 w-4" /> Novo grupo
                </span>
              </button>
            }
          />

          <div className="flex-1 overflow-hidden">
            <DataTable tableClassName="text-white/80">
              <thead className="bg-white/5 text-xs uppercase tracking-wide text-white/60">
                <tr>
                  <th className="px-4 py-3 text-left">Nome</th>
                  <th className="px-4 py-3 text-left">Descrição</th>
                  <th className="px-4 py-3 text-left">Veículos</th>
                  <th className="px-4 py-3 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/10">
                {filteredVehicleGroups.map((entry) => (
                  <tr key={entry.id} className="hover:bg-white/5">
                    <td className="px-4 py-3 text-white">{entry.name}</td>
                    <td className="px-4 py-3 text-white/70">{entry.description || "—"}</td>
                    <td className="px-4 py-3 text-white/70">{entry.attributes?.vehicleIds?.length || 0}</td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => openGroupDrawer(entry)}
                          className="rounded-lg border border-white/10 px-3 py-1 text-xs text-white/80 hover:border-white/30"
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
                {!filteredVehicleGroups.length && (
                  <tr>
                    <td colSpan={4} className="px-4 py-6 text-sm text-white/60">
                      Nenhum grupo de veículos encontrado.
                    </td>
                  </tr>
                )}
              </tbody>
            </DataTable>
          </div>
        </div>
      )}

      {activeTab === "permission-groups" && (
        <div className="space-y-4">
          <FilterBar
            left={
              <div className="relative min-w-[240px] flex-1">
                <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-white/50" />
                <input
                  placeholder="Buscar grupos de permissões"
                  value={permissionQuery}
                  onChange={(event) => setPermissionQuery(event.target.value)}
                  className="w-full rounded-xl border border-white/10 bg-black/30 py-2 pl-10 pr-4 text-sm text-white placeholder:text-white/50 focus:border-white/30 focus:outline-none"
                />
              </div>
            }
            right={
              <button
                type="button"
                onClick={() => openPermissionDrawer()}
                className="rounded-xl bg-sky-500 px-4 py-2 text-sm font-medium text-black transition hover:bg-sky-400"
              >
                <span className="inline-flex items-center gap-2">
                  <Plus className="h-4 w-4" /> Novo grupo
                </span>
              </button>
            }
          />

          <div className="flex-1 overflow-hidden">
            <DataTable tableClassName="text-white/80">
              <thead className="bg-white/5 text-xs uppercase tracking-wide text-white/60">
                <tr>
                  <th className="px-4 py-3 text-left">Nome</th>
                  <th className="px-4 py-3 text-left">Descrição</th>
                  <th className="px-4 py-3 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/10">
                {filteredPermissionGroups.map((entry) => (
                  <tr key={entry.id} className="hover:bg-white/5">
                    <td className="px-4 py-3 text-white">{entry.name}</td>
                    <td className="px-4 py-3 text-white/70">{entry.description || "—"}</td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => openPermissionDrawer(entry)}
                          className="rounded-lg border border-white/10 px-3 py-1 text-xs text-white/80 hover:border-white/30"
                        >
                          Editar
                        </button>
                        <button
                          type="button"
                          onClick={() => handlePermissionDelete(entry)}
                          className="rounded-lg border border-red-500/40 px-3 py-1 text-xs text-red-300 hover:bg-red-500/10"
                        >
                          Remover
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {!filteredPermissionGroups.length && (
                  <tr>
                    <td colSpan={3} className="px-4 py-6 text-sm text-white/60">
                      Nenhum grupo de permissões encontrado.
                    </td>
                  </tr>
                )}
              </tbody>
            </DataTable>
          </div>
        </div>
      )}

      <Drawer
        open={userDrawerOpen}
        onClose={() => setUserDrawerOpen(false)}
        title={editingId ? "Editar usuário" : "Novo usuário"}
        description="Defina dados gerais e regras de acesso do usuário."
      >
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {accessTabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveUserDrawerTab(tab.id)}
                className={`rounded-xl px-4 py-2 text-sm transition ${
                  activeUserDrawerTab === tab.id
                    ? "bg-sky-500 text-black"
                    : "bg-white/10 text-white hover:bg-white/15"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <form onSubmit={handleSubmit} className="space-y-6">
            {activeUserDrawerTab === "geral" && (
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
                  <span className="block text-xs uppercase tracking-wide text-white/60">Login</span>
                  <input
                    type="text"
                    value={form.username}
                    required
                    onChange={(event) => setForm((prev) => ({ ...prev, username: event.target.value }))}
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
                    value={form.attributes.permissionGroupId || ""}
                    onChange={(event) => updateFormAttributes("permissionGroupId", event.target.value)}
                    required
                    className="mt-1 w-full rounded-lg border border-border bg-layer px-3 py-2 text-sm"
                  >
                    <option value="">Selecionar perfil</option>
                    {permissionGroups.map((group) => (
                      <option key={group.id} value={group.id}>
                        {group.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            )}

            {activeUserDrawerTab === "acesso" && (
              <div className="space-y-6">
                <section className="rounded-xl border border-white/10 bg-white/5 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h3 className="text-sm font-semibold">Acesso por veículo</h3>
                      <p className="text-xs text-white/60">Defina a abrangência de veículos do operador.</p>
                    </div>
                    {form.attributes.userAccess.vehicleAccess.mode === "selected" && (
                      <button
                        type="button"
                        onClick={() =>
                          updateVehicleAccess({
                            mode: "selected",
                            vehicleIds: vehicles.map((vehicle) => vehicle.id),
                          })
                        }
                        className="rounded-xl border border-white/10 px-3 py-2 text-xs text-white/70 hover:border-white/30"
                      >
                        Selecionar todos
                      </button>
                    )}
                  </div>

                  <div className="mt-4 flex flex-col gap-3 text-xs text-white/70">
                    <label className="flex items-center gap-2">
                      <input
                        type="radio"
                        name="vehicleAccessMode"
                        checked={form.attributes.userAccess.vehicleAccess.mode === "all"}
                        onChange={() => updateVehicleAccess({ mode: "all", vehicleIds: [] })}
                      />
                      Todos os veículos
                    </label>
                    <label className="flex items-center gap-2">
                      <input
                        type="radio"
                        name="vehicleAccessMode"
                        checked={form.attributes.userAccess.vehicleAccess.mode === "selected"}
                        onChange={() => updateVehicleAccess({ mode: "selected" })}
                      />
                      Selecionar veículos específicos
                    </label>
                  </div>

                  {form.attributes.userAccess.vehicleAccess.mode === "selected" && (
                    <div className="mt-4 space-y-3">
                      <div className="grid gap-3 md:grid-cols-[1fr_auto]">
                        <AutocompleteSelect
                          label="Buscar veículo"
                          placeholder="Buscar por placa, nome ou modelo"
                          value={vehiclePickId}
                          onChange={(value) => setVehiclePickId(value)}
                          options={vehicleOptions}
                        />
                        <button
                          type="button"
                          onClick={() => {
                            if (!vehiclePickId) return;
                            const nextIds = uniqueList([
                              ...form.attributes.userAccess.vehicleAccess.vehicleIds,
                              vehiclePickId,
                            ]).map((id) => String(id));
                            updateVehicleAccess({ mode: "selected", vehicleIds: nextIds });
                            setVehiclePickId("");
                          }}
                          className="mt-6 rounded-xl bg-sky-500 px-4 py-2 text-sm font-medium text-black transition hover:bg-sky-400"
                        >
                          Adicionar
                        </button>
                      </div>

                      <div className="flex flex-wrap gap-2">
                        {form.attributes.userAccess.vehicleAccess.vehicleIds.map((id) => {
                          const vehicle = vehicleMap.get(String(id));
                          return (
                            <span
                              key={id}
                              className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/20 px-3 py-1 text-xs text-white/80"
                            >
                              {vehicle ? formatVehicleLabel(vehicle) : `Veículo ${id}`}
                              <button
                                type="button"
                                onClick={() => {
                                  const nextIds = form.attributes.userAccess.vehicleAccess.vehicleIds.filter(
                                    (value) => String(value) !== String(id),
                                  );
                                  updateVehicleAccess({ mode: "selected", vehicleIds: nextIds });
                                }}
                                className="text-white/60 hover:text-white"
                              >
                                <X className="h-3 w-3" />
                              </button>
                            </span>
                          );
                        })}
                        {!form.attributes.userAccess.vehicleAccess.vehicleIds.length && (
                          <span className="text-xs text-white/40">Nenhum veículo selecionado.</span>
                        )}
                      </div>
                    </div>
                  )}

                  <div className="mt-4 rounded-lg border border-white/10 bg-black/20 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="text-xs uppercase tracking-wide text-white/50">Grupos de veículos</p>
                        <p className="text-xs text-white/60">Selecione múltiplos grupos para compor o acesso.</p>
                      </div>
                    </div>
                    <div className="mt-3 grid gap-3 md:grid-cols-[1fr_auto]">
                      <AutocompleteSelect
                        label="Buscar grupo"
                        placeholder="Buscar grupo de veículos"
                        value={vehicleGroupPickId}
                        onChange={(value) => setVehicleGroupPickId(value)}
                        options={vehicleGroupOptions}
                      />
                      <button
                        type="button"
                        onClick={() => handleVehicleGroupAdd(vehicleGroupPickId)}
                        className="mt-6 rounded-xl bg-sky-500 px-4 py-2 text-sm font-medium text-black transition hover:bg-sky-400"
                      >
                        Adicionar
                      </button>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {selectedVehicleGroupIds.map((id) => {
                        const group = vehicleGroupMap.get(String(id));
                        return (
                          <span
                            key={id}
                            className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/20 px-3 py-1 text-xs text-white/80"
                          >
                            {group?.name || `Grupo ${id}`}
                            <button
                              type="button"
                              onClick={() => handleVehicleGroupRemove(id)}
                              className="text-white/60 hover:text-white"
                            >
                              <X className="h-3 w-3" />
                            </button>
                          </span>
                        );
                      })}
                      {!selectedVehicleGroupIds.length && (
                        <span className="text-xs text-white/40">Nenhum grupo selecionado.</span>
                      )}
                    </div>
                    <p className="mt-3 text-xs text-white/60">
                      Total de veículos resultantes: <span className="text-white">{selectedVehicleCount}</span>
                    </p>
                  </div>
                </section>

                <section className="rounded-xl border border-white/10 bg-white/5 p-4">
                  <div>
                    <h3 className="text-sm font-semibold">Dias e horários permitidos</h3>
                    <p className="text-xs text-white/60">Sem dias marcados = sem restrições.</p>
                  </div>
                  <div className="mt-3 grid grid-cols-4 gap-2 text-xs">
                    {daysOfWeek.map((label, index) => {
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
                </section>

                <section className="rounded-xl border border-white/10 bg-white/5 p-4">
                  <div>
                    <h3 className="text-sm font-semibold">Restrição por IP</h3>
                    <p className="text-xs text-white/60">Defina limites de acesso por IP.</p>
                  </div>
                  <div className="mt-3 space-y-2 text-xs text-white/70">
                    <label className="flex items-center gap-2">
                      <input
                        type="radio"
                        name="ipRestrictionMode"
                        checked={form.attributes.userAccess.ipRestriction.mode === "all"}
                        onChange={() => updateUserAccess("ipRestriction", { mode: "all", ip: "" })}
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
                      <div className="space-y-1">
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
                          className="w-full rounded-lg border border-border bg-layer px-3 py-2 text-sm"
                        />
                        <p className="text-[11px] text-white/50">Acesso permitido somente deste IP.</p>
                        {form.attributes.userAccess.ipRestriction.ip &&
                          !isValidIpAddress(form.attributes.userAccess.ipRestriction.ip) && (
                            <p className="text-[11px] text-red-300">Informe um IPv4 ou IPv6 válido.</p>
                          )}
                      </div>
                    )}
                  </div>
                </section>
              </div>
            )}

            <div className="flex flex-wrap items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setUserDrawerOpen(false)}
                className="rounded-xl border border-border px-4 py-2 text-sm text-white/70 hover:bg-white/10"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={saving}
                className="rounded-xl bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90 disabled:opacity-60"
              >
                {saving ? "Salvando…" : "Salvar usuário"}
              </button>
            </div>
          </form>
        </div>
      </Drawer>

      <Drawer
        open={detailsDrawerOpen}
        onClose={() => setDetailsDrawerOpen(false)}
        title={`Detalhes - ${detailsUser?.name || "Usuário"}`}
        description="Resumo de acesso, permissões e veículos vinculados."
      >
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {detailsTabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setDetailsDrawerTab(tab.id)}
                className={`rounded-xl px-4 py-2 text-sm transition ${
                  detailsDrawerTab === tab.id ? "bg-sky-500 text-black" : "bg-white/10 text-white hover:bg-white/15"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {detailsDrawerTab === "geral" && detailsUser && (
            <div className="space-y-4">
              <div className="grid gap-3 rounded-xl border border-white/10 bg-white/5 p-4 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-xs uppercase tracking-wide text-white/50">Quantidade de veículos</span>
                  <span className="text-lg font-semibold text-white">{detailsVehicles.length}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs uppercase tracking-wide text-white/50">Perfil</span>
                  <span className="text-sm text-white/80">
                    {permissionGroups.find((group) => group.id === detailsUser.attributes?.permissionGroupId)?.name || "—"}
                  </span>
                </div>
                <div>
                  <span className="text-xs uppercase tracking-wide text-white/50">Regras de acesso</span>
                  <div className="mt-2 space-y-1 text-xs text-white/70">
                    <p>
                      Dias: {detailsUser.attributes?.userAccess?.schedule?.days?.length
                        ? detailsUser.attributes.userAccess.schedule.days
                            .map((day) => daysOfWeek[day])
                            .join(", ")
                        : "Sem restrição"}
                    </p>
                    <p>
                      Horário: {detailsUser.attributes?.userAccess?.schedule?.start || "—"} às {detailsUser.attributes?.userAccess?.schedule?.end || "—"}
                    </p>
                    <p>
                      IP: {detailsUser.attributes?.userAccess?.ipRestriction?.mode === "single"
                        ? detailsUser.attributes.userAccess.ipRestriction.ip || "—"
                        : "Liberado para todos"}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {detailsDrawerTab === "veiculos" && (
            <div className="space-y-4">
              <div className="space-y-2">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-white/50" />
                  <input
                    placeholder="Buscar veículo"
                    value={detailsSearch}
                    onChange={(event) => setDetailsSearch(event.target.value)}
                    className="w-full rounded-xl border border-white/10 bg-black/30 py-2 pl-10 pr-4 text-sm text-white placeholder:text-white/50 focus:border-white/30 focus:outline-none"
                  />
                </div>
                {!!detailsVehicleGroups.length && (
                  <div className="flex flex-wrap items-center gap-2 text-xs text-white/60">
                    <span className="uppercase tracking-wide text-white/50">Grupos vinculados:</span>
                    {detailsVehicleGroups.map((group) => (
                      <span
                        key={group.id}
                        className="rounded-full border border-white/10 bg-black/20 px-3 py-1 text-xs text-white/80"
                      >
                        {group.name}
                      </span>
                    ))}
                  </div>
                )}
                {detailsUser?.attributes?.userAccess?.vehicleAccess?.mode === "all" && (
                  <p className="text-xs text-emerald-200">Acesso total habilitado.</p>
                )}
              </div>
              <DataTable tableClassName="text-white/80">
                <thead className="bg-white/5 text-xs uppercase tracking-wide text-white/60">
                  <tr>
                    <th className="px-4 py-3 text-left">Veículo</th>
                    <th className="px-4 py-3 text-left">Placa</th>
                    <th className="px-4 py-3 text-left">Modelo</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/10">
                  {filteredDetailsVehicles.map((vehicle) => (
                    <tr key={vehicle.id} className="hover:bg-white/5">
                      <td className="px-4 py-3 text-white">{vehicle.name || vehicle.model || "—"}</td>
                      <td className="px-4 py-3 text-white/70">{vehicle.plate || "—"}</td>
                      <td className="px-4 py-3 text-white/70">{vehicle.model || "—"}</td>
                    </tr>
                  ))}
                  {!filteredDetailsVehicles.length && (
                    <tr>
                      <td colSpan={3} className="px-4 py-6 text-sm text-white/60">
                        Nenhum veículo disponível para este usuário.
                      </td>
                    </tr>
                  )}
                </tbody>
              </DataTable>
            </div>
          )}
        </div>
      </Drawer>

      <Drawer
        open={groupDrawerOpen}
        onClose={() => setGroupDrawerOpen(false)}
        title={editingGroup ? "Editar grupo de veículos" : "Novo grupo de veículos"}
        description="Selecione os veículos que compõem o grupo."
        eyebrow="Grupos de veículos"
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

          <div className="rounded-xl border border-white/10 bg-white/5 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-wide text-white/50">Veículos</p>
                <p className="text-xs text-white/60">Adicione veículos específicos ao grupo.</p>
              </div>
              <button
                type="button"
                onClick={() =>
                  setGroupForm((prev) => ({
                    ...prev,
                    vehicleIds: vehicles.map((vehicle) => vehicle.id),
                  }))
                }
                className="rounded-xl border border-white/10 px-3 py-2 text-xs text-white/70 hover:border-white/30"
              >
                Adicionar todos
              </button>
            </div>
            <div className="mt-3 grid gap-3 md:grid-cols-[1fr_auto]">
              <AutocompleteSelect
                label="Buscar veículo"
                placeholder="Buscar por placa, nome ou modelo"
                value={groupVehiclePickId}
                onChange={(value) => setGroupVehiclePickId(value)}
                options={vehicleOptions}
              />
              <button
                type="button"
                onClick={() => {
                  if (!groupVehiclePickId) return;
                  setGroupForm((prev) => ({
                    ...prev,
                    vehicleIds: uniqueList([...prev.vehicleIds, groupVehiclePickId]).map((id) => String(id)),
                  }));
                  setGroupVehiclePickId("");
                }}
                className="mt-6 rounded-xl bg-sky-500 px-4 py-2 text-sm font-medium text-black transition hover:bg-sky-400"
              >
                Adicionar
              </button>
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              {groupForm.vehicleIds.map((id) => {
                const vehicle = vehicleMap.get(String(id));
                return (
                  <span
                    key={id}
                    className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/20 px-3 py-1 text-xs text-white/80"
                  >
                    {vehicle ? formatVehicleLabel(vehicle) : `Veículo ${id}`}
                    <button
                      type="button"
                      onClick={() =>
                        setGroupForm((prev) => ({
                          ...prev,
                          vehicleIds: prev.vehicleIds.filter((value) => String(value) !== String(id)),
                        }))
                      }
                      className="text-white/60 hover:text-white"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                );
              })}
              {!groupForm.vehicleIds.length && <span className="text-xs text-white/40">Nenhum veículo selecionado.</span>}
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

      <Drawer
        open={permissionDrawerOpen}
        onClose={() => setPermissionDrawerOpen(false)}
        title={editingPermissionGroup ? "Editar grupo de permissões" : "Novo grupo de permissões"}
        description="Defina níveis de acesso por menu, página e submenus."
        eyebrow="Grupos de permissões"
      >
        <form onSubmit={handlePermissionSubmit} className="space-y-4">
          <label className="text-sm">
            <span className="block text-xs uppercase tracking-wide text-white/60">Nome do grupo</span>
            <input
              type="text"
              value={permissionForm.name}
              required
              onChange={(event) => setPermissionForm((prev) => ({ ...prev, name: event.target.value }))}
              className="mt-1 w-full rounded-lg border border-border bg-layer px-3 py-2 text-sm"
            />
          </label>
          <label className="text-sm">
            <span className="block text-xs uppercase tracking-wide text-white/60">Descrição</span>
            <input
              type="text"
              value={permissionForm.description}
              onChange={(event) => setPermissionForm((prev) => ({ ...prev, description: event.target.value }))}
              className="mt-1 w-full rounded-lg border border-border bg-layer px-3 py-2 text-sm"
            />
          </label>

          <div className="space-y-4">
            {permissionMatrix.map((menu) => {
              const isOpen = openPermissionMenus[menu.menuKey] !== false;
              return (
                <div key={menu.menuKey} className="rounded-xl border border-white/10 bg-white/5 p-4">
                  <button
                    type="button"
                    onClick={() =>
                      setOpenPermissionMenus((prev) => ({
                        ...prev,
                        [menu.menuKey]: prev[menu.menuKey] === false,
                      }))
                    }
                    className="flex w-full items-center justify-between text-left"
                  >
                    <div>
                      <p className="text-sm font-semibold text-white">{menu.label}</p>
                      <p className="text-xs text-white/60">Permissões por página e submenu.</p>
                    </div>
                    <span className="text-white/60">{isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}</span>
                  </button>

                  {isOpen && (
                    <div className="mt-4 space-y-4">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <span className="text-xs uppercase tracking-wide text-white/50">Aplicar a todos</span>
                        <div className="flex items-center gap-2">
                          <select
                            value={bulkPermissionLevels[menu.menuKey] || "none"}
                            onChange={(event) =>
                              setBulkPermissionLevels((prev) => ({
                                ...prev,
                                [menu.menuKey]: event.target.value,
                              }))
                            }
                            className="rounded-lg border border-border bg-layer px-3 py-2 text-xs"
                          >
                            {permissionLevels.map((level) => (
                              <option key={level.value} value={level.value}>
                                {level.label}
                              </option>
                            ))}
                          </select>
                          <button
                            type="button"
                            onClick={() => handleApplyMenuLevel(menu.menuKey)}
                            className="rounded-lg border border-white/10 px-3 py-2 text-xs text-white/70 hover:border-white/30"
                          >
                            Aplicar
                          </button>
                        </div>
                      </div>

                      <div className="space-y-4">
                        {menu.pages.map((page) => (
                          <div key={page.pageKey} className="rounded-lg border border-white/10 bg-black/20 p-3">
                            <div className="flex flex-wrap items-center justify-between gap-3">
                              <div>
                                <p className="text-xs uppercase tracking-wide text-white/60">{page.label}</p>
                                {page.subpages?.length && (
                                  <p className="text-xs text-white/50">Configure submenus individualmente.</p>
                                )}
                              </div>
                              <select
                                value={getPermissionValue(menu.menuKey, page.pageKey)}
                                onChange={(event) =>
                                  handlePermissionUpdate(menu.menuKey, page.pageKey, event.target.value)
                                }
                                className="min-w-[220px] rounded-lg border border-border bg-layer px-3 py-2 text-xs"
                              >
                                {permissionLevels.map((level) => (
                                  <option key={level.value} value={level.value}>
                                    {level.label}
                                  </option>
                                ))}
                              </select>
                            </div>
                            {page.subpages?.length && (
                              <div className="mt-3 space-y-2">
                                {page.subpages.map((subpage) => (
                                  <div
                                    key={subpage.subKey}
                                    className="flex flex-wrap items-center justify-between gap-3 border-t border-white/5 pt-2"
                                  >
                                    <span className="text-xs text-white/70">{subpage.label}</span>
                                    <select
                                      value={getPermissionValue(menu.menuKey, page.pageKey, subpage.subKey)}
                                      onChange={(event) =>
                                        handlePermissionUpdate(menu.menuKey, page.pageKey, event.target.value, subpage.subKey)
                                      }
                                      className="min-w-[200px] rounded-lg border border-border bg-layer px-3 py-2 text-xs"
                                    >
                                      {permissionLevels.map((level) => (
                                        <option key={level.value} value={level.value}>
                                          {level.label}
                                        </option>
                                      ))}
                                    </select>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={() => setPermissionDrawerOpen(false)}
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
