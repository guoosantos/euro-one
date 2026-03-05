import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Download,
  KeyRound,
  RefreshCw,
  RotateCw,
  Search,
  Shield,
  SlidersHorizontal,
  User,
} from "lucide-react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";

import DataTable from "../components/ui/DataTable.jsx";
import EmptyState from "../components/ui/EmptyState.jsx";
import FilterBar from "../components/ui/FilterBar.jsx";
import PageHeader from "../components/ui/PageHeader.jsx";
import DataTablePagination from "../ui/DataTablePagination.jsx";
import { usePermissionGate } from "../lib/permissions/permission-gate.js";
import { useTenant } from "../lib/tenant-context.jsx";
import TrustCenterApi from "../lib/trustCenterApi.js";

const TRUST_TABS = [
  { id: "users", label: "Usuários", path: "/trust-center/users", permission: { menuKey: "trust_center", pageKey: "view" } },
  { id: "activity", label: "Histórico", path: "/trust-center/activity", permission: { menuKey: "trust_center", pageKey: "audit_view" } },
  {
    id: "counter-key",
    label: "Contra-senha",
    path: "/trust-center/counter-key",
    permission: { menuKey: "trust_center", pageKey: "manage_counter_key" },
  },
];

const USERS_DEFAULT_COLUMNS = {
  userName: true,
  profile: true,
  clientName: true,
  esp32Device: true,
  actionType: true,
  result: true,
  state: true,
  latestCounterKey: true,
  challenge: true,
  lastHeartbeatAt: true,
  lastAttemptAt: true,
  lastAccessAt: true,
};

const USERS_COLUMNS = [
  { key: "state", label: "Estado", sortable: true, fixed: true },
  { key: "userName", label: "Usuário", sortable: true },
  { key: "profile", label: "Perfil", sortable: true },
  { key: "clientName", label: "Cliente", sortable: true },
  { key: "esp32Device", label: "Dispositivo ESP32", sortable: true },
  { key: "actionType", label: "Tipo de ação", sortable: true },
  { key: "result", label: "Resultado", sortable: true },
  { key: "latestCounterKey", label: "Senha (mascarada)", sortable: false },
  { key: "challenge", label: "Challenge", sortable: true },
  { key: "lastHeartbeatAt", label: "Último heartbeat", sortable: true },
  { key: "lastAttemptAt", label: "Última tentativa", sortable: true },
  { key: "lastAccessAt", label: "Último acesso", sortable: true },
];

function formatDateTime(value) {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "—";
  return parsed.toLocaleString("pt-BR");
}

function normalizePath(pathname) {
  if (!pathname) return "/trust-center/users";
  if (pathname === "/trust-center") return "/trust-center/users";
  if (pathname.startsWith("/trust-center/activity")) return "/trust-center/activity";
  if (pathname.startsWith("/trust-center/counter-key")) return "/trust-center/counter-key";
  return "/trust-center/users";
}

function Drawer({ open, onClose, title, description, children }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[9998] flex">
      <div className="flex-1 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative h-full w-full max-w-3xl border-l border-white/10 bg-[#0f141c] shadow-3xl">
        <div className="flex items-start justify-between gap-4 border-b border-white/10 px-6 py-5">
          <div>
            <p className="text-xs uppercase tracking-[0.12em] text-white/50">Trust Center</p>
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

function SectionTabs({ tabs, activeTab, onChange }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          onClick={() => onChange(tab.id)}
          className={`rounded-xl px-4 py-2 text-sm transition ${
            activeTab === tab.id ? "bg-sky-500 text-black" : "bg-white/10 text-white/75 hover:bg-white/15"
          }`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

function useSearchParamState(searchParams, setSearchParams) {
  const updateSearchParams = useCallback(
    (updates = {}) => {
      const next = new URLSearchParams(searchParams);
      Object.entries(updates).forEach(([key, value]) => {
        if (value === null || value === undefined || value === "") {
          next.delete(key);
        } else {
          next.set(key, String(value));
        }
      });
      setSearchParams(next, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  return { updateSearchParams };
}

export default function TrustCenter() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const { tenantId, tenantScope, user } = useTenant();

  const trustView = usePermissionGate({ menuKey: "trust_center", pageKey: "view" });
  const trustAuditView = usePermissionGate({ menuKey: "trust_center", pageKey: "audit_view" });
  const trustManageCounterKey = usePermissionGate({ menuKey: "trust_center", pageKey: "manage_counter_key" });

  const tabPermissions = useMemo(
    () => ({
      users: trustView,
      activity: trustAuditView,
      "counter-key": trustManageCounterKey,
    }),
    [trustAuditView, trustManageCounterKey, trustView],
  );

  const allowedTabs = useMemo(() => {
    return TRUST_TABS.filter((tab) => tabPermissions[tab.id]?.canShow);
  }, [tabPermissions]);

  const resolvedPath = normalizePath(location.pathname);
  const activeTab = useMemo(() => {
    if (resolvedPath === "/trust-center/activity") return "activity";
    if (resolvedPath === "/trust-center/counter-key") return "counter-key";
    return "users";
  }, [resolvedPath]);

  const { updateSearchParams } = useSearchParamState(searchParams, setSearchParams);

  useEffect(() => {
    if (location.pathname === "/trust-center") {
      navigate("/trust-center/users", { replace: true });
      return;
    }

    const canOpenCurrent = allowedTabs.some((tab) => tab.id === activeTab);
    if (!canOpenCurrent && allowedTabs.length > 0) {
      navigate(allowedTabs[0].path, { replace: true });
    }
  }, [activeTab, allowedTabs, location.pathname, navigate]);

  const [options, setOptions] = useState({ users: [], vehicles: [], clients: [], devices: [] });
  const [optionsLoading, setOptionsLoading] = useState(false);

  const fallbackClientId = useMemo(() => {
    if (tenantScope !== "ALL") {
      return tenantId || user?.clientId || "";
    }
    return "";
  }, [tenantId, tenantScope, user?.clientId]);

  const selectedClientId = searchParams.get("clientId") || fallbackClientId || options.clients?.[0]?.id || "";

  const loadOptions = useCallback(async () => {
    setOptionsLoading(true);
    try {
      const payload = await TrustCenterApi.listOptions({ clientId: selectedClientId || undefined });
      setOptions({
        users: Array.isArray(payload?.users) ? payload.users : [],
        vehicles: Array.isArray(payload?.vehicles) ? payload.vehicles : [],
        clients: Array.isArray(payload?.clients) ? payload.clients : [],
        devices: Array.isArray(payload?.devices) ? payload.devices : [],
      });
    } catch (error) {
      console.error("Falha ao carregar opções do Trust Center", error);
      setOptions({ users: [], vehicles: [], clients: [], devices: [] });
    } finally {
      setOptionsLoading(false);
    }
  }, [selectedClientId]);

  useEffect(() => {
    if (!allowedTabs.length) return;
    loadOptions();
  }, [allowedTabs.length, loadOptions]);

  const [usersLoading, setUsersLoading] = useState(false);
  const [usersPayload, setUsersPayload] = useState({ data: [], page: 1, pageSize: 20, total: 0, totalPages: 1 });
  const [showColumnPicker, setShowColumnPicker] = useState(false);
  const usersPage = Number(searchParams.get("page") || 1);
  const usersPageSize = Number(searchParams.get("pageSize") || 20);
  const usersSortBy = searchParams.get("sortBy") || "";
  const usersSortDir = searchParams.get("sortDir") || "desc";
  const userFilter = searchParams.get("user") || "";
  const deviceFilter = searchParams.get("device") || "";
  const passwordFilter = searchParams.get("password") || "";
  const actionTypeFilter = searchParams.get("actionType") || "";
  const resultFilter = searchParams.get("result") || "";

  const userColumnStorageKey = useMemo(
    () => `trust-center.users.columns:${user?.id || "anon"}:${selectedClientId || "all"}`,
    [selectedClientId, user?.id],
  );
  const [visibleColumns, setVisibleColumns] = useState(() => {
    try {
      const raw = window.localStorage?.getItem(userColumnStorageKey);
      if (!raw) return USERS_DEFAULT_COLUMNS;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return USERS_DEFAULT_COLUMNS;
      return { ...USERS_DEFAULT_COLUMNS, ...parsed };
    } catch (_error) {
      return USERS_DEFAULT_COLUMNS;
    }
  });

  useEffect(() => {
    try {
      const raw = window.localStorage?.getItem(userColumnStorageKey);
      if (!raw) {
        setVisibleColumns(USERS_DEFAULT_COLUMNS);
        return;
      }
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") {
        setVisibleColumns(USERS_DEFAULT_COLUMNS);
        return;
      }
      setVisibleColumns({ ...USERS_DEFAULT_COLUMNS, ...parsed });
    } catch (_error) {
      setVisibleColumns(USERS_DEFAULT_COLUMNS);
    }
  }, [userColumnStorageKey]);

  useEffect(() => {
    try {
      window.localStorage?.setItem(userColumnStorageKey, JSON.stringify(visibleColumns));
    } catch (_error) {
      // ignore storage failure
    }
  }, [userColumnStorageKey, visibleColumns]);

  const visibleUserColumns = useMemo(() => {
    return USERS_COLUMNS.filter((column) => column.fixed || visibleColumns[column.key] !== false);
  }, [visibleColumns]);

  const loadUsers = useCallback(async () => {
    if (activeTab !== "users") return;
    setUsersLoading(true);
    try {
      const payload = await TrustCenterApi.listUsers({
        clientId: selectedClientId || undefined,
        page: usersPage,
        pageSize: usersPageSize,
        sortBy: usersSortBy || undefined,
        sortDir: usersSortDir,
        user: userFilter || undefined,
        device: deviceFilter || undefined,
        password: passwordFilter || undefined,
        actionType: actionTypeFilter || undefined,
        result: resultFilter || undefined,
      });
      setUsersPayload({
        data: Array.isArray(payload?.data) ? payload.data : [],
        page: Number(payload?.page) || usersPage,
        pageSize: Number(payload?.pageSize) || usersPageSize,
        total: Number(payload?.total) || 0,
        totalPages: Number(payload?.totalPages) || 1,
      });
    } catch (error) {
      console.error("Falha ao carregar usuários do Trust Center", error);
      setUsersPayload({ data: [], page: 1, pageSize: usersPageSize, total: 0, totalPages: 1 });
    } finally {
      setUsersLoading(false);
    }
  }, [
    activeTab,
    actionTypeFilter,
    deviceFilter,
    passwordFilter,
    resultFilter,
    selectedClientId,
    userFilter,
    usersPage,
    usersPageSize,
    usersSortBy,
    usersSortDir,
  ]);

  useEffect(() => {
    void loadUsers();
  }, [loadUsers]);

  const toggleUsersSort = (columnKey) => {
    if (usersSortBy === columnKey) {
      const nextDir = usersSortDir === "asc" ? "desc" : "asc";
      updateSearchParams({ sortDir: nextDir, page: 1 });
      return;
    }
    updateSearchParams({ sortBy: columnKey, sortDir: "asc", page: 1 });
  };

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerLoading, setDrawerLoading] = useState(false);
  const [drawerData, setDrawerData] = useState(null);
  const [drawerTab, setDrawerTab] = useState("status");

  const openUserSummary = async (stateId) => {
    setDrawerOpen(true);
    setDrawerLoading(true);
    setDrawerData(null);
    setDrawerTab("status");
    try {
      const payload = await TrustCenterApi.getUserSummary(stateId, { clientId: selectedClientId || undefined });
      setDrawerData(payload || null);
    } catch (error) {
      console.error("Falha ao carregar resumo do usuário", error);
      setDrawerData(null);
    } finally {
      setDrawerLoading(false);
    }
  };

  const [simulateOpen, setSimulateOpen] = useState(false);
  const [simulateForm, setSimulateForm] = useState({ basePin: "", challenge: "", userId: "", vehicleId: "" });
  const [simulateLoading, setSimulateLoading] = useState(false);
  const [simulateResult, setSimulateResult] = useState(null);

  const handleSimulate = async (event) => {
    event.preventDefault();
    setSimulateLoading(true);
    setSimulateResult(null);
    try {
      const payload = await TrustCenterApi.simulateCounterKey({
        clientId: selectedClientId || undefined,
        basePin: simulateForm.basePin,
        challenge: simulateForm.challenge || undefined,
        userId: simulateForm.userId || undefined,
        vehicleId: simulateForm.vehicleId || undefined,
      });
      setSimulateResult(payload || null);
    } catch (error) {
      alert(error?.message || "Falha ao simular contra-senha.");
    } finally {
      setSimulateLoading(false);
    }
  };

  const handleRotateChallenge = async () => {
    try {
      await TrustCenterApi.rotateChallenge({
        clientId: selectedClientId || undefined,
        filters: {
          user: userFilter || undefined,
          device: deviceFilter || undefined,
          password: passwordFilter || undefined,
          actionType: actionTypeFilter || undefined,
          result: resultFilter || undefined,
        },
      });
      await loadUsers();
    } catch (error) {
      alert(error?.message || "Falha ao rotacionar challenge.");
    }
  };

  const [activityLoading, setActivityLoading] = useState(false);
  const [activityPayload, setActivityPayload] = useState({ data: [], page: 1, pageSize: 20, total: 0, totalPages: 1 });
  const activityPage = Number(searchParams.get("aPage") || 1);
  const activityPageSize = Number(searchParams.get("aPageSize") || 20);

  const loadActivity = useCallback(async () => {
    if (activeTab !== "activity") return;
    setActivityLoading(true);
    try {
      const payload = await TrustCenterApi.listActivity({
        clientId: selectedClientId || undefined,
        page: activityPage,
        pageSize: activityPageSize,
        from: searchParams.get("aFrom") || undefined,
        to: searchParams.get("aTo") || undefined,
        user: searchParams.get("aUser") || undefined,
        client: searchParams.get("aClient") || undefined,
        vehicle: searchParams.get("aVehicle") || undefined,
        device: searchParams.get("aDevice") || undefined,
        method: searchParams.get("aMethod") || undefined,
        result: searchParams.get("aResult") || undefined,
      });
      setActivityPayload({
        data: Array.isArray(payload?.data) ? payload.data : [],
        page: Number(payload?.page) || activityPage,
        pageSize: Number(payload?.pageSize) || activityPageSize,
        total: Number(payload?.total) || 0,
        totalPages: Number(payload?.totalPages) || 1,
      });
    } catch (error) {
      console.error("Falha ao carregar histórico", error);
      setActivityPayload({ data: [], page: 1, pageSize: activityPageSize, total: 0, totalPages: 1 });
    } finally {
      setActivityLoading(false);
    }
  }, [activeTab, activityPage, activityPageSize, searchParams, selectedClientId]);

  useEffect(() => {
    void loadActivity();
  }, [loadActivity]);

  const exportActivity = async () => {
    try {
      const response = await TrustCenterApi.exportActivity({
        clientId: selectedClientId || undefined,
        from: searchParams.get("aFrom") || undefined,
        to: searchParams.get("aTo") || undefined,
        user: searchParams.get("aUser") || undefined,
        client: searchParams.get("aClient") || undefined,
        vehicle: searchParams.get("aVehicle") || undefined,
        device: searchParams.get("aDevice") || undefined,
        method: searchParams.get("aMethod") || undefined,
        result: searchParams.get("aResult") || undefined,
      });
      const blob = response?.data instanceof Blob ? response.data : new Blob([response?.data ?? ""], { type: "text/csv" });
      const link = document.createElement("a");
      const url = URL.createObjectURL(blob);
      link.href = url;
      link.download = `trust-center-historico-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      alert(error?.message || "Falha ao exportar histórico.");
    }
  };

  const [counterLoading, setCounterLoading] = useState(false);
  const [counterPayload, setCounterPayload] = useState({ data: [], page: 1, pageSize: 20, total: 0, totalPages: 1 });
  const counterPage = Number(searchParams.get("kPage") || 1);
  const counterPageSize = Number(searchParams.get("kPageSize") || 20);

  const loadCounterKeys = useCallback(async () => {
    if (activeTab !== "counter-key") return;
    setCounterLoading(true);
    try {
      const payload = await TrustCenterApi.listCounterKeys({
        clientId: selectedClientId || undefined,
        page: counterPage,
        pageSize: counterPageSize,
        user: searchParams.get("kUser") || undefined,
        vehicle: searchParams.get("kVehicle") || undefined,
        device: searchParams.get("kDevice") || undefined,
        status: searchParams.get("kStatus") || undefined,
        sortBy: searchParams.get("kSortBy") || undefined,
        sortDir: searchParams.get("kSortDir") || undefined,
      });
      setCounterPayload({
        data: Array.isArray(payload?.data) ? payload.data : [],
        page: Number(payload?.page) || counterPage,
        pageSize: Number(payload?.pageSize) || counterPageSize,
        total: Number(payload?.total) || 0,
        totalPages: Number(payload?.totalPages) || 1,
      });
    } catch (error) {
      console.error("Falha ao carregar contra-senhas", error);
      setCounterPayload({ data: [], page: 1, pageSize: counterPageSize, total: 0, totalPages: 1 });
    } finally {
      setCounterLoading(false);
    }
  }, [activeTab, counterPage, counterPageSize, searchParams, selectedClientId]);

  useEffect(() => {
    void loadCounterKeys();
  }, [loadCounterKeys]);

  const [counterForm, setCounterForm] = useState({ userId: "", vehicleId: "", basePin: "", esp32Device: "" });
  const [counterSaving, setCounterSaving] = useState(false);

  const createCounterKeyRow = async (event) => {
    event.preventDefault();
    if (!counterForm.userId || !counterForm.vehicleId || !counterForm.basePin) {
      alert("Selecione usuário, veículo e informe a senha de 6 dígitos.");
      return;
    }

    setCounterSaving(true);
    try {
      await TrustCenterApi.createCounterKey({
        clientId: selectedClientId || undefined,
        userId: counterForm.userId,
        vehicleId: counterForm.vehicleId,
        basePin: counterForm.basePin,
        esp32Device: counterForm.esp32Device || undefined,
      });
      setCounterForm({ userId: "", vehicleId: "", basePin: "", esp32Device: "" });
      await loadCounterKeys();
      await loadUsers();
    } catch (error) {
      alert(error?.message || "Falha ao criar contra-senha.");
    } finally {
      setCounterSaving(false);
    }
  };

  const markCounterUse = async (row) => {
    const typed = window.prompt("Informe a contra-senha para validar (opcional):", row?.counterKey || "");
    try {
      await TrustCenterApi.useCounterKey(row.id, {
        clientId: selectedClientId || undefined,
        counterKey: typed || undefined,
      });
      await loadCounterKeys();
      await loadUsers();
    } catch (error) {
      alert(error?.message || "Falha ao registrar uso.");
    }
  };

  const cancelCounter = async (row) => {
    try {
      await TrustCenterApi.cancelCounterKey(row.id, { clientId: selectedClientId || undefined });
      await loadCounterKeys();
    } catch (error) {
      alert(error?.message || "Falha ao cancelar contra-senha.");
    }
  };

  if (trustView.loading || trustAuditView.loading || trustManageCounterKey.loading) {
    return <div className="text-sm text-white/70">Carregando permissões do Trust Center…</div>;
  }

  if (!allowedTabs.length) {
    return (
      <div className="rounded-xl border border-amber-400/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
        Você não possui permissão para acessar o Trust Center.
      </div>
    );
  }

  return (
    <div className="flex min-h-[calc(100vh-180px)] flex-col gap-6">
      <PageHeader
        title="Trust Center"
        subtitle="Painel de gerenciamento de acessos, auditoria de ações e geração de contra-senha para dispositivos ESP32."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={activeTab === "users" ? loadUsers : activeTab === "activity" ? loadActivity : loadCounterKeys}
              className="rounded-xl bg-white/10 px-4 py-2 text-sm text-white transition hover:bg-white/15"
            >
              <span className="inline-flex items-center gap-2">
                <RefreshCw className="h-4 w-4" /> Atualizar
              </span>
            </button>
            {activeTab === "users" && trustManageCounterKey.canShow && (
              <>
                <button
                  type="button"
                  onClick={handleRotateChallenge}
                  className="rounded-xl bg-white/10 px-4 py-2 text-sm text-white transition hover:bg-white/15"
                >
                  <span className="inline-flex items-center gap-2">
                    <RotateCw className="h-4 w-4" /> Rotacionar challenge
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSimulateResult(null);
                    setSimulateOpen(true);
                  }}
                  className="rounded-xl bg-sky-500 px-4 py-2 text-sm font-medium text-black transition hover:bg-sky-400"
                >
                  <span className="inline-flex items-center gap-2">
                    <KeyRound className="h-4 w-4" /> Simular contra-senha
                  </span>
                </button>
              </>
            )}
            {activeTab === "activity" && (
              <button
                type="button"
                onClick={exportActivity}
                className="rounded-xl bg-sky-500 px-4 py-2 text-sm font-medium text-black transition hover:bg-sky-400"
              >
                <span className="inline-flex items-center gap-2">
                  <Download className="h-4 w-4" /> Exportar dados
                </span>
              </button>
            )}
          </div>
        }
      />

      <SectionTabs
        tabs={allowedTabs}
        activeTab={activeTab}
        onChange={(tabId) => {
          const target = TRUST_TABS.find((tab) => tab.id === tabId);
          if (!target) return;
          navigate(target.path);
        }}
      />

      {tenantScope === "ALL" && (
        <div className="rounded-xl border border-white/10 bg-white/5 p-3">
          <label className="mb-2 block text-xs uppercase tracking-[0.08em] text-white/60">Cliente</label>
          <select
            value={selectedClientId}
            onChange={(event) => updateSearchParams({ clientId: event.target.value || null })}
            className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
            disabled={optionsLoading}
          >
            <option value="">Selecione</option>
            {options.clients.map((client) => (
              <option key={client.id} value={client.id}>
                {client.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {activeTab === "users" && (
        <>
          <FilterBar
            left={
              <>
                <div className="relative min-w-[190px] flex-1">
                  <User className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-white/50" />
                  <input
                    value={userFilter}
                    onChange={(event) => updateSearchParams({ user: event.target.value, page: 1 })}
                    placeholder="Usuário"
                    className="w-full rounded-xl border border-white/10 bg-black/30 py-2 pl-10 pr-4 text-sm text-white placeholder:text-white/50 focus:border-white/30 focus:outline-none"
                  />
                </div>
                <div className="relative min-w-[190px] flex-1">
                  <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-white/50" />
                  <input
                    value={deviceFilter}
                    onChange={(event) => updateSearchParams({ device: event.target.value, page: 1 })}
                    placeholder="Dispositivo ESP32"
                    className="w-full rounded-xl border border-white/10 bg-black/30 py-2 pl-10 pr-4 text-sm text-white placeholder:text-white/50 focus:border-white/30 focus:outline-none"
                  />
                </div>
                <input
                  value={passwordFilter}
                  onChange={(event) => updateSearchParams({ password: event.target.value, page: 1 })}
                  placeholder="Senha (6 dígitos)"
                  className="min-w-[160px] rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white placeholder:text-white/50 focus:border-white/30 focus:outline-none"
                />
                <input
                  value={actionTypeFilter}
                  onChange={(event) => updateSearchParams({ actionType: event.target.value, page: 1 })}
                  placeholder="Tipo de ação"
                  className="min-w-[160px] rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white placeholder:text-white/50 focus:border-white/30 focus:outline-none"
                />
                <input
                  value={resultFilter}
                  onChange={(event) => updateSearchParams({ result: event.target.value, page: 1 })}
                  placeholder="Resultado"
                  className="min-w-[140px] rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white placeholder:text-white/50 focus:border-white/30 focus:outline-none"
                />
              </>
            }
            right={
              <button
                type="button"
                onClick={() => setShowColumnPicker((previous) => !previous)}
                className="rounded-xl bg-white/10 px-3 py-2 text-sm text-white transition hover:bg-white/15"
              >
                <span className="inline-flex items-center gap-2">
                  <SlidersHorizontal className="h-4 w-4" /> Colunas
                </span>
              </button>
            }
          />

          {showColumnPicker && (
            <div className="flex flex-wrap gap-4 rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-xs text-white/80">
              {USERS_COLUMNS.filter((column) => !column.fixed).map((column) => (
                <label key={column.key} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={visibleColumns[column.key] !== false}
                    onChange={() =>
                      setVisibleColumns((current) => ({
                        ...current,
                        [column.key]: current[column.key] === false,
                      }))
                    }
                  />
                  {column.label}
                </label>
              ))}
            </div>
          )}

          <div className="overflow-hidden rounded-xl border border-white/10 bg-[#0f141c]">
            <DataTable tableClassName="text-white/80">
              <thead className="bg-white/5 text-xs uppercase tracking-wide text-white/60">
                <tr>
                  {visibleUserColumns.map((column) => (
                    <th
                      key={column.key}
                      className={`px-4 py-3 text-left ${column.sortable ? "cursor-pointer select-none" : ""}`}
                      onClick={() => column.sortable && toggleUsersSort(column.key)}
                    >
                      <span className="inline-flex items-center gap-2">
                        {column.label}
                        {usersSortBy === column.key && <span className="text-[10px]">{usersSortDir === "asc" ? "↑" : "↓"}</span>}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-white/10">
                {usersLoading && (
                  <tr>
                    <td colSpan={visibleUserColumns.length} className="px-4 py-6 text-center text-white/60">
                      Carregando usuários do Trust Center...
                    </td>
                  </tr>
                )}
                {!usersLoading && usersPayload.data.length === 0 && (
                  <tr>
                    <td colSpan={visibleUserColumns.length} className="px-4 py-6">
                      <EmptyState
                        title="Nenhum registro encontrado"
                        subtitle="Ajuste os filtros ou gere novos eventos no Trust Center."
                      />
                    </td>
                  </tr>
                )}
                {!usersLoading &&
                  usersPayload.data.map((row) => (
                    <tr
                      key={row.id}
                      className="cursor-pointer hover:bg-white/5"
                      onClick={() => openUserSummary(row.id)}
                    >
                      {visibleUserColumns.map((column) => (
                        <td key={column.key} className="px-4 py-3 align-top">
                          {column.key === "state" ? (
                            <span className="rounded-lg bg-white/10 px-2 py-1 text-xs text-white/90">{row.state || "—"}</span>
                          ) : ["lastHeartbeatAt", "lastAttemptAt", "lastAccessAt"].includes(column.key) ? (
                            <span>{formatDateTime(row[column.key])}</span>
                          ) : (
                            <span>{row[column.key] || "—"}</span>
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
              </tbody>
            </DataTable>
            <DataTablePagination
              currentPage={usersPayload.page}
              pageSize={usersPayload.pageSize}
              totalItems={usersPayload.total}
              totalPages={usersPayload.totalPages}
              onPageChange={(nextPage) => updateSearchParams({ page: nextPage })}
              onPageSizeChange={(nextPageSize) => updateSearchParams({ pageSize: nextPageSize, page: 1 })}
            />
          </div>
        </>
      )}

      {activeTab === "activity" && (
        <>
          <FilterBar
            left={
              <>
                <input
                  type="date"
                  value={searchParams.get("aFrom") || ""}
                  onChange={(event) => updateSearchParams({ aFrom: event.target.value, aPage: 1 })}
                  className="rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
                />
                <input
                  type="date"
                  value={searchParams.get("aTo") || ""}
                  onChange={(event) => updateSearchParams({ aTo: event.target.value, aPage: 1 })}
                  className="rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
                />
                <input
                  value={searchParams.get("aUser") || ""}
                  onChange={(event) => updateSearchParams({ aUser: event.target.value, aPage: 1 })}
                  placeholder="Usuário"
                  className="min-w-[160px] rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white placeholder:text-white/50 focus:border-white/30 focus:outline-none"
                />
                <input
                  value={searchParams.get("aClient") || ""}
                  onChange={(event) => updateSearchParams({ aClient: event.target.value, aPage: 1 })}
                  placeholder="Cliente"
                  className="min-w-[160px] rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white placeholder:text-white/50 focus:border-white/30 focus:outline-none"
                />
                <input
                  value={searchParams.get("aVehicle") || ""}
                  onChange={(event) => updateSearchParams({ aVehicle: event.target.value, aPage: 1 })}
                  placeholder="Veículo"
                  className="min-w-[160px] rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white placeholder:text-white/50 focus:border-white/30 focus:outline-none"
                />
                <input
                  value={searchParams.get("aDevice") || ""}
                  onChange={(event) => updateSearchParams({ aDevice: event.target.value, aPage: 1 })}
                  placeholder="Dispositivo"
                  className="min-w-[160px] rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white placeholder:text-white/50 focus:border-white/30 focus:outline-none"
                />
                <input
                  value={searchParams.get("aMethod") || ""}
                  onChange={(event) => updateSearchParams({ aMethod: event.target.value, aPage: 1 })}
                  placeholder="Método"
                  className="min-w-[140px] rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white placeholder:text-white/50 focus:border-white/30 focus:outline-none"
                />
                <input
                  value={searchParams.get("aResult") || ""}
                  onChange={(event) => updateSearchParams({ aResult: event.target.value, aPage: 1 })}
                  placeholder="Resultado"
                  className="min-w-[140px] rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white placeholder:text-white/50 focus:border-white/30 focus:outline-none"
                />
              </>
            }
          />

          <div className="overflow-hidden rounded-xl border border-white/10 bg-[#0f141c]">
            <DataTable tableClassName="text-white/80">
              <thead className="bg-white/5 text-xs uppercase tracking-wide text-white/60">
                <tr>
                  <th className="px-4 py-3 text-left">Data</th>
                  <th className="px-4 py-3 text-left">Usuário</th>
                  <th className="px-4 py-3 text-left">Perfil</th>
                  <th className="px-4 py-3 text-left">Cliente</th>
                  <th className="px-4 py-3 text-left">Veículo</th>
                  <th className="px-4 py-3 text-left">Dispositivo</th>
                  <th className="px-4 py-3 text-left">Método</th>
                  <th className="px-4 py-3 text-left">Ação executada</th>
                  <th className="px-4 py-3 text-left">Resultado</th>
                  <th className="px-4 py-3 text-left">created_by</th>
                  <th className="px-4 py-3 text-left">used_by</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/10">
                {activityLoading && (
                  <tr>
                    <td colSpan={11} className="px-4 py-6 text-center text-white/60">
                      Carregando histórico...
                    </td>
                  </tr>
                )}
                {!activityLoading && activityPayload.data.length === 0 && (
                  <tr>
                    <td colSpan={11} className="px-4 py-6 text-center text-white/60">
                      Nenhum evento encontrado.
                    </td>
                  </tr>
                )}
                {!activityLoading &&
                  activityPayload.data.map((row) => (
                    <tr key={row.id} className="hover:bg-white/5">
                      <td className="px-4 py-3">{formatDateTime(row.createdAt)}</td>
                      <td className="px-4 py-3">{row.userName || "—"}</td>
                      <td className="px-4 py-3">{row.profile || "—"}</td>
                      <td className="px-4 py-3">{row.clientName || "—"}</td>
                      <td className="px-4 py-3">{row.vehicleLabel || "—"}</td>
                      <td className="px-4 py-3">{row.esp32Device || "—"}</td>
                      <td className="px-4 py-3">{row.method || "—"}</td>
                      <td className="px-4 py-3">{row.action || "—"}</td>
                      <td className="px-4 py-3">{row.result || "—"}</td>
                      <td className="px-4 py-3">{row.createdBy || "—"}</td>
                      <td className="px-4 py-3">{row.usedBy || "—"}</td>
                    </tr>
                  ))}
              </tbody>
            </DataTable>
            <DataTablePagination
              currentPage={activityPayload.page}
              pageSize={activityPayload.pageSize}
              totalItems={activityPayload.total}
              totalPages={activityPayload.totalPages}
              onPageChange={(nextPage) => updateSearchParams({ aPage: nextPage })}
              onPageSizeChange={(nextPageSize) => updateSearchParams({ aPageSize: nextPageSize, aPage: 1 })}
            />
          </div>
        </>
      )}

      {activeTab === "counter-key" && (
        <>
          <form onSubmit={createCounterKeyRow} className="rounded-xl border border-white/10 bg-white/5 p-4">
            <h3 className="mb-3 text-sm font-semibold text-white">Criar nova contra-senha</h3>
            <div className="grid gap-3 md:grid-cols-4">
              <select
                value={counterForm.userId}
                onChange={(event) => setCounterForm((current) => ({ ...current, userId: event.target.value }))}
                className="rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
                required
              >
                <option value="">1. Selecionar usuário</option>
                {options.users.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.name}
                  </option>
                ))}
              </select>

              <select
                value={counterForm.vehicleId}
                onChange={(event) => setCounterForm((current) => ({ ...current, vehicleId: event.target.value }))}
                className="rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
                required
              >
                <option value="">2. Selecionar veículo</option>
                {options.vehicles.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.label}
                  </option>
                ))}
              </select>

              <input
                value={counterForm.basePin}
                onChange={(event) => setCounterForm((current) => ({ ...current, basePin: event.target.value.replace(/\D/g, "").slice(0, 6) }))}
                placeholder="3. Senha de 6 dígitos"
                className="rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white placeholder:text-white/50 focus:border-white/30 focus:outline-none"
                required
              />

              <button
                type="submit"
                className="rounded-xl bg-sky-500 px-4 py-2 text-sm font-medium text-black transition hover:bg-sky-400 disabled:opacity-60"
                disabled={counterSaving}
              >
                {counterSaving ? "Salvando..." : "Gerar"}
              </button>
            </div>
          </form>

          <FilterBar
            left={
              <>
                <input
                  value={searchParams.get("kUser") || ""}
                  onChange={(event) => updateSearchParams({ kUser: event.target.value, kPage: 1 })}
                  placeholder="Usuário"
                  className="min-w-[180px] rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white placeholder:text-white/50 focus:border-white/30 focus:outline-none"
                />
                <input
                  value={searchParams.get("kVehicle") || ""}
                  onChange={(event) => updateSearchParams({ kVehicle: event.target.value, kPage: 1 })}
                  placeholder="Veículo"
                  className="min-w-[180px] rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white placeholder:text-white/50 focus:border-white/30 focus:outline-none"
                />
                <input
                  value={searchParams.get("kDevice") || ""}
                  onChange={(event) => updateSearchParams({ kDevice: event.target.value, kPage: 1 })}
                  placeholder="Dispositivo"
                  className="min-w-[180px] rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white placeholder:text-white/50 focus:border-white/30 focus:outline-none"
                />
                <select
                  value={searchParams.get("kStatus") || ""}
                  onChange={(event) => updateSearchParams({ kStatus: event.target.value || null, kPage: 1 })}
                  className="min-w-[160px] rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
                >
                  <option value="">Status</option>
                  <option value="ATIVA">ATIVA</option>
                  <option value="USADA">USADA</option>
                  <option value="EXPIRADA">EXPIRADA</option>
                  <option value="CANCELADA">CANCELADA</option>
                </select>
              </>
            }
          />

          <div className="overflow-hidden rounded-xl border border-white/10 bg-[#0f141c]">
            <DataTable tableClassName="text-white/80">
              <thead className="bg-white/5 text-xs uppercase tracking-wide text-white/60">
                <tr>
                  <th className="px-4 py-3 text-left">Data de criação</th>
                  <th className="px-4 py-3 text-left">Usuário que gerou</th>
                  <th className="px-4 py-3 text-left">Usuário alvo</th>
                  <th className="px-4 py-3 text-left">Cliente</th>
                  <th className="px-4 py-3 text-left">Veículo</th>
                  <th className="px-4 py-3 text-left">Dispositivo</th>
                  <th className="px-4 py-3 text-left">Senha base</th>
                  <th className="px-4 py-3 text-left">Contra-senha</th>
                  <th className="px-4 py-3 text-left">Status</th>
                  <th className="px-4 py-3 text-left">Número de usos</th>
                  <th className="px-4 py-3 text-left">Primeiro uso</th>
                  <th className="px-4 py-3 text-left">Último uso</th>
                  <th className="px-4 py-3 text-left">Usuário que utilizou</th>
                  <th className="px-4 py-3 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/10">
                {counterLoading && (
                  <tr>
                    <td colSpan={14} className="px-4 py-6 text-center text-white/60">
                      Carregando contra-senhas...
                    </td>
                  </tr>
                )}
                {!counterLoading && counterPayload.data.length === 0 && (
                  <tr>
                    <td colSpan={14} className="px-4 py-6 text-center text-white/60">
                      Nenhuma contra-senha encontrada.
                    </td>
                  </tr>
                )}
                {!counterLoading &&
                  counterPayload.data.map((row) => (
                    <tr key={row.id} className="hover:bg-white/5">
                      <td className="px-4 py-3">{formatDateTime(row.createdAt)}</td>
                      <td className="px-4 py-3">{row.createdBy || "—"}</td>
                      <td className="px-4 py-3">{row.targetUserName || row.userName || "—"}</td>
                      <td className="px-4 py-3">{row.clientName || "—"}</td>
                      <td className="px-4 py-3">{row.vehicleLabel || "—"}</td>
                      <td className="px-4 py-3">{row.esp32Device || "—"}</td>
                      <td className="px-4 py-3">{row.basePinMasked || "******"}</td>
                      <td className="px-4 py-3">{row.counterKey || "—"}</td>
                      <td className="px-4 py-3">
                        <span className="rounded-lg bg-white/10 px-2 py-1 text-xs text-white/90">{row.status || "—"}</span>
                      </td>
                      <td className="px-4 py-3">{row.usesCount ?? 0}</td>
                      <td className="px-4 py-3">{formatDateTime(row.firstUsedAt)}</td>
                      <td className="px-4 py-3">{formatDateTime(row.lastUsedAt)}</td>
                      <td className="px-4 py-3">{row.usedBy || "—"}</td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => markCounterUse(row)}
                            disabled={row.status !== "ATIVA"}
                            className="rounded-lg border border-white/10 px-2 py-1 text-xs text-white transition hover:border-white/30 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            Marcar uso
                          </button>
                          <button
                            type="button"
                            onClick={() => cancelCounter(row)}
                            disabled={row.status !== "ATIVA"}
                            className="rounded-lg border border-red-500/40 px-2 py-1 text-xs text-red-300 transition hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            Cancelar
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </DataTable>
            <DataTablePagination
              currentPage={counterPayload.page}
              pageSize={counterPayload.pageSize}
              totalItems={counterPayload.total}
              totalPages={counterPayload.totalPages}
              onPageChange={(nextPage) => updateSearchParams({ kPage: nextPage })}
              onPageSizeChange={(nextPageSize) => updateSearchParams({ kPageSize: nextPageSize, kPage: 1 })}
            />
          </div>
        </>
      )}

      <Drawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        title={drawerData?.summary?.userName || "Resumo do usuário"}
        description="Resumo do usuário, status atual e histórico de eventos do Trust Center."
      >
        {drawerLoading && <p className="text-sm text-white/70">Carregando detalhes...</p>}
        {!drawerLoading && !drawerData && <p className="text-sm text-white/70">Não foi possível carregar os detalhes.</p>}
        {!drawerLoading && drawerData && (
          <div className="space-y-4">
            <div className="rounded-xl border border-white/10 bg-white/5 p-4 text-sm text-white/80">
              <h4 className="mb-2 text-sm font-semibold text-white">Resumo do usuário</h4>
              <div className="grid gap-2 md:grid-cols-2">
                <p>
                  <span className="text-white/50">Nome:</span> {drawerData.summary?.userName || "—"}
                </p>
                <p>
                  <span className="text-white/50">Perfil:</span> {drawerData.summary?.profile || "—"}
                </p>
                <p>
                  <span className="text-white/50">Cliente:</span> {drawerData.summary?.clientName || "—"}
                </p>
                <p>
                  <span className="text-white/50">Dispositivo vinculado:</span> {drawerData.summary?.esp32Device || "—"}
                </p>
                <p>
                  <span className="text-white/50">Status atual:</span> {drawerData.summary?.state || "—"}
                </p>
              </div>
            </div>

            <SectionTabs
              tabs={[
                { id: "status", label: "Status" },
                { id: "history", label: "Histórico" },
              ]}
              activeTab={drawerTab}
              onChange={setDrawerTab}
            />

            {drawerTab === "status" && (
              <div className="rounded-xl border border-white/10 bg-white/5 p-4 text-sm text-white/80">
                <div className="grid gap-2 md:grid-cols-2">
                  <p>
                    <span className="text-white/50">Challenge:</span> {drawerData.status?.challenge || "—"}
                  </p>
                  <p>
                    <span className="text-white/50">Método de validação:</span> {drawerData.status?.validationMethod || "—"}
                  </p>
                  <p>
                    <span className="text-white/50">Resultado:</span> {drawerData.status?.result || "—"}
                  </p>
                  <p>
                    <span className="text-white/50">Dispositivo utilizado:</span> {drawerData.status?.device || "—"}
                  </p>
                </div>
              </div>
            )}

            {drawerTab === "history" && (
              <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                <div className="space-y-2">
                  {(drawerData.history || []).length === 0 && (
                    <p className="text-sm text-white/60">Sem eventos registrados para este usuário.</p>
                  )}
                  {(drawerData.history || []).map((event) => (
                    <div key={event.id} className="rounded-lg border border-white/10 bg-black/20 p-3 text-sm text-white/80">
                      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-white/60">
                        <span>{formatDateTime(event.createdAt)}</span>
                        <span>{event.action || "—"}</span>
                      </div>
                      <div className="mt-2 grid gap-2 md:grid-cols-2">
                        <p>
                          <span className="text-white/50">Resultado:</span> {event.result || "—"}
                        </p>
                        <p>
                          <span className="text-white/50">Estado:</span> {event.state || "—"}
                        </p>
                        <p>
                          <span className="text-white/50">created_by:</span> {event.createdBy || "—"}
                        </p>
                        <p>
                          <span className="text-white/50">used_by:</span> {event.usedBy || "—"}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </Drawer>

      <Drawer
        open={simulateOpen}
        onClose={() => setSimulateOpen(false)}
        title="Simular contra-senha"
        description="Informe a senha base e opcionalmente challenge/usuário/veículo para simular o cálculo."
      >
        <form onSubmit={handleSimulate} className="space-y-3">
          <input
            value={simulateForm.basePin}
            onChange={(event) =>
              setSimulateForm((current) => ({ ...current, basePin: event.target.value.replace(/\D/g, "").slice(0, 6) }))
            }
            placeholder="Senha base (6 dígitos)"
            className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white placeholder:text-white/50 focus:border-white/30 focus:outline-none"
            required
          />
          <input
            value={simulateForm.challenge}
            onChange={(event) => setSimulateForm((current) => ({ ...current, challenge: event.target.value }))}
            placeholder="Challenge (opcional)"
            className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white placeholder:text-white/50 focus:border-white/30 focus:outline-none"
          />
          <select
            value={simulateForm.userId}
            onChange={(event) => setSimulateForm((current) => ({ ...current, userId: event.target.value }))}
            className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
          >
            <option value="">Usuário (opcional)</option>
            {options.users.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.name}
              </option>
            ))}
          </select>
          <select
            value={simulateForm.vehicleId}
            onChange={(event) => setSimulateForm((current) => ({ ...current, vehicleId: event.target.value }))}
            className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
          >
            <option value="">Veículo (opcional)</option>
            {options.vehicles.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.label}
              </option>
            ))}
          </select>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setSimulateOpen(false)}
              className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-white transition hover:border-white/30"
            >
              Fechar
            </button>
            <button
              type="submit"
              disabled={simulateLoading}
              className="rounded-xl bg-sky-500 px-4 py-2 text-sm font-medium text-black transition hover:bg-sky-400 disabled:opacity-60"
            >
              {simulateLoading ? "Calculando..." : "Simular"}
            </button>
          </div>
        </form>

        {simulateResult && (
          <div className="mt-4 rounded-xl border border-sky-400/30 bg-sky-500/10 p-4 text-sm text-sky-100">
            <p>
              <span className="font-semibold">Challenge:</span> {simulateResult.challenge}
            </p>
            <p>
              <span className="font-semibold">Contra-senha:</span> {simulateResult.counterKey}
            </p>
          </div>
        )}
      </Drawer>

      <div className="rounded-xl border border-sky-400/20 bg-sky-500/5 px-4 py-3 text-xs text-sky-100/80">
        <span className="inline-flex items-center gap-2">
          <Shield className="h-4 w-4" />
          Este módulo opera exclusivamente no source e segue fluxo de build/deploy com validação de SHA e versionamento.
        </span>
      </div>
    </div>
  );
}
