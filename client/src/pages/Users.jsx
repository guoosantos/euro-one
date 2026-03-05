import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Eye, Pencil, Plus, RefreshCw, Search, X } from "lucide-react";

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
import { resolveCanManageUsers, usePermissionGate, usePermissions } from "../lib/permissions/permission-gate";
import { isAdminGeneralClientName } from "../lib/admin-general";
import useAdminGeneralAccess from "../lib/hooks/useAdminGeneralAccess";
import PermissionTreeEditor from "../components/permissions/PermissionTreeEditor";
import PageToast from "../components/ui/PageToast.jsx";
import {
  buildPermissionEditorState,
  normalizePermissionPayload,
} from "../lib/permissions/permission-utils";
import { useConfirmDialog } from "../components/ui/ConfirmDialogProvider.jsx";
import usePageToast from "../lib/hooks/usePageToast.js";
import { confirmDeleteAction } from "../lib/confirm-delete.js";

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

const VEHICLE_GROUP_TYPES = {
  BY_CLIENT: "BY_CLIENT",
  CUSTOM: "CUSTOM",
};

function resolveGroupType(group) {
  const raw = group?.attributes?.groupType || group?.attributes?.type || VEHICLE_GROUP_TYPES.CUSTOM;
  return String(raw).trim().toUpperCase() === VEHICLE_GROUP_TYPES.BY_CLIENT
    ? VEHICLE_GROUP_TYPES.BY_CLIENT
    : VEHICLE_GROUP_TYPES.CUSTOM;
}

function resolveGroupSourceClientId(group) {
  return group?.attributes?.sourceClientId || group?.attributes?.clientId || null;
}

function resolveGroupTypeLabel(groupType) {
  return groupType === VEHICLE_GROUP_TYPES.BY_CLIENT ? "Por cliente" : "Avulso";
}

const roleLabels = {
  admin: "Administrador",
  tenant_admin: "Administrador do cliente",
  manager: "Gestor",
  user: "Operador",
  driver: "Motorista",
  viewer: "Visualizador",
};

const tabs = [
  { id: "users", label: "Usuários", permission: { menuKey: "admin", pageKey: "users", subKey: "users-list" } },
  {
    id: "vehicle-groups",
    label: "Grupos de veículos",
    permission: { menuKey: "admin", pageKey: "users", subKey: "users-vehicle-groups" },
  },
  {
    id: "transfer-config",
    label: "Transferir configuração",
    permission: { menuKey: "admin", pageKey: "users", subKey: "users-list" },
  },
  {
    id: "permission-groups",
    label: "Grupos de permissões",
    permission: { menuKey: "admin", pageKey: "users", subKey: "users-permission-groups" },
  },
];

const accessTabs = [
  { id: "geral", label: "Geral" },
  { id: "acesso", label: "Acesso" },
];

const detailsTabs = [
  { id: "geral", label: "Geral" },
  { id: "veiculos", label: "Veículos" },
  { id: "historico", label: "Histórico" },
];

const daysOfWeek = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

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

function resolveVehicleGroupIds(userAccess) {
  const groupIds = Array.isArray(userAccess?.vehicleGroupIds)
    ? userAccess.vehicleGroupIds
    : userAccess?.vehicleGroupId
      ? [userAccess.vehicleGroupId]
      : [];
  return uniqueList(groupIds.filter(Boolean));
}

export default function Users() {
  const { role, tenants, tenantId, tenant, user, mirrorOwners, isMirrorReceiver, homeClient, permissionContext } =
    useTenant();
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
  const [groupForm, setGroupForm] = useState({
    name: "",
    description: "",
    vehicleIds: [],
    groupType: VEHICLE_GROUP_TYPES.CUSTOM,
    sourceClientId: "",
  });
  const [permissionDrawerOpen, setPermissionDrawerOpen] = useState(false);
  const [editingPermissionGroup, setEditingPermissionGroup] = useState(null);
  const [permissionForm, setPermissionForm] = useState({ name: "", description: "", permissions: {} });
  const [permissionReadOnly, setPermissionReadOnly] = useState(false);
  const [activeUserDrawerTab, setActiveUserDrawerTab] = useState("geral");
  const [userDrawerOpen, setUserDrawerOpen] = useState(false);
  const [detailsDrawerOpen, setDetailsDrawerOpen] = useState(false);
  const [detailsDrawerTab, setDetailsDrawerTab] = useState("geral");
  const [detailsUser, setDetailsUser] = useState(null);
  const [detailsUserId, setDetailsUserId] = useState(null);
  const [query, setQuery] = useState("");
  const [groupQuery, setGroupQuery] = useState("");
  const [permissionQuery, setPermissionQuery] = useState("");
  const [vehiclePickId, setVehiclePickId] = useState("");
  const [transferFromUserId, setTransferFromUserId] = useState("");
  const [transferToUserId, setTransferToUserId] = useState("");
  const [transferMode, setTransferMode] = useState("OVERWRITE");
  const [transferLoading, setTransferLoading] = useState(false);
  const { confirmDelete } = useConfirmDialog();
  const [vehicleGroupPickId, setVehicleGroupPickId] = useState("");
  const [groupVehiclePickId, setGroupVehiclePickId] = useState("");
  const [detailsSearch, setDetailsSearch] = useState("");
  const [historyEvents, setHistoryEvents] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState(null);
  const [historyFilter, setHistoryFilter] = useState("all");
  const [historyReloadKey, setHistoryReloadKey] = useState(0);
  const { isAdminGeneral } = useAdminGeneralAccess();
  const { toast, showToast } = usePageToast();
  const selfRequestOptions = useMemo(
    () => ({
      skipMirrorClient: true,
      headers: { "X-Mirror-Mode": "self" },
    }),
    [],
  );
  const handlePermissionFormChange = useCallback(
    (nextPermissions) => setPermissionForm((prev) => ({ ...prev, permissions: nextPermissions })),
    [],
  );

  const historyCategories = useMemo(
    () => [
      { value: "all", label: "Todos" },
      { value: "access", label: "Acessos" },
      { value: "command", label: "Comandos" },
      { value: "report", label: "Relatórios" },
      { value: "alert-handling", label: "Tratativas" },
      { value: "crud", label: "Cadastros" },
      { value: "system", label: "Sistema" },
    ],
    [],
  );
  const usersPermission = usePermissionGate({ menuKey: "admin", pageKey: "users" }) || {
    level: "NO_ACCESS",
    hasAccess: false,
    canShow: false,
    canView: false,
    canRead: false,
    isFull: false,
    loading: true,
  };
  const usersCreatePermission = usePermissionGate({ menuKey: "admin", pageKey: "users", subKey: "users-create" });
  const usersEditPermission = usePermissionGate({ menuKey: "admin", pageKey: "users", subKey: "users-edit" });
  const usersDeletePermission = usePermissionGate({ menuKey: "admin", pageKey: "users", subKey: "users-delete" });
  const canManageUsers = resolveCanManageUsers({ role, permission: usersPermission });
  const baseUserAccess = useMemo(
    () => ({
      ...defaultUserAccess,
      vehicleAccess: {
        ...defaultUserAccess.vehicleAccess,
        mode: isMirrorReceiver ? "selected" : defaultUserAccess.vehicleAccess.mode,
      },
    }),
    [isMirrorReceiver],
  );
  const buildDefaultUserForm = useCallback(
    (clientId) => ({
      ...defaultUserForm,
      clientId: clientId || "",
      attributes: {
        ...defaultUserForm.attributes,
        userAccess: baseUserAccess,
        permissionGroupId: "",
      },
    }),
    [baseUserAccess],
  );

  const managedTenants = useMemo(() => {
    if (role === "admin") {
      let list = Array.isArray(tenants) ? [...tenants] : [];
      if (homeClient && !list.some((entry) => String(entry.id) === String(homeClient.id))) {
        if (isAdminGeneralClientName(homeClient.name)) {
          list = [homeClient, ...list];
        } else {
          list = [...list, homeClient];
        }
      }
      return list;
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
  }, [homeClient, role, tenant, tenants, user]);

  const [selectedTenantId, setSelectedTenantId] = useState(
    tenantId || managedTenants[0]?.id || "",
  );

  const selectedTenant = useMemo(
    () =>
      managedTenants.find((entry) => String(entry.id) === String(selectedTenantId))
      || tenant
      || null,
    [managedTenants, selectedTenantId, tenant],
  );
  const isAdminGeneralTenant = isAdminGeneralClientName(selectedTenant?.name);

  const allowedRoles = role === "admin" ? Object.keys(roleLabels) : ["user", "driver", "viewer"];
  const isManager = role === "manager";
  const isTenantAdmin = role === "tenant_admin";
  const canCreateUsers = usersCreatePermission.isFull;
  const canEditUsers = usersEditPermission.isFull;
  const canDeleteUsers = usersDeletePermission.isFull;

  const { groups, reload: reloadGroups, createGroup, updateGroup, deleteGroup } = useGroups({
    params: selectedTenantId ? { clientId: selectedTenantId } : {},
    requestOptions: selfRequestOptions,
  });
  const mirrorClientOptions = useMemo(() => {
    if (!isMirrorReceiver) return [];
    const list = Array.isArray(mirrorOwners) ? mirrorOwners : [];
    return list.map((client) => ({
      value: String(client.id),
      label: client.name,
      description: client.attributes?.segment || client.attributes?.clientType || "",
      searchText: [client.name, client.attributes?.clientType, client.attributes?.segment].filter(Boolean).join(" "),
    }));
  }, [isMirrorReceiver, mirrorOwners]);

  const clientNameById = useMemo(() => {
    const map = new Map();
    const push = (client) => {
      if (!client?.id) return;
      const label = client.name || client.attributes?.companyName || client.attributes?.clientName || client.id;
      map.set(String(client.id), label);
    };
    (Array.isArray(managedTenants) ? managedTenants : []).forEach(push);
    (Array.isArray(mirrorOwners) ? mirrorOwners : []).forEach(push);
    if (homeClient) push(homeClient);
    if (tenant) push(tenant);
    return map;
  }, [homeClient, managedTenants, mirrorOwners, tenant]);
  const { getPermission } = usePermissions();
  const availableTabs = useMemo(
    () => tabs.filter((tab) => getPermission(tab.permission).canShow),
    [getPermission],
  );
  const activeTabPermission = useMemo(() => {
    const tab = tabs.find((entry) => entry.id === activeTab);
    return tab ? getPermission(tab.permission) : null;
  }, [activeTab, getPermission]);

  const vehicleGroups = useMemo(
    () => groups.filter((entry) => entry.attributes?.kind === "VEHICLE_GROUP"),
    [groups],
  );
  const permissionGroups = useMemo(
    () => groups.filter((entry) => entry.attributes?.kind === "PERMISSION_GROUP"),
    [groups],
  );
  const permissionGroupLabelById = useMemo(() => {
    const map = new Map();
    permissionGroups.forEach((group) => {
      if (!group?.id) return;
      const suffix = group.attributes?.scope === "global" ? " (Global)" : "";
      map.set(String(group.id), `${group.name}${suffix}`);
    });
    return map;
  }, [permissionGroups]);
  const resolveUserProfileLabel = useCallback(
    (entry) => {
      if (!entry) return "—";
      const groupId = entry.attributes?.permissionGroupId;
      if (groupId && permissionGroupLabelById.has(String(groupId))) {
        return permissionGroupLabelById.get(String(groupId));
      }
      if (entry.role === "admin") {
        return "Administrador (Global)";
      }
      return roleLabels[entry.role] || entry.role || "—";
    },
    [permissionGroupLabelById],
  );
  const scopedPermissionContext = useMemo(() => {
    if (isAdminGeneral) return null;
    if (permissionContext?.isFull) return null;
    return permissionContext?.permissions || {};
  }, [isAdminGeneral, permissionContext]);

  useEffect(() => {
    if (!selectedTenantId && managedTenants.length) {
      setSelectedTenantId(managedTenants[0].id);
    }
  }, [managedTenants, selectedTenantId]);

  useEffect(() => {
    if (!availableTabs.length) return;
    if (availableTabs.some((tab) => tab.id === activeTab)) return;
    setActiveTab(availableTabs[0].id);
  }, [activeTab, availableTabs]);

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
      const params = role === "admin" || isManager || isTenantAdmin ? { clientId } : {};
      const response = await api.get(API_ROUTES.users, { params, ...selfRequestOptions });
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
    if (editingId) {
      if (!canEditUsers) return;
    } else if (!canCreateUsers) {
      return;
    }
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
        await api.put(`/users/${editingId}`, payload, selfRequestOptions);
        setMessage("Usuário atualizado");
      } else {
        await api.post(API_ROUTES.users, payload, selfRequestOptions);
        setMessage("Usuário criado");
      }
      setForm(buildDefaultUserForm(selectedTenantId));
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
            vehicleAccess: userAccess.vehicleAccess || baseUserAccess.vehicleAccess,
            vehicleGroupIds: resolveVehicleGroupIds(userAccess),
            schedule: userAccess.schedule || baseUserAccess.schedule,
            ipRestriction: userAccess.ipRestriction || baseUserAccess.ipRestriction,
          },
          permissionGroupId: entry.attributes?.permissionGroupId || "",
        },
      });
    } else {
      setEditingId(null);
      setForm(buildDefaultUserForm(selectedTenantId));
    }
    setUserDrawerOpen(true);
  }

  function openDetailsDrawer(entry) {
    setDetailsUser(entry);
    setDetailsUserId(entry?.id || null);
    setDetailsDrawerTab("geral");
    setDetailsSearch("");
    setDetailsDrawerOpen(true);
  }

  useEffect(() => {
    if (!detailsUserId) return;
    const updated = users.find((entry) => String(entry.id) === String(detailsUserId));
    if (updated && updated !== detailsUser) {
      setDetailsUser(updated);
    }
  }, [detailsUser, detailsUserId, users]);

  useEffect(() => {
    if (detailsUserId && detailsDrawerOpen) return;
    setHistoryEvents([]);
    setHistoryFilter("all");
    setHistoryError(null);
  }, [detailsDrawerOpen, detailsUserId]);

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
    const groupType = resolveGroupType(group);
    setGroupForm({
      name: group?.name || "",
      description: group?.description || "",
      vehicleIds: groupType === VEHICLE_GROUP_TYPES.CUSTOM ? group?.attributes?.vehicleIds || [] : [],
      groupType,
      sourceClientId: groupType === VEHICLE_GROUP_TYPES.BY_CLIENT ? (resolveGroupSourceClientId(group) || "") : "",
    });
    setGroupVehiclePickId("");
    setGroupDrawerOpen(true);
  }

  async function handleGroupSubmit(event) {
    event.preventDefault();
    try {
      if (!activeTabPermission?.isFull) {
        setError(new Error("Permissão insuficiente para salvar grupos."));
        return;
      }
      if (groupForm.groupType === VEHICLE_GROUP_TYPES.BY_CLIENT && !groupForm.sourceClientId) {
        setError(new Error("Selecione um cliente espelhado para este grupo."));
        return;
      }
      const payload = {
        name: groupForm.name,
        description: groupForm.description,
        clientId: selectedTenantId,
        attributes: {
          kind: "VEHICLE_GROUP",
          groupType: groupForm.groupType,
          sourceClientId:
            groupForm.groupType === VEHICLE_GROUP_TYPES.BY_CLIENT ? groupForm.sourceClientId || null : null,
          vehicleIds: groupForm.groupType === VEHICLE_GROUP_TYPES.CUSTOM ? groupForm.vehicleIds : [],
        },
      };
      if (editingGroup) {
        await updateGroup(editingGroup.id, payload);
      } else {
        await createGroup(payload);
      }
      setGroupDrawerOpen(false);
      setEditingGroup(null);
      setGroupForm({
        name: "",
        description: "",
        vehicleIds: [],
        groupType: VEHICLE_GROUP_TYPES.CUSTOM,
        sourceClientId: "",
      });
    } catch (groupError) {
      console.error("Falha ao salvar grupo", groupError);
      setError(groupError);
    }
  }

  async function handleGroupDelete(entry) {
    await confirmDelete({
      title: "Excluir grupo",
      message: `Tem certeza que deseja excluir o grupo ${entry.name}? Essa ação não pode ser desfeita.`,
      confirmLabel: "Excluir",
      onConfirm: async () => {
        try {
          await deleteGroup(entry.id);
          showToast("Excluído com sucesso.");
        } catch (requestError) {
          showToast("Falha ao excluir.", "error");
          throw requestError;
        }
      },
    });
  }

  function openPermissionDrawer(group = null, { readOnly = false } = {}) {
    const isGlobal = group?.attributes?.scope === "global";
    const forcedReadOnly = readOnly || !activeTabPermission?.isFull || (isGlobal && !isAdminGeneralTenant);
    setEditingPermissionGroup(group);
    setPermissionReadOnly(Boolean(forcedReadOnly));
    setPermissionForm({
      name: group?.name || "",
      description: group?.description || "",
      permissions: buildPermissionEditorState(group?.attributes?.permissions || {}, permissionMatrix),
    });
    setPermissionDrawerOpen(true);
  }

  async function handlePermissionSubmit(event) {
    event.preventDefault();
    try {
      if (permissionReadOnly || !activeTabPermission?.isFull) {
        setError(new Error("Permissão insuficiente para salvar grupos de permissões."));
        return;
      }
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
      setPermissionReadOnly(false);
      setPermissionForm({ name: "", description: "", permissions: {} });
    } catch (permissionError) {
      console.error("Falha ao salvar grupo de permissões", permissionError);
      setError(permissionError);
    }
  }

  async function handlePermissionDelete(entry) {
    if (entry?.attributes?.scope === "global" && !isAdminGeneralTenant) {
      setMessage("Perfis globais só podem ser removidos no ADMIN GERAL.");
      return;
    }
    await confirmDelete({
      title: "Excluir grupo de permissões",
      message: `Tem certeza que deseja excluir o grupo de permissões ${entry.name}? Essa ação não pode ser desfeita.`,
      confirmLabel: "Excluir",
      onConfirm: async () => {
        try {
          await deleteGroup(entry.id);
          showToast("Excluído com sucesso.");
        } catch (requestError) {
          showToast("Falha ao excluir.", "error");
          throw requestError;
        }
      },
    });
  }

  async function handleTransferSubmit(event) {
    event.preventDefault();
    if (!transferFromUserId || !transferToUserId) {
      setError(new Error("Selecione usuário origem e destino."));
      return;
    }
    if (String(transferFromUserId) === String(transferToUserId)) {
      setError(new Error("Usuário origem e destino devem ser diferentes."));
      return;
    }
    setTransferLoading(true);
    setError(null);
    try {
      await api.post(API_ROUTES.usersTransferConfig(transferToUserId), {
        fromUserId: transferFromUserId,
        mode: transferMode,
      }, selfRequestOptions);
      showToast("Configuração transferida com sucesso.");
    } catch (transferError) {
      console.error("Falha ao transferir configuração", transferError);
      setError(transferError instanceof Error ? transferError : new Error("Falha ao transferir configuração"));
    } finally {
      setTransferLoading(false);
    }
  }

  async function handleUserDelete(entry) {
    if (!entry?.id) return;
    if (!canDeleteUsers) return;
    await confirmDeleteAction({
      confirmDelete,
      title: "Excluir usuário",
      message: `Tem certeza que deseja excluir o usuário ${entry.name}? Essa ação não pode ser desfeita.`,
      confirmLabel: "Excluir",
      onDelete: async () => {
        try {
          await api.delete(`${API_ROUTES.users}/${entry.id}`, selfRequestOptions);
          setUsers((prev) => prev.filter((item) => String(item.id) !== String(entry.id)));
          if (detailsUserId && String(detailsUserId) === String(entry.id)) {
            setDetailsDrawerOpen(false);
            setDetailsUserId(null);
            setDetailsUser(null);
          }
          showToast("Excluído com sucesso.");
        } catch (requestError) {
          showToast("Falha ao excluir.", "error");
          throw requestError;
        }
      },
    });
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

  const groupVehicleIdsMap = useMemo(() => {
    const map = new Map();
    vehicleGroups.forEach((group) => {
      const type = resolveGroupType(group);
      let ids = [];
      if (type === VEHICLE_GROUP_TYPES.BY_CLIENT) {
        const sourceClientId = resolveGroupSourceClientId(group);
        if (sourceClientId) {
          ids = vehicles
            .filter((vehicle) => String(vehicle.clientId) === String(sourceClientId))
            .map((vehicle) => String(vehicle.id));
        }
      } else {
        ids = Array.isArray(group?.attributes?.vehicleIds)
          ? group.attributes.vehicleIds.map((id) => String(id))
          : [];
      }
      map.set(String(group.id), ids);
    });
    return map;
  }, [vehicleGroups, vehicles]);

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
      vehicleGroups.map((group) => {
        const type = resolveGroupType(group);
        const vehicleCount = (groupVehicleIdsMap.get(String(group.id)) || []).length;
        const sourceClientId = resolveGroupSourceClientId(group);
        const sourceClientLabel = sourceClientId ? clientNameById.get(String(sourceClientId)) || sourceClientId : null;
        const description =
          type === VEHICLE_GROUP_TYPES.BY_CLIENT
            ? `${sourceClientLabel || "Cliente espelhado"} · ${vehicleCount} veículos`
            : `${vehicleCount} veículos`;
        return {
          value: group.id,
          label: group.name,
          description,
        };
      }),
    [clientNameById, groupVehicleIdsMap, vehicleGroups],
  );

  const selectedVehicleGroupIds = useMemo(
    () => resolveVehicleGroupIds(form.attributes.userAccess),
    [form.attributes.userAccess],
  );

  const selectedGroupVehicleIds = useMemo(() => {
    const ids = new Set();
    selectedVehicleGroupIds.forEach((groupId) => {
      const groupVehicles = groupVehicleIdsMap.get(String(groupId)) || [];
      groupVehicles.forEach((id) => ids.add(String(id)));
    });
    return Array.from(ids);
  }, [groupVehicleIdsMap, selectedVehicleGroupIds]);

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

  const userSelectOptions = useMemo(
    () =>
      users.map((entry) => ({
        value: String(entry.id),
        label: entry.name || entry.email || entry.username || String(entry.id),
        description: entry.email || entry.username || "",
      })),
    [users],
  );

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
      const typeLabel = resolveGroupTypeLabel(resolveGroupType(entry));
      const sourceClientId = resolveGroupSourceClientId(entry);
      const sourceClientLabel = sourceClientId ? clientNameById.get(String(sourceClientId)) || sourceClientId : "";
      const haystack = [entry.name, entry.description, typeLabel, sourceClientLabel]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(term);
    });
  }, [clientNameById, groupQuery, vehicleGroups]);

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
    const userAccess = detailsUser.attributes?.userAccess || baseUserAccess;
    if (userAccess.vehicleAccess?.mode === "all") return vehicles;
    const ids = new Set((userAccess.vehicleAccess?.vehicleIds || []).map(String));
    resolveVehicleGroupIds(userAccess).forEach((groupId) => {
      const groupVehicles = groupVehicleIdsMap.get(String(groupId)) || [];
      groupVehicles.forEach((vehicleId) => ids.add(String(vehicleId)));
    });
    return vehicles.filter((vehicle) => ids.has(String(vehicle.id)));
  }, [detailsUser, groupVehicleIdsMap, vehicles]);

  const vehicleLabelById = useMemo(() => {
    const map = new Map();
    vehicles.forEach((vehicle) => {
      const label =
        [vehicle.plate, vehicle.name || vehicle.model]
          .filter(Boolean)
          .join(" • ") || String(vehicle.id);
      if (vehicle.id != null) {
        map.set(String(vehicle.id), label);
      }
      const deviceCandidates = [
        vehicle.deviceId,
        vehicle.device?.id,
        vehicle.device?.uniqueId,
      ];
      if (Array.isArray(vehicle.devices)) {
        vehicle.devices.forEach((device) => {
          deviceCandidates.push(device?.id, device?.uniqueId);
        });
      }
      deviceCandidates
        .filter(Boolean)
        .forEach((deviceId) => {
          map.set(String(deviceId), label);
        });
    });
    return map;
  }, [vehicles]);

  const filteredDetailsVehicles = useMemo(() => {
    const term = normalizeText(detailsSearch);
    if (!term) return detailsVehicles;
    return detailsVehicles.filter((vehicle) => {
      const haystack = [vehicle.plate, vehicle.name, vehicle.model].filter(Boolean).join(" ").toLowerCase();
      return haystack.includes(term);
    });
  }, [detailsSearch, detailsVehicles]);

  const formatHistoryTimestamp = useCallback((value) => {
    if (!value) return "—";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return new Intl.DateTimeFormat("pt-BR", {
      dateStyle: "short",
      timeStyle: "medium",
    }).format(date);
  }, []);

  const resolveHistoryTarget = useCallback(
    (entry) => {
      if (!entry) return "—";
      const details = entry.details && typeof entry.details === "object" ? entry.details : {};
      const friendlyLabel =
        details.vehicleLabel ||
        details.plate ||
        details.vehiclePlate ||
        details.vehicleName ||
        null;
      if (friendlyLabel) return String(friendlyLabel);

      const candidateIds = [
        entry.vehicleId,
        details.vehicleId,
        entry.deviceId,
        details.deviceId,
        entry.relatedId,
        details.target,
      ]
        .filter(Boolean)
        .map((value) => String(value));

      for (const id of candidateIds) {
        const label = vehicleLabelById.get(id);
        if (label) return label;
      }

      if (entry.deviceId) return `Equipamento ${entry.deviceId}`;
      return candidateIds[0] || "—";
    },
    [vehicleLabelById],
  );

  const resolveHistoryDetails = useCallback((entry) => {
    if (!entry) return "—";
    if (typeof entry.details === "string" && entry.details.trim()) {
      return entry.details;
    }
    const details = entry.details && typeof entry.details === "object" ? entry.details : {};
    const category = String(entry.category || "").toLowerCase();
    const stringifyValue = (value) => {
      if (value === null || value === undefined || value === "") return "";
      if (typeof value === "string") return value;
      try {
        return JSON.stringify(value);
      } catch (_err) {
        return String(value);
      }
    };

    if (category === "command") {
      const commandLabel = details.command || details.commandName || details.commandKey || entry.action || null;
      const payloadValue = details.payload || details.params || details.commandPayload || null;
      const payloadLabel = stringifyValue(payloadValue);
      const parts = [];
      if (commandLabel) parts.push(`Comando: ${commandLabel}`);
      if (payloadLabel) parts.push(`Payload: ${payloadLabel}`);
      return parts.length ? parts.join(" • ") : "—";
    }

    if (category === "alert-handling") {
      const notes = details.handlingNotes || details.notes || details.note || details.observation || null;
      return notes ? `Observação: ${notes}` : "—";
    }

    if (category === "report") {
      const reportName = details.report || details.name || null;
      return reportName ? `Relatório: ${reportName}` : "—";
    }

    const fallback = stringifyValue(details);
    return fallback && fallback !== "{}" ? fallback : "—";
  }, []);

  const filteredHistoryEvents = useMemo(() => {
    if (historyFilter === "all") return historyEvents;
    return historyEvents.filter((entry) => String(entry.category || "").toLowerCase() === historyFilter);
  }, [historyEvents, historyFilter]);

  useEffect(() => {
    if (!detailsUserId || detailsDrawerTab !== "historico") return;
    let active = true;
    setHistoryLoading(true);
    setHistoryError(null);
    api
      .get(API_ROUTES.userAudit(detailsUserId), {
        params: {
          clientId: detailsUser?.clientId || tenantId || undefined,
        },
      })
      .then((response) => {
        if (!active) return;
        const list = Array.isArray(response?.data?.data)
          ? response.data.data
          : Array.isArray(response?.data?.events)
          ? response.data.events
          : Array.isArray(response?.data)
          ? response.data
          : [];
        setHistoryEvents(list);
      })
      .catch((err) => {
        if (!active) return;
        const message =
          err?.response?.data?.message || err?.message || "Não foi possível carregar o histórico.";
        setHistoryError(new Error(message));
        setHistoryEvents([]);
      })
      .finally(() => {
        if (active) setHistoryLoading(false);
      });
    return () => {
      active = false;
    };
  }, [detailsDrawerTab, detailsUser?.clientId, detailsUserId, historyReloadKey, tenantId]);

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
            {canCreateUsers && (
              <button
                type="button"
                onClick={() => openUserDrawer()}
                className="rounded-xl bg-sky-500 px-4 py-2 text-sm font-medium text-black transition hover:bg-sky-400"
              >
                <span className="inline-flex items-center gap-2">
                  <Plus className="h-4 w-4" /> Novo usuário
                </span>
              </button>
            )}
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
        {availableTabs.map((tab) => (
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

      {activeTabPermission && !activeTabPermission.canRead && (
        <div className="rounded-2xl border border-white/10 bg-white/5 p-6 text-white">
          <h2 className="text-lg font-semibold">Sem acesso</h2>
          <p className="mt-2 text-sm text-white/60">Seu perfil não possui acesso a esta seção.</p>
        </div>
      )}

      {activeTabPermission?.canRead && activeTab === "users" && (
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
                    const userAccess = entry.attributes?.userAccess || baseUserAccess;
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
                          <div className="text-xs text-white/60">{resolveUserProfileLabel(entry)}</div>
                        </td>
                        <td className="px-4 py-3 text-white/70">{entry.email}</td>
                        <td className="px-4 py-3 text-white/70">{entry.username || "—"}</td>
                        <td className="px-4 py-3 text-white/70">{vehicleCount}</td>
                        <td className="px-4 py-3 text-right">
                      <div className="flex justify-end gap-2">
                        {canEditUsers && (
                          <button
                            type="button"
                            onClick={() => openUserDrawer(entry)}
                            className="inline-flex items-center gap-2 rounded-lg border border-white/10 px-3 py-1 text-xs text-white/80 hover:border-white/30"
                          >
                            <Pencil className="h-3.5 w-3.5" /> Editar
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => openDetailsDrawer(entry)}
                          className="inline-flex items-center gap-2 rounded-lg border border-white/10 px-3 py-1 text-xs text-white/80 hover:border-white/30"
                        >
                          <Eye className="h-3.5 w-3.5" /> Detalhes
                        </button>
                        {canDeleteUsers && (
                          <button
                            type="button"
                            onClick={() => handleUserDelete(entry)}
                            className="inline-flex items-center gap-2 rounded-lg border border-red-500/40 px-3 py-1 text-xs text-red-300 hover:bg-red-500/10"
                          >
                            Excluir
                          </button>
                        )}
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

      {activeTabPermission?.canRead && activeTab === "vehicle-groups" && (
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
              activeTabPermission?.isFull ? (
                <button
                  type="button"
                  onClick={() => openGroupDrawer()}
                  className="rounded-xl bg-sky-500 px-4 py-2 text-sm font-medium text-black transition hover:bg-sky-400"
                >
                  <span className="inline-flex items-center gap-2">
                    <Plus className="h-4 w-4" /> Novo grupo
                  </span>
                </button>
              ) : null
            }
          />

          <div className="flex-1 overflow-hidden">
            <DataTable tableClassName="text-white/80">
              <thead className="bg-white/5 text-xs uppercase tracking-wide text-white/60">
                <tr>
                  <th className="px-4 py-3 text-left">Nome</th>
                  <th className="px-4 py-3 text-left">Tipo</th>
                  <th className="px-4 py-3 text-left">Cliente</th>
                  <th className="px-4 py-3 text-left">Veículos</th>
                  <th className="px-4 py-3 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/10">
                {filteredVehicleGroups.map((entry) => (
                  <tr key={entry.id} className="hover:bg-white/5">
                    <td className="px-4 py-3 text-white">
                      <div className="flex flex-col gap-1">
                        <span>{entry.name}</span>
                        {entry.description ? (
                          <span className="text-xs text-white/50">{entry.description}</span>
                        ) : null}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-white/70">{resolveGroupTypeLabel(resolveGroupType(entry))}</td>
                    <td className="px-4 py-3 text-white/70">
                      {(() => {
                        const sourceClientId = resolveGroupSourceClientId(entry);
                        if (!sourceClientId) return "—";
                        return clientNameById.get(String(sourceClientId)) || sourceClientId;
                      })()}
                    </td>
                    <td className="px-4 py-3 text-white/70">
                      {(groupVehicleIdsMap.get(String(entry.id)) || []).length}
                    </td>
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
                    <td colSpan={5} className="px-4 py-6 text-sm text-white/60">
                      Nenhum grupo de veículos encontrado.
                    </td>
                  </tr>
                )}
              </tbody>
            </DataTable>
          </div>
        </div>
      )}

      {activeTabPermission?.canRead && activeTab === "transfer-config" && (
        <div className="space-y-4">
          <div className="rounded-xl border border-white/10 bg-white/5 p-4 text-sm text-white/70">
            Copie grupos de veículos e preferências do usuário origem para outro usuário.
            Use “Sobrescrever” para aplicar exatamente a mesma configuração ou “Mesclar” para apenas somar os grupos.
          </div>
          <form onSubmit={handleTransferSubmit} className="grid gap-4 md:grid-cols-2">
            <label className="text-sm">
              <span className="block text-xs uppercase tracking-wide text-white/60">Usuário origem</span>
              <select
                value={transferFromUserId}
                onChange={(event) => setTransferFromUserId(event.target.value)}
                className="mt-1 w-full rounded-lg border border-border bg-layer px-3 py-2 text-sm"
                required
              >
                <option value="">Selecionar usuário</option>
                {userSelectOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              <span className="block text-xs uppercase tracking-wide text-white/60">Usuário destino</span>
              <select
                value={transferToUserId}
                onChange={(event) => setTransferToUserId(event.target.value)}
                className="mt-1 w-full rounded-lg border border-border bg-layer px-3 py-2 text-sm"
                required
              >
                <option value="">Selecionar usuário</option>
                {userSelectOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm md:col-span-2">
              <span className="block text-xs uppercase tracking-wide text-white/60">Modo</span>
              <div className="mt-2 flex flex-wrap gap-3 text-xs text-white/70">
                <label className="inline-flex items-center gap-2">
                  <input
                    type="radio"
                    name="transferMode"
                    checked={transferMode === "OVERWRITE"}
                    onChange={() => setTransferMode("OVERWRITE")}
                  />
                  Sobrescrever
                </label>
                <label className="inline-flex items-center gap-2">
                  <input
                    type="radio"
                    name="transferMode"
                    checked={transferMode === "MERGE"}
                    onChange={() => setTransferMode("MERGE")}
                  />
                  Mesclar
                </label>
              </div>
            </label>
            <div className="md:col-span-2 flex items-center justify-end gap-3">
              <button
                type="submit"
                disabled={transferLoading}
                className="rounded-xl bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90 disabled:opacity-60"
              >
                {transferLoading ? "Transferindo…" : "Transferir configuração"}
              </button>
            </div>
          </form>
        </div>
      )}

      {activeTabPermission?.canRead && activeTab === "permission-groups" && (
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
              activeTabPermission?.isFull ? (
                <button
                  type="button"
                  onClick={() => openPermissionDrawer()}
                  className="rounded-xl bg-sky-500 px-4 py-2 text-sm font-medium text-black transition hover:bg-sky-400"
                >
                  <span className="inline-flex items-center gap-2">
                    <Plus className="h-4 w-4" /> Novo grupo
                  </span>
                </button>
              ) : null
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
                {filteredPermissionGroups.map((entry) => {
                  const isGlobal = entry.attributes?.scope === "global";
                  const canEditGroup = activeTabPermission?.isFull && (!isGlobal || isAdminGeneralTenant);
                  return (
                    <tr key={entry.id} className="hover:bg-white/5">
                      <td className="px-4 py-3 text-white">
                        <div className="flex flex-wrap items-center gap-2">
                          <span>{entry.name}</span>
                          {isGlobal && (
                            <span className="rounded-full border border-sky-400/40 bg-sky-400/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-sky-200">
                              Global
                            </span>
                          )}
                        </div>
                      </td>
                    <td className="px-4 py-3 text-white/70">{entry.description || "—"}</td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex justify-end gap-2">
                        {canEditGroup ? (
                          <>
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
                          </>
                        ) : (
                          <button
                            type="button"
                            onClick={() => openPermissionDrawer(entry, { readOnly: true })}
                            className="rounded-lg border border-white/10 px-3 py-1 text-xs text-white/80 hover:border-white/30"
                          >
                            Detalhes
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                  );
                })}
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
                        {group.attributes?.scope === "global" ? " (Global)" : ""}
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
                        const groupType = resolveGroupType(group);
                        const sourceClientId = resolveGroupSourceClientId(group);
                        const sourceClientLabel =
                          sourceClientId ? clientNameById.get(String(sourceClientId)) || sourceClientId : null;
                        const groupLabel =
                          groupType === VEHICLE_GROUP_TYPES.BY_CLIENT && sourceClientLabel
                            ? `${group?.name || `Grupo ${id}`} · ${sourceClientLabel}`
                            : group?.name || `Grupo ${id}`;
                        return (
                          <span
                            key={id}
                            className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/20 px-3 py-1 text-xs text-white/80"
                          >
                            {groupLabel}
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
        onClose={() => {
          setDetailsDrawerOpen(false);
          setDetailsUserId(null);
        }}
        title={`Detalhes - ${detailsUser?.name || "Usuário"}`}
        description="Resumo de acesso, permissões e veículos vinculados."
      >
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
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
            {canDeleteUsers && detailsUser && (
              <button
                type="button"
                onClick={() => handleUserDelete(detailsUser)}
                className="rounded-xl border border-red-500/40 px-4 py-2 text-xs text-red-300 hover:bg-red-500/10"
              >
                Excluir usuário
              </button>
            )}
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
                    {(() => {
                      return resolveUserProfileLabel(detailsUser);
                    })()}
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
                        {(() => {
                          const groupType = resolveGroupType(group);
                          const sourceClientId = resolveGroupSourceClientId(group);
                          const sourceClientLabel =
                            sourceClientId ? clientNameById.get(String(sourceClientId)) || sourceClientId : null;
                          if (groupType === VEHICLE_GROUP_TYPES.BY_CLIENT && sourceClientLabel) {
                            return `${group.name} · ${sourceClientLabel}`;
                          }
                          return group.name;
                        })()}
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

          {detailsDrawerTab === "historico" && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/5 p-4">
                <div>
                  <p className="text-xs uppercase tracking-[0.12em] text-white/50">Filtros</p>
                  <p className="text-sm text-white/70">
                    Histórico de acessos, comandos, relatórios e tratativas.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    value={historyFilter}
                    onChange={(event) => setHistoryFilter(event.target.value)}
                    className="rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-xs text-white/80"
                  >
                    {historyCategories.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="rounded-lg border border-white/10 px-3 py-2 text-xs text-white/70 hover:border-white/30"
                    onClick={() => setHistoryReloadKey((current) => current + 1)}
                  >
                    Atualizar
                  </button>
                </div>
              </div>

              {historyLoading && <p className="text-xs text-white/60">Carregando histórico...</p>}
              {historyError && !historyLoading && (
                <p className="text-xs text-red-200/80">{historyError.message}</p>
              )}
              {!historyLoading && !historyError && filteredHistoryEvents.length === 0 && (
                <p className="text-xs text-white/50">Nenhum evento encontrado para este usuário.</p>
              )}

              {!historyLoading && !historyError && filteredHistoryEvents.length > 0 && (
                <div className="overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead className="text-white/40">
                      <tr className="border-b border-white/10 text-left">
                        <th className="py-2 pr-4">Data/Hora</th>
                        <th className="py-2 pr-4">Ação</th>
                        <th className="py-2 pr-4">Alvo</th>
                        <th className="py-2 pr-4">IP</th>
                        <th className="py-2 pr-4">Detalhes</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredHistoryEvents.map((entry) => {
                        const targetLabel = resolveHistoryTarget(entry);
                        const detailsLabel = resolveHistoryDetails(entry);
                        return (
                          <tr key={entry.id} className="border-b border-white/5">
                            <td className="py-2 pr-4 text-white/70">
                              {formatHistoryTimestamp(entry.sentAt || entry.respondedAt || entry.createdAt)}
                            </td>
                            <td className="py-2 pr-4 text-white/80">
                              {entry.action || entry.category || "Ação registrada"}
                            </td>
                            <td className="py-2 pr-4 text-white/70">{targetLabel}</td>
                            <td className="py-2 pr-4 text-white/60">{entry.ipAddress || "—"}</td>
                            <td
                              className="py-2 pr-4 text-white/60 max-w-[320px] truncate"
                              title={detailsLabel}
                            >
                              {detailsLabel}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
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
          {isMirrorReceiver && (
            <label className="text-sm">
              <span className="block text-xs uppercase tracking-wide text-white/60">Tipo do grupo</span>
              <select
                value={groupForm.groupType}
                onChange={(event) => {
                  const nextType = event.target.value;
                  setGroupForm((prev) => ({
                    ...prev,
                    groupType: nextType,
                    sourceClientId: nextType === VEHICLE_GROUP_TYPES.BY_CLIENT ? prev.sourceClientId : "",
                    vehicleIds: nextType === VEHICLE_GROUP_TYPES.CUSTOM ? prev.vehicleIds : [],
                  }));
                }}
                className="mt-1 w-full rounded-lg border border-border bg-layer px-3 py-2 text-sm"
              >
                <option value={VEHICLE_GROUP_TYPES.CUSTOM}>Avulso (seleção manual)</option>
                {mirrorClientOptions.length > 0 && (
                  <option value={VEHICLE_GROUP_TYPES.BY_CLIENT}>Por cliente espelhado</option>
                )}
              </select>
            </label>
          )}
          {groupForm.groupType === VEHICLE_GROUP_TYPES.BY_CLIENT && (
            <label className="text-sm">
              <span className="block text-xs uppercase tracking-wide text-white/60">Cliente espelhado</span>
              <select
                value={groupForm.sourceClientId}
                onChange={(event) => setGroupForm((prev) => ({ ...prev, sourceClientId: event.target.value }))}
                className="mt-1 w-full rounded-lg border border-border bg-layer px-3 py-2 text-sm"
                required
              >
                <option value="">Selecionar cliente</option>
                {mirrorClientOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              {groupForm.sourceClientId && (
                <p className="mt-2 text-xs text-white/60">
                  Veículos disponíveis:{" "}
                  <span className="text-white">
                    {vehicles.filter((vehicle) => String(vehicle.clientId) === String(groupForm.sourceClientId)).length}
                  </span>
                </p>
              )}
            </label>
          )}

          {groupForm.groupType === VEHICLE_GROUP_TYPES.CUSTOM && (
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
          )}

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
        onClose={() => {
          setPermissionDrawerOpen(false);
          setPermissionReadOnly(false);
          setEditingPermissionGroup(null);
        }}
        title={
          editingPermissionGroup
            ? permissionReadOnly
              ? "Detalhes do grupo de permissões"
              : "Editar grupo de permissões"
            : "Novo grupo de permissões"
        }
        description="Defina níveis de acesso por menu, página e submenus."
        eyebrow="Grupos de permissões"
      >
        <form onSubmit={handlePermissionSubmit} className="space-y-4">
          {permissionReadOnly && (
            <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-xs text-white/70">
              Visualização somente leitura. Perfis globais são gerenciados no ADMIN GERAL.
            </div>
          )}
          {isAdminGeneralTenant && !editingPermissionGroup && (
            <div className="rounded-xl border border-sky-400/30 bg-sky-500/10 px-4 py-3 text-xs text-sky-100">
              Perfis criados no ADMIN GERAL ficam disponíveis para todos os clientes.
            </div>
          )}
          <label className="text-sm">
            <span className="block text-xs uppercase tracking-wide text-white/60">Nome do grupo</span>
            <input
              type="text"
              value={permissionForm.name}
              required
              onChange={(event) => setPermissionForm((prev) => ({ ...prev, name: event.target.value }))}
              disabled={permissionReadOnly}
              className="mt-1 w-full rounded-lg border border-border bg-layer px-3 py-2 text-sm disabled:opacity-70"
            />
          </label>
          <label className="text-sm">
            <span className="block text-xs uppercase tracking-wide text-white/60">Descrição</span>
            <input
              type="text"
              value={permissionForm.description}
              onChange={(event) => setPermissionForm((prev) => ({ ...prev, description: event.target.value }))}
              disabled={permissionReadOnly}
              className="mt-1 w-full rounded-lg border border-border bg-layer px-3 py-2 text-sm disabled:opacity-70"
            />
          </label>

          <PermissionTreeEditor
            permissions={permissionForm.permissions}
            scopePermissions={scopedPermissionContext}
            allowBulkActions={isAdminGeneral}
            readOnly={permissionReadOnly}
            onChange={handlePermissionFormChange}
          />

          <div className="flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={() => setPermissionDrawerOpen(false)}
              className="rounded-xl border border-border px-4 py-2 text-sm text-white/70 hover:bg-white/10"
            >
              {permissionReadOnly ? "Fechar" : "Cancelar"}
            </button>
            {!permissionReadOnly && (
              <button
                type="submit"
                className="rounded-xl bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90"
              >
                Salvar grupo
              </button>
            )}
          </div>
        </form>
      </Drawer>
      <PageToast toast={toast} />
    </div>
  );
}
