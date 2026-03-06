import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { Download, RefreshCw, RotateCw, Shield, Sparkles } from "lucide-react";

import api from "../lib/api.js";
import { API_ROUTES } from "../lib/api-routes.js";
import { useTenant } from "../lib/tenant-context.jsx";
import { usePermissionGate } from "../lib/permissions/permission-gate.js";
import PageHeader from "../components/ui/PageHeader.jsx";
import FilterBar from "../components/ui/FilterBar.jsx";
import DataTable from "../components/ui/DataTable.jsx";
import EmptyState from "../components/ui/EmptyState.jsx";
import DataTablePagination from "../ui/DataTablePagination.jsx";
import Modal from "../ui/Modal.jsx";

const TAB_USERS = "users";
const TAB_ACTIVITY = "activity";
const TAB_COUNTER_KEY = "counter-key";

const USERS_COLUMNS = [
  { key: "state", label: "Estado", required: true },
  { key: "userName", label: "Usuario" },
  { key: "userRole", label: "Perfil" },
  { key: "clientName", label: "Cliente" },
  { key: "vehicleLabel", label: "Veiculo" },
  { key: "esp32DeviceId", label: "Dispositivo ESP32" },
  { key: "challenge", label: "Challenge" },
  { key: "validationMethod", label: "Metodo" },
  { key: "lastActionType", label: "Acao" },
  { key: "lastResult", label: "Resultado" },
  { key: "lastPasswordLast6", label: "Senha (6d)" },
  { key: "lastHeartbeatAt", label: "Ultimo heartbeat" },
  { key: "lastAttemptAt", label: "Ultima tentativa" },
  { key: "lastAccessAt", label: "Ultimo acesso" },
  { key: "updatedAt", label: "Atualizado em" },
];

const ACTIVITY_COLUMNS_BASE = [
  { key: "createdAt", label: "Data" },
  { key: "userName", label: "Usuario" },
  { key: "userRole", label: "Perfil" },
  { key: "clientName", label: "Cliente" },
  { key: "vehicleLabel", label: "Veiculo" },
  { key: "esp32DeviceId", label: "Dispositivo" },
  { key: "method", label: "Metodo" },
  { key: "action", label: "Acao executada" },
  { key: "result", label: "Resultado" },
  { key: "createdBy", label: "created_by" },
  { key: "usedBy", label: "used_by" },
];

const COUNTER_KEY_COLUMNS = [
  { key: "createdAt", label: "Data de criacao" },
  { key: "createdBy", label: "Usuario que gerou" },
  { key: "userName", label: "Usuario alvo" },
  { key: "clientName", label: "Cliente" },
  { key: "vehicleLabel", label: "Veiculo" },
  { key: "esp32DeviceId", label: "Dispositivo" },
  { key: "basePasswordMasked", label: "Senha base" },
  { key: "counterKey", label: "Contra-senha" },
  { key: "status", label: "Status" },
  { key: "usesCount", label: "Numero de usos" },
  { key: "firstUsedAt", label: "Primeiro uso" },
  { key: "lastUsedAt", label: "Ultimo uso" },
  { key: "usedBy", label: "Usuario que utilizou" },
  { key: "expiresAt", label: "Expira em" },
];

function formatDateTime(value) {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "-";
  return parsed.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function toNumber(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function resolveVehicleLabel(row) {
  if (!row) return "-";
  if (row.vehiclePlate) return row.vehiclePlate;
  if (row.vehicleName) return row.vehicleName;
  return row.vehicleId || "-";
}

function resolveActiveTab(pathname) {
  if (pathname.includes("/trust-center/activity")) return TAB_ACTIVITY;
  if (pathname.includes("/trust-center/counter-key")) return TAB_COUNTER_KEY;
  return TAB_USERS;
}

function parseSearchInt(searchParams, key, fallback) {
  return Math.max(1, toNumber(searchParams.get(key), fallback));
}

function useSearchPatch(searchParams, setSearchParams) {
  return useCallback(
    (patch, { resetPageKey = null } = {}) => {
      const next = new URLSearchParams(searchParams);
      Object.entries(patch || {}).forEach(([key, value]) => {
        const normalized = String(value ?? "").trim();
        if (!normalized) {
          next.delete(key);
        } else {
          next.set(key, normalized);
        }
      });
      if (resetPageKey && !Object.prototype.hasOwnProperty.call(patch, resetPageKey)) {
        next.set(resetPageKey, "1");
      }
      setSearchParams(next);
    },
    [searchParams, setSearchParams],
  );
}

function Drawer({ open, onClose, children, title, subtitle }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[9999] flex">
      <button
        type="button"
        className="flex-1 bg-black/45"
        onClick={onClose}
        aria-label="Fechar painel"
      />
      <aside className="h-full w-full max-w-2xl border-l border-white/10 bg-[#0f141c] shadow-2xl">
        <header className="flex items-start justify-between gap-3 border-b border-white/10 p-5">
          <div>
            <p className="text-xs uppercase tracking-[0.14em] text-white/50">Trust Center</p>
            <h2 className="text-xl font-semibold text-white">{title}</h2>
            {subtitle ? <p className="text-sm text-white/70">{subtitle}</p> : null}
          </div>
          <button
            type="button"
            className="rounded-lg border border-white/20 px-3 py-1 text-sm text-white/80 hover:border-white/40"
            onClick={onClose}
          >
            Fechar
          </button>
        </header>
        <div className="h-[calc(100%-92px)] overflow-y-auto p-5">{children}</div>
      </aside>
    </div>
  );
}

function SectionTitle({ children }) {
  return <h3 className="text-xs uppercase tracking-[0.12em] text-white/50">{children}</h3>;
}

function TrustCenterUsersTable({
  rows,
  visibleColumns,
  loading,
  sortBy,
  sortDir,
  onSort,
  onRowClick,
}) {
  const columns = USERS_COLUMNS.filter((column) => column.required || visibleColumns[column.key]);

  return (
    <DataTable className="rounded-xl border border-white/10 bg-[#0b0f17]" tableClassName="min-w-[1500px]">
      <thead>
        <tr className="border-b border-white/10 text-left text-xs uppercase tracking-[0.1em] text-white/60">
          {columns.map((column) => {
            const isSorted = sortBy === column.key;
            return (
              <th key={column.key} className="px-3 py-3">
                <button
                  type="button"
                  className="inline-flex items-center gap-2 text-left hover:text-white"
                  onClick={() => onSort(column.key)}
                >
                  {column.label}
                  <span className="text-[10px] text-white/40">{isSorted ? (sortDir === "ASC" ? "ASC" : "DESC") : ""}</span>
                </button>
              </th>
            );
          })}
        </tr>
      </thead>
      <tbody>
        {loading ? (
          <tr>
            <td colSpan={columns.length} className="px-4 py-8 text-center text-sm text-white/60">
              Carregando usuarios...
            </td>
          </tr>
        ) : rows.length === 0 ? (
          <tr>
            <td colSpan={columns.length} className="px-4 py-8 text-center text-sm text-white/60">
              Nenhum registro encontrado.
            </td>
          </tr>
        ) : (
          rows.map((row) => (
            <tr
              key={`${row.userId}-${row.esp32DeviceId}-${row.id}`}
              className="cursor-pointer border-b border-white/5 text-sm text-white/90 hover:bg-white/5"
              onClick={() => onRowClick(row)}
            >
              {columns.map((column) => {
                const value = (() => {
                  if (column.key === "vehicleLabel") return resolveVehicleLabel(row);
                  if (["lastHeartbeatAt", "lastAttemptAt", "lastAccessAt", "updatedAt"].includes(column.key)) {
                    return formatDateTime(row[column.key]);
                  }
                  return row[column.key] ?? "-";
                })();
                return (
                  <td key={`${row.id}-${column.key}`} className="px-3 py-3 align-top">
                    {value || "-"}
                  </td>
                );
              })}
            </tr>
          ))
        )}
      </tbody>
    </DataTable>
  );
}

function TrustCenter() {
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const patchSearch = useSearchPatch(searchParams, setSearchParams);
  const activeTab = resolveActiveTab(location.pathname);

  const { tenantId, tenantScope, homeClientId, user } = useTenant();
  const viewPermission = usePermissionGate({ menuKey: "admin", pageKey: "trust-center" });
  const activityPermission = usePermissionGate({ menuKey: "admin", pageKey: "trust-center", subKey: "activity" });
  const counterKeyPermission = usePermissionGate({ menuKey: "admin", pageKey: "trust-center", subKey: "counter-key" });

  const resolvedClientId = useMemo(() => {
    if (tenantScope !== "ALL") return tenantId || user?.clientId || null;
    return homeClientId || tenantId || user?.clientId || null;
  }, [homeClientId, tenantId, tenantScope, user?.clientId]);

  useEffect(() => {
    if (location.pathname === "/trust-center") {
      const query = searchParams.toString();
      navigate(`/trust-center/users${query ? `?${query}` : ""}`, { replace: true });
    }
  }, [location.pathname, navigate, searchParams]);

  const [tabError, setTabError] = useState(null);

  const usersFilters = useMemo(
    () => ({
      user: searchParams.get("u_user") || "",
      device: searchParams.get("u_device") || "",
      password: searchParams.get("u_password") || "",
      actionType: searchParams.get("u_actionType") || "",
      result: searchParams.get("u_result") || "",
      page: parseSearchInt(searchParams, "u_page", 1),
      pageSize: parseSearchInt(searchParams, "u_pageSize", 20),
      sortBy: searchParams.get("u_sortBy") || "",
      sortDir: (searchParams.get("u_sortDir") || "DESC").toUpperCase() === "ASC" ? "ASC" : "DESC",
    }),
    [searchParams],
  );

  const activityFilters = useMemo(
    () => ({
      dateFrom: searchParams.get("a_dateFrom") || "",
      dateTo: searchParams.get("a_dateTo") || "",
      user: searchParams.get("a_user") || "",
      client: searchParams.get("a_client") || "",
      vehicle: searchParams.get("a_vehicle") || "",
      device: searchParams.get("a_device") || "",
      method: searchParams.get("a_method") || "",
      result: searchParams.get("a_result") || "",
      page: parseSearchInt(searchParams, "a_page", 1),
      pageSize: parseSearchInt(searchParams, "a_pageSize", 25),
      sortBy: searchParams.get("a_sortBy") || "date",
      sortDir: (searchParams.get("a_sortDir") || "DESC").toUpperCase() === "ASC" ? "ASC" : "DESC",
    }),
    [searchParams],
  );

  const counterFilters = useMemo(
    () => ({
      user: searchParams.get("k_user") || "",
      vehicle: searchParams.get("k_vehicle") || "",
      device: searchParams.get("k_device") || "",
      status: searchParams.get("k_status") || "",
      page: parseSearchInt(searchParams, "k_page", 1),
      pageSize: parseSearchInt(searchParams, "k_pageSize", 20),
      sortBy: searchParams.get("k_sortBy") || "createdAt",
      sortDir: (searchParams.get("k_sortDir") || "DESC").toUpperCase() === "ASC" ? "ASC" : "DESC",
    }),
    [searchParams],
  );

  const usersColumnsStorageKey = useMemo(
    () => `trust-center:users-columns:${user?.id || "anon"}:${resolvedClientId || "all"}`,
    [resolvedClientId, user?.id],
  );

  const [showUsersColumnPicker, setShowUsersColumnPicker] = useState(false);
  const [usersColumnsVisibility, setUsersColumnsVisibility] = useState(() => {
    try {
      if (typeof window === "undefined") return {};
      const raw = window.localStorage.getItem(usersColumnsStorageKey);
      return raw ? JSON.parse(raw) : {};
    } catch (_error) {
      return {};
    }
  });

  useEffect(() => {
    try {
      if (typeof window === "undefined") return;
      window.localStorage.setItem(usersColumnsStorageKey, JSON.stringify(usersColumnsVisibility || {}));
    } catch (_error) {
      // ignore
    }
  }, [usersColumnsStorageKey, usersColumnsVisibility]);

  useEffect(() => {
    try {
      if (typeof window === "undefined") return;
      const raw = window.localStorage.getItem(usersColumnsStorageKey);
      setUsersColumnsVisibility(raw ? JSON.parse(raw) : {});
    } catch (_error) {
      setUsersColumnsVisibility({});
    }
  }, [usersColumnsStorageKey]);

  const [usersRows, setUsersRows] = useState([]);
  const [usersPagination, setUsersPagination] = useState({ page: 1, pageSize: 20, total: 0, totalPages: 1 });
  const [usersLoading, setUsersLoading] = useState(false);

  const [detailsOpen, setDetailsOpen] = useState(false);
  const [detailsTab, setDetailsTab] = useState("status");
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [detailsSummary, setDetailsSummary] = useState(null);
  const [detailsHistory, setDetailsHistory] = useState([]);

  const [rotateOpen, setRotateOpen] = useState(false);
  const [simulateOpen, setSimulateOpen] = useState(false);
  const [rotateForm, setRotateForm] = useState({ userId: "", vehicleId: "", esp32DeviceId: "" });
  const [simulateForm, setSimulateForm] = useState({
    userId: "",
    vehicleId: "",
    esp32DeviceId: "",
    password: "",
    challenge: "",
  });
  const [simulateResult, setSimulateResult] = useState(null);

  const [activityRows, setActivityRows] = useState([]);
  const [activityPagination, setActivityPagination] = useState({ page: 1, pageSize: 25, total: 0, totalPages: 1 });
  const [activityLoading, setActivityLoading] = useState(false);
  const [activityEspColumns, setActivityEspColumns] = useState([]);

  const [counterRows, setCounterRows] = useState([]);
  const [counterPagination, setCounterPagination] = useState({ page: 1, pageSize: 20, total: 0, totalPages: 1 });
  const [counterLoading, setCounterLoading] = useState(false);

  const [counterModalOpen, setCounterModalOpen] = useState(false);
  const [counterForm, setCounterForm] = useState({ userId: "", vehicleId: "", esp32DeviceId: "", password: "" });
  const [userOptions, setUserOptions] = useState([]);
  const [vehicleOptions, setVehicleOptions] = useState([]);

  const loadSelectorOptions = useCallback(async () => {
    if (!resolvedClientId) return;
    try {
      const [usersResponse, vehiclesResponse] = await Promise.all([
        api.get(API_ROUTES.users, {
          params: { clientId: resolvedClientId, limit: 1000, pageSize: 1000 },
        }),
        api.get(API_ROUTES.core.vehicles, {
          params: { clientId: resolvedClientId, pageSize: 1000, page: 1 },
        }),
      ]);

      const usersPayload = usersResponse?.data;
      const usersRowsRaw =
        usersPayload?.rows || usersPayload?.users || usersPayload?.items || usersPayload?.data || [];
      const vehiclesPayload = vehiclesResponse?.data;
      const vehiclesRowsRaw =
        vehiclesPayload?.rows || vehiclesPayload?.vehicles || vehiclesPayload?.items || vehiclesPayload?.data || [];

      setUserOptions(Array.isArray(usersRowsRaw) ? usersRowsRaw : []);
      setVehicleOptions(Array.isArray(vehiclesRowsRaw) ? vehiclesRowsRaw : []);
    } catch (error) {
      console.error("[trust-center] erro ao carregar opcoes", error);
    }
  }, [resolvedClientId]);

  const loadUsers = useCallback(async () => {
    if (!resolvedClientId) return;
    setUsersLoading(true);
    setTabError(null);
    try {
      const response = await api.get(API_ROUTES.trustCenter.users, {
        params: {
          clientId: resolvedClientId,
          user: usersFilters.user || undefined,
          device: usersFilters.device || undefined,
          password: usersFilters.password || undefined,
          actionType: usersFilters.actionType || undefined,
          result: usersFilters.result || undefined,
          page: usersFilters.page,
          pageSize: usersFilters.pageSize,
          sortBy: usersFilters.sortBy || undefined,
          sortDir: usersFilters.sortDir,
        },
      });
      const payload = response?.data || {};
      setUsersRows(Array.isArray(payload.rows) ? payload.rows : []);
      setUsersPagination(payload.pagination || { page: 1, pageSize: 20, total: 0, totalPages: 1 });
    } catch (error) {
      setTabError(error?.message || "Falha ao carregar usuarios do Trust Center.");
    } finally {
      setUsersLoading(false);
    }
  }, [resolvedClientId, usersFilters]);

  const openUserDetails = useCallback(
    async (row) => {
      if (!resolvedClientId || !row?.userId) return;
      setDetailsTab("status");
      setDetailsOpen(true);
      setDetailsLoading(true);
      setDetailsSummary(null);
      setDetailsHistory([]);
      setRotateForm({
        userId: row.userId || "",
        vehicleId: row.vehicleId || "",
        esp32DeviceId: row.esp32DeviceId || "",
      });
      setSimulateForm({
        userId: row.userId || "",
        vehicleId: row.vehicleId || "",
        esp32DeviceId: row.esp32DeviceId || "",
        password: "",
        challenge: row.challenge || "",
      });
      try {
        const response = await api.get(API_ROUTES.trustCenter.userSummary(row.userId), {
          params: {
            clientId: resolvedClientId,
            esp32DeviceId: row.esp32DeviceId || undefined,
          },
        });
        setDetailsSummary(response?.data?.summary || null);
        setDetailsHistory(Array.isArray(response?.data?.history) ? response.data.history : []);
      } catch (error) {
        setTabError(error?.message || "Falha ao carregar painel lateral.");
      } finally {
        setDetailsLoading(false);
      }
    },
    [resolvedClientId],
  );

  const loadActivity = useCallback(async () => {
    if (!resolvedClientId) return;
    setActivityLoading(true);
    setTabError(null);
    try {
      const response = await api.get(API_ROUTES.trustCenter.activity, {
        params: {
          clientId: resolvedClientId,
          dateFrom: activityFilters.dateFrom || undefined,
          dateTo: activityFilters.dateTo || undefined,
          user: activityFilters.user || undefined,
          client: activityFilters.client || undefined,
          vehicle: activityFilters.vehicle || undefined,
          device: activityFilters.device || undefined,
          method: activityFilters.method || undefined,
          result: activityFilters.result || undefined,
          page: activityFilters.page,
          pageSize: activityFilters.pageSize,
          sortBy: activityFilters.sortBy,
          sortDir: activityFilters.sortDir,
        },
      });
      const payload = response?.data || {};
      const rows = Array.isArray(payload.rows) ? payload.rows : [];
      setActivityRows(rows);
      setActivityPagination(payload.pagination || { page: 1, pageSize: 25, total: 0, totalPages: 1 });

      const espColumns = new Set();
      rows.forEach((row) => {
        const columns = row?.esp32Columns && typeof row.esp32Columns === "object" ? row.esp32Columns : {};
        Object.keys(columns).forEach((key) => {
          if (String(key).toLowerCase().startsWith("esp32_")) {
            espColumns.add(key);
          }
        });
      });
      setActivityEspColumns(Array.from(espColumns).sort((left, right) => left.localeCompare(right)));
    } catch (error) {
      setTabError(error?.message || "Falha ao carregar historico de auditoria.");
    } finally {
      setActivityLoading(false);
    }
  }, [activityFilters, resolvedClientId]);

  const loadCounterKeys = useCallback(async () => {
    if (!resolvedClientId) return;
    setCounterLoading(true);
    setTabError(null);
    try {
      const response = await api.get(API_ROUTES.trustCenter.counterKeys, {
        params: {
          clientId: resolvedClientId,
          user: counterFilters.user || undefined,
          vehicle: counterFilters.vehicle || undefined,
          device: counterFilters.device || undefined,
          status: counterFilters.status || undefined,
          page: counterFilters.page,
          pageSize: counterFilters.pageSize,
          sortBy: counterFilters.sortBy,
          sortDir: counterFilters.sortDir,
        },
      });
      const payload = response?.data || {};
      setCounterRows(Array.isArray(payload.rows) ? payload.rows : []);
      setCounterPagination(payload.pagination || { page: 1, pageSize: 20, total: 0, totalPages: 1 });
    } catch (error) {
      setTabError(error?.message || "Falha ao carregar contra-senhas.");
    } finally {
      setCounterLoading(false);
    }
  }, [counterFilters, resolvedClientId]);

  useEffect(() => {
    if (!resolvedClientId) return;
    if (activeTab === TAB_USERS) {
      loadUsers();
    } else if (activeTab === TAB_ACTIVITY) {
      loadActivity();
    } else if (activeTab === TAB_COUNTER_KEY) {
      loadCounterKeys();
      loadSelectorOptions();
    }
  }, [
    activeTab,
    loadActivity,
    loadCounterKeys,
    loadSelectorOptions,
    loadUsers,
    resolvedClientId,
  ]);

  const tabs = useMemo(
    () => [
      {
        key: TAB_USERS,
        label: "Usuarios",
        to: "/trust-center/users",
        enabled: viewPermission.canShow,
      },
      {
        key: TAB_ACTIVITY,
        label: "Historico",
        to: "/trust-center/activity",
        enabled: activityPermission.canShow,
      },
      {
        key: TAB_COUNTER_KEY,
        label: "Contra-senha",
        to: "/trust-center/counter-key",
        enabled: counterKeyPermission.canShow,
      },
    ],
    [activityPermission.canShow, counterKeyPermission.canShow, viewPermission.canShow],
  );

  const switchTab = (tabPath) => {
    const query = searchParams.toString();
    navigate(`${tabPath}${query ? `?${query}` : ""}`);
  };

  const handleUsersSort = (columnKey) => {
    const nextDir = usersFilters.sortBy === columnKey && usersFilters.sortDir === "ASC" ? "DESC" : "ASC";
    patchSearch(
      {
        u_sortBy: columnKey,
        u_sortDir: nextDir,
      },
      { resetPageKey: "u_page" },
    );
  };

  const handleActivitySort = (columnKey) => {
    const nextDir = activityFilters.sortBy === columnKey && activityFilters.sortDir === "ASC" ? "DESC" : "ASC";
    patchSearch(
      {
        a_sortBy: columnKey,
        a_sortDir: nextDir,
      },
      { resetPageKey: "a_page" },
    );
  };

  const handleCounterSort = (columnKey) => {
    const nextDir = counterFilters.sortBy === columnKey && counterFilters.sortDir === "ASC" ? "DESC" : "ASC";
    patchSearch(
      {
        k_sortBy: columnKey,
        k_sortDir: nextDir,
      },
      { resetPageKey: "k_page" },
    );
  };

  const performRotateChallenge = async () => {
    if (!resolvedClientId) return;
    if (!rotateForm.userId || !rotateForm.esp32DeviceId) {
      setTabError("Informe usuario e dispositivo ESP32 para rotacionar o challenge.");
      return;
    }
    setTabError(null);
    try {
      await api.post(API_ROUTES.trustCenter.challengeRotate, {
        clientId: resolvedClientId,
        userId: rotateForm.userId,
        vehicleId: rotateForm.vehicleId || undefined,
        esp32DeviceId: rotateForm.esp32DeviceId,
      });
      setRotateOpen(false);
      if (activeTab === TAB_USERS) {
        loadUsers();
      }
    } catch (error) {
      setTabError(error?.message || "Falha ao rotacionar challenge.");
    }
  };

  const performSimulation = async () => {
    if (!resolvedClientId) return;
    if (!simulateForm.userId || !simulateForm.esp32DeviceId || !/^\d{6}$/.test(simulateForm.password)) {
      setTabError("Simulacao exige usuario, dispositivo ESP32 e senha de 6 digitos.");
      return;
    }
    setTabError(null);
    try {
      const response = await api.post(API_ROUTES.trustCenter.simulate, {
        clientId: resolvedClientId,
        userId: simulateForm.userId,
        vehicleId: simulateForm.vehicleId || undefined,
        esp32DeviceId: simulateForm.esp32DeviceId,
        password: simulateForm.password,
        challenge: simulateForm.challenge || undefined,
      });
      setSimulateResult(response?.data || null);
    } catch (error) {
      setTabError(error?.message || "Falha ao simular contra-senha.");
    }
  };

  const createCounterKey = async () => {
    if (!resolvedClientId) return;
    if (!counterForm.userId || !counterForm.vehicleId || !counterForm.esp32DeviceId || !/^\d{6}$/.test(counterForm.password)) {
      setTabError("Crie a contra-senha selecionando usuario, veiculo, dispositivo e senha de 6 digitos.");
      return;
    }
    setTabError(null);
    try {
      await api.post(API_ROUTES.trustCenter.counterKeys, {
        clientId: resolvedClientId,
        userId: counterForm.userId,
        vehicleId: counterForm.vehicleId,
        esp32DeviceId: counterForm.esp32DeviceId,
        password: counterForm.password,
      });
      setCounterModalOpen(false);
      setCounterForm({ userId: "", vehicleId: "", esp32DeviceId: "", password: "" });
      loadCounterKeys();
      loadUsers();
    } catch (error) {
      setTabError(error?.message || "Falha ao criar contra-senha.");
    }
  };

  const registerCounterKeyUse = async (row) => {
    if (!resolvedClientId || !row?.counterKey) return;
    const confirmed = window.confirm(`Registrar uso da contra-senha ${row.counterKey}?`);
    if (!confirmed) return;
    try {
      await api.post(API_ROUTES.trustCenter.counterKeyUse, {
        clientId: resolvedClientId,
        counterKey: row.counterKey,
        usedBy: user?.id || undefined,
      });
      loadCounterKeys();
      loadUsers();
    } catch (error) {
      setTabError(error?.message || "Falha ao registrar uso.");
    }
  };

  const cancelCounterKey = async (row) => {
    if (!resolvedClientId || !row?.id) return;
    const confirmed = window.confirm("Cancelar esta contra-senha?");
    if (!confirmed) return;
    try {
      await api.post(API_ROUTES.trustCenter.counterKeyCancel(row.id), {
        clientId: resolvedClientId,
      });
      loadCounterKeys();
    } catch (error) {
      setTabError(error?.message || "Falha ao cancelar contra-senha.");
    }
  };

  const exportActivity = async () => {
    if (!resolvedClientId) return;
    try {
      const response = await api.get(API_ROUTES.trustCenter.activityExport, {
        responseType: "blob",
        params: {
          clientId: resolvedClientId,
          dateFrom: activityFilters.dateFrom || undefined,
          dateTo: activityFilters.dateTo || undefined,
          user: activityFilters.user || undefined,
          client: activityFilters.client || undefined,
          vehicle: activityFilters.vehicle || undefined,
          device: activityFilters.device || undefined,
          method: activityFilters.method || undefined,
          result: activityFilters.result || undefined,
          sortBy: activityFilters.sortBy,
          sortDir: activityFilters.sortDir,
        },
      });
      const blob = response?.data;
      if (!(blob instanceof Blob)) return;
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `trust-center-activity-${Date.now()}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (error) {
      setTabError(error?.message || "Falha ao exportar historico.");
    }
  };

  const renderUsersTab = () => (
    <div className="space-y-3">
      <FilterBar
        left={(
          <>
            <input
              value={usersFilters.user}
              onChange={(event) => patchSearch({ u_user: event.target.value }, { resetPageKey: "u_page" })}
              placeholder="usuario"
              className="min-w-[170px] rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white"
            />
            <input
              value={usersFilters.device}
              onChange={(event) => patchSearch({ u_device: event.target.value }, { resetPageKey: "u_page" })}
              placeholder="dispositivo ESP32"
              className="min-w-[180px] rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white"
            />
            <input
              value={usersFilters.password}
              onChange={(event) => patchSearch({ u_password: event.target.value }, { resetPageKey: "u_page" })}
              placeholder="senha (6 digitos)"
              maxLength={6}
              className="w-[140px] rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white"
            />
            <input
              value={usersFilters.actionType}
              onChange={(event) => patchSearch({ u_actionType: event.target.value }, { resetPageKey: "u_page" })}
              placeholder="tipo de acao"
              className="min-w-[160px] rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white"
            />
            <input
              value={usersFilters.result}
              onChange={(event) => patchSearch({ u_result: event.target.value }, { resetPageKey: "u_page" })}
              placeholder="resultado"
              className="min-w-[130px] rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white"
            />
          </>
        )}
        right={(
          <>
            <button
              type="button"
              className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/90 hover:border-white/30"
              onClick={() => setShowUsersColumnPicker((prev) => !prev)}
            >
              Colunas
            </button>
            <button
              type="button"
              className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/90 hover:border-white/30"
              onClick={() => loadUsers()}
            >
              <RefreshCw size={16} /> Atualizar
            </button>
            <button
              type="button"
              className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/90 hover:border-white/30"
              onClick={() => setRotateOpen(true)}
            >
              <RotateCw size={16} /> Rotacionar challenge
            </button>
            <button
              type="button"
              className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/90 hover:border-white/30"
              onClick={() => {
                setSimulateResult(null);
                setSimulateOpen(true);
              }}
            >
              <Sparkles size={16} /> Simular contra-senha
            </button>
          </>
        )}
      />

      {showUsersColumnPicker ? (
        <div className="flex flex-wrap gap-4 rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-xs text-white/90">
          {USERS_COLUMNS.filter((column) => !column.required).map((column) => (
            <label key={column.key} className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={Boolean(usersColumnsVisibility[column.key])}
                onChange={() =>
                  setUsersColumnsVisibility((current) => ({
                    ...current,
                    [column.key]: !current[column.key],
                  }))
                }
              />
              {column.label}
            </label>
          ))}
        </div>
      ) : null}

      <TrustCenterUsersTable
        rows={usersRows}
        visibleColumns={usersColumnsVisibility}
        loading={usersLoading}
        sortBy={usersFilters.sortBy}
        sortDir={usersFilters.sortDir}
        onSort={handleUsersSort}
        onRowClick={openUserDetails}
      />

      <DataTablePagination
        pageSize={usersPagination.pageSize}
        currentPage={usersPagination.page}
        totalPages={usersPagination.totalPages}
        totalItems={usersPagination.total}
        onPageSizeChange={(value) =>
          patchSearch({ u_pageSize: String(value), u_page: "1" }, { resetPageKey: "u_page" })
        }
        onPageChange={(value) => patchSearch({ u_page: String(value) })}
      />
    </div>
  );

  const renderActivityTab = () => {
    const columns = [
      ...ACTIVITY_COLUMNS_BASE,
      ...activityEspColumns.map((columnKey) => ({ key: `esp:${columnKey}`, label: columnKey })),
    ];

    return (
      <div className="space-y-3">
        <FilterBar
          left={(
            <>
              <input
                type="datetime-local"
                value={activityFilters.dateFrom}
                onChange={(event) => patchSearch({ a_dateFrom: event.target.value }, { resetPageKey: "a_page" })}
                className="rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white"
              />
              <input
                type="datetime-local"
                value={activityFilters.dateTo}
                onChange={(event) => patchSearch({ a_dateTo: event.target.value }, { resetPageKey: "a_page" })}
                className="rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white"
              />
              <input
                value={activityFilters.user}
                onChange={(event) => patchSearch({ a_user: event.target.value }, { resetPageKey: "a_page" })}
                placeholder="usuario"
                className="min-w-[130px] rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white"
              />
              <input
                value={activityFilters.client}
                onChange={(event) => patchSearch({ a_client: event.target.value }, { resetPageKey: "a_page" })}
                placeholder="cliente"
                className="min-w-[130px] rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white"
              />
              <input
                value={activityFilters.vehicle}
                onChange={(event) => patchSearch({ a_vehicle: event.target.value }, { resetPageKey: "a_page" })}
                placeholder="veiculo"
                className="min-w-[130px] rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white"
              />
              <input
                value={activityFilters.device}
                onChange={(event) => patchSearch({ a_device: event.target.value }, { resetPageKey: "a_page" })}
                placeholder="dispositivo"
                className="min-w-[130px] rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white"
              />
              <input
                value={activityFilters.method}
                onChange={(event) => patchSearch({ a_method: event.target.value }, { resetPageKey: "a_page" })}
                placeholder="metodo"
                className="min-w-[120px] rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white"
              />
              <input
                value={activityFilters.result}
                onChange={(event) => patchSearch({ a_result: event.target.value }, { resetPageKey: "a_page" })}
                placeholder="resultado"
                className="min-w-[120px] rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white"
              />
            </>
          )}
          right={(
            <>
              <button
                type="button"
                className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/90 hover:border-white/30"
                onClick={() => loadActivity()}
              >
                <RefreshCw size={16} /> Atualizar
              </button>
              <button
                type="button"
                className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/90 hover:border-white/30"
                onClick={exportActivity}
              >
                <Download size={16} /> Exportar
              </button>
            </>
          )}
        />

        <DataTable className="rounded-xl border border-white/10 bg-[#0b0f17]" tableClassName="min-w-[1500px]">
          <thead>
            <tr className="border-b border-white/10 text-left text-xs uppercase tracking-[0.1em] text-white/60">
              {columns.map((column) => (
                <th key={column.key} className="px-3 py-3">
                  <button
                    type="button"
                    className="inline-flex items-center gap-2 text-left hover:text-white"
                    onClick={() => {
                      if (!String(column.key).startsWith("esp:")) {
                        handleActivitySort(column.key);
                      }
                    }}
                  >
                    {column.label}
                    {activityFilters.sortBy === column.key ? (
                      <span className="text-[10px] text-white/40">{activityFilters.sortDir}</span>
                    ) : null}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {activityLoading ? (
              <tr>
                <td colSpan={columns.length} className="px-4 py-8 text-center text-sm text-white/60">
                  Carregando historico...
                </td>
              </tr>
            ) : activityRows.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="px-4 py-8 text-center text-sm text-white/60">
                  Sem eventos para os filtros atuais.
                </td>
              </tr>
            ) : (
              activityRows.map((row) => (
                <tr key={row.id} className="border-b border-white/5 text-sm text-white/90">
                  {columns.map((column) => {
                    const value = (() => {
                      if (column.key === "createdAt") return formatDateTime(row.createdAt);
                      if (column.key === "vehicleLabel") return resolveVehicleLabel(row);
                      if (String(column.key).startsWith("esp:")) {
                        const espKey = String(column.key).slice(4);
                        return row?.esp32Columns?.[espKey] ?? "-";
                      }
                      return row[column.key] ?? "-";
                    })();
                    return (
                      <td key={`${row.id}-${column.key}`} className="px-3 py-3 align-top">
                        {value || "-"}
                      </td>
                    );
                  })}
                </tr>
              ))
            )}
          </tbody>
        </DataTable>

        <DataTablePagination
          pageSize={activityPagination.pageSize}
          currentPage={activityPagination.page}
          totalPages={activityPagination.totalPages}
          totalItems={activityPagination.total}
          onPageSizeChange={(value) => patchSearch({ a_pageSize: String(value), a_page: "1" })}
          onPageChange={(value) => patchSearch({ a_page: String(value) })}
        />
      </div>
    );
  };

  const renderCounterKeysTab = () => (
    <div className="space-y-3">
      <FilterBar
        left={(
          <>
            <input
              value={counterFilters.user}
              onChange={(event) => patchSearch({ k_user: event.target.value }, { resetPageKey: "k_page" })}
              placeholder="usuario"
              className="min-w-[160px] rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white"
            />
            <input
              value={counterFilters.vehicle}
              onChange={(event) => patchSearch({ k_vehicle: event.target.value }, { resetPageKey: "k_page" })}
              placeholder="veiculo"
              className="min-w-[160px] rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white"
            />
            <input
              value={counterFilters.device}
              onChange={(event) => patchSearch({ k_device: event.target.value }, { resetPageKey: "k_page" })}
              placeholder="dispositivo"
              className="min-w-[160px] rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white"
            />
            <select
              value={counterFilters.status}
              onChange={(event) => patchSearch({ k_status: event.target.value }, { resetPageKey: "k_page" })}
              className="min-w-[160px] rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white"
            >
              <option value="">Status</option>
              <option value="ATIVA">ATIVA</option>
              <option value="EXPIRADA">EXPIRADA</option>
              <option value="CANCELADA">CANCELADA</option>
              <option value="USADA">USADA</option>
            </select>
          </>
        )}
        right={(
          <>
            <button
              type="button"
              className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/90 hover:border-white/30"
              onClick={() => loadCounterKeys()}
            >
              <RefreshCw size={16} /> Atualizar
            </button>
            <button
              type="button"
              className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/90 hover:border-white/30"
              onClick={() => {
                loadSelectorOptions();
                setCounterModalOpen(true);
              }}
            >
              <Shield size={16} /> Nova contra-senha
            </button>
          </>
        )}
      />

      <DataTable className="rounded-xl border border-white/10 bg-[#0b0f17]" tableClassName="min-w-[1650px]">
        <thead>
          <tr className="border-b border-white/10 text-left text-xs uppercase tracking-[0.1em] text-white/60">
            {COUNTER_KEY_COLUMNS.map((column) => (
              <th key={column.key} className="px-3 py-3">
                <button
                  type="button"
                  className="inline-flex items-center gap-2 text-left hover:text-white"
                  onClick={() => handleCounterSort(column.key)}
                >
                  {column.label}
                  {counterFilters.sortBy === column.key ? (
                    <span className="text-[10px] text-white/40">{counterFilters.sortDir}</span>
                  ) : null}
                </button>
              </th>
            ))}
            <th className="px-3 py-3">Acoes</th>
          </tr>
        </thead>
        <tbody>
          {counterLoading ? (
            <tr>
              <td colSpan={COUNTER_KEY_COLUMNS.length + 1} className="px-4 py-8 text-center text-sm text-white/60">
                Carregando contra-senhas...
              </td>
            </tr>
          ) : counterRows.length === 0 ? (
            <tr>
              <td colSpan={COUNTER_KEY_COLUMNS.length + 1} className="px-4 py-8 text-center text-sm text-white/60">
                Sem contra-senhas para os filtros atuais.
              </td>
            </tr>
          ) : (
            counterRows.map((row) => (
              <tr key={row.id} className="border-b border-white/5 text-sm text-white/90">
                {COUNTER_KEY_COLUMNS.map((column) => {
                  const value = (() => {
                    if (["createdAt", "firstUsedAt", "lastUsedAt", "expiresAt"].includes(column.key)) {
                      return formatDateTime(row[column.key]);
                    }
                    if (column.key === "vehicleLabel") return resolveVehicleLabel(row);
                    if (column.key === "basePasswordMasked") return "******";
                    return row[column.key] ?? "-";
                  })();
                  return (
                    <td key={`${row.id}-${column.key}`} className="px-3 py-3 align-top">
                      {value || "-"}
                    </td>
                  );
                })}
                <td className="px-3 py-3 align-top">
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="rounded-lg border border-white/15 px-2 py-1 text-xs text-white/80 hover:border-white/35"
                      onClick={() => registerCounterKeyUse(row)}
                    >
                      Registrar uso
                    </button>
                    <button
                      type="button"
                      className="rounded-lg border border-red-400/30 px-2 py-1 text-xs text-red-200 hover:border-red-300/60"
                      onClick={() => cancelCounterKey(row)}
                    >
                      Cancelar
                    </button>
                  </div>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </DataTable>

      <DataTablePagination
        pageSize={counterPagination.pageSize}
        currentPage={counterPagination.page}
        totalPages={counterPagination.totalPages}
        totalItems={counterPagination.total}
        onPageSizeChange={(value) => patchSearch({ k_pageSize: String(value), k_page: "1" })}
        onPageChange={(value) => patchSearch({ k_page: String(value) })}
      />
    </div>
  );

  return (
    <div className="flex min-h-[calc(100vh-180px)] flex-col gap-6">
      <PageHeader
        title="Trust Center"
        subtitle="Painel de gerenciamento de acessos, auditoria de acoes e geracao de contra-senha para dispositivos ESP32."
      />

      <div className="flex flex-wrap items-center gap-2 border-b border-white/10 pb-4">
        {tabs
          .filter((tab) => tab.enabled)
          .map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => switchTab(tab.to)}
              className={`rounded-xl px-3 py-2 text-xs font-semibold uppercase tracking-wide transition ${
                activeTab === tab.key
                  ? "border border-primary/40 bg-primary/20 text-white"
                  : "border border-white/10 text-white/70 hover:border-white/30 hover:text-white"
              }`}
            >
              {tab.label}
            </button>
          ))}
      </div>

      {tabError ? (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">{tabError}</div>
      ) : null}

      {!resolvedClientId ? (
        <EmptyState
          icon={<Shield className="h-6 w-6" />}
          title="Selecione um cliente"
          subtitle="Defina o cliente no topo para carregar os dados do Trust Center."
        />
      ) : null}

      {resolvedClientId ? (
        <>
          {activeTab === TAB_USERS ? renderUsersTab() : null}
          {activeTab === TAB_ACTIVITY ? renderActivityTab() : null}
          {activeTab === TAB_COUNTER_KEY ? renderCounterKeysTab() : null}
        </>
      ) : null}

      <Drawer
        open={detailsOpen}
        onClose={() => setDetailsOpen(false)}
        title={detailsSummary?.userName || detailsSummary?.userId || "Usuario"}
        subtitle={detailsSummary?.esp32DeviceId ? `Dispositivo ${detailsSummary.esp32DeviceId}` : null}
      >
        <div className="mb-4 flex flex-wrap items-center gap-2 border-b border-white/10 pb-3">
          <button
            type="button"
            className={`rounded-lg px-3 py-1 text-xs uppercase tracking-wide ${
              detailsTab === "status" ? "bg-primary/20 text-white" : "bg-white/5 text-white/70"
            }`}
            onClick={() => setDetailsTab("status")}
          >
            Status
          </button>
          <button
            type="button"
            className={`rounded-lg px-3 py-1 text-xs uppercase tracking-wide ${
              detailsTab === "history" ? "bg-primary/20 text-white" : "bg-white/5 text-white/70"
            }`}
            onClick={() => setDetailsTab("history")}
          >
            Historico
          </button>
        </div>

        {detailsLoading ? <p className="text-sm text-white/60">Carregando painel lateral...</p> : null}

        {!detailsLoading && detailsSummary && detailsTab === "status" ? (
          <div className="space-y-6 text-sm text-white/90">
            <div className="space-y-2">
              <SectionTitle>Resumo do usuario</SectionTitle>
              <div className="grid gap-2 md:grid-cols-2">
                <div>Nome: <strong>{detailsSummary.userName || "-"}</strong></div>
                <div>Perfil: <strong>{detailsSummary.userRole || "-"}</strong></div>
                <div>Cliente: <strong>{detailsSummary.clientName || "-"}</strong></div>
                <div>Dispositivo vinculado: <strong>{detailsSummary.esp32DeviceId || "-"}</strong></div>
                <div>Status atual: <strong>{detailsSummary.state || "-"}</strong></div>
              </div>
            </div>
            <div className="space-y-2">
              <SectionTitle>Status</SectionTitle>
              <div className="grid gap-2 md:grid-cols-2">
                <div>Challenge: <strong>{detailsSummary.challenge || "-"}</strong></div>
                <div>Metodo de validacao: <strong>{detailsSummary.validationMethod || "-"}</strong></div>
                <div>Resultado: <strong>{detailsSummary.lastResult || "-"}</strong></div>
                <div>Dispositivo utilizado: <strong>{detailsSummary.esp32DeviceId || "-"}</strong></div>
              </div>
            </div>
          </div>
        ) : null}

        {!detailsLoading && detailsTab === "history" ? (
          <div className="space-y-3">
            <SectionTitle>Historico</SectionTitle>
            <DataTable className="rounded-xl border border-white/10" tableClassName="min-w-full">
              <thead>
                <tr className="border-b border-white/10 text-left text-xs uppercase tracking-wide text-white/60">
                  <th className="px-3 py-2">Data</th>
                  <th className="px-3 py-2">Acao</th>
                  <th className="px-3 py-2">Metodo</th>
                  <th className="px-3 py-2">Resultado</th>
                  <th className="px-3 py-2">created_by</th>
                  <th className="px-3 py-2">used_by</th>
                </tr>
              </thead>
              <tbody>
                {detailsHistory.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-3 py-6 text-center text-sm text-white/60">
                      Sem eventos para este usuario.
                    </td>
                  </tr>
                ) : (
                  detailsHistory.map((event) => (
                    <tr key={event.id} className="border-b border-white/5 text-sm text-white/90">
                      <td className="px-3 py-2">{formatDateTime(event.createdAt)}</td>
                      <td className="px-3 py-2">{event.action || "-"}</td>
                      <td className="px-3 py-2">{event.method || "-"}</td>
                      <td className="px-3 py-2">{event.result || "-"}</td>
                      <td className="px-3 py-2">{event.createdBy || "-"}</td>
                      <td className="px-3 py-2">{event.usedBy || "-"}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </DataTable>
          </div>
        ) : null}
      </Drawer>

      <Modal
        open={rotateOpen}
        onClose={() => setRotateOpen(false)}
        title="Rotacionar challenge"
        width="max-w-2xl"
        footer={(
          <>
            <button
              type="button"
              className="rounded-xl border border-white/15 px-4 py-2 text-sm text-white/80"
              onClick={() => setRotateOpen(false)}
            >
              Fechar
            </button>
            <button
              type="button"
              className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-black"
              onClick={performRotateChallenge}
            >
              Rotacionar
            </button>
          </>
        )}
      >
        <div className="grid gap-3 md:grid-cols-2">
          <label className="flex flex-col gap-1 text-xs uppercase tracking-wide text-white/60">
            Usuario
            <input
              value={rotateForm.userId}
              onChange={(event) => setRotateForm((current) => ({ ...current, userId: event.target.value }))}
              className="rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white"
              placeholder="userId"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs uppercase tracking-wide text-white/60">
            Veiculo
            <input
              value={rotateForm.vehicleId}
              onChange={(event) => setRotateForm((current) => ({ ...current, vehicleId: event.target.value }))}
              className="rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white"
              placeholder="vehicleId"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs uppercase tracking-wide text-white/60 md:col-span-2">
            Dispositivo ESP32
            <input
              value={rotateForm.esp32DeviceId}
              onChange={(event) =>
                setRotateForm((current) => ({ ...current, esp32DeviceId: event.target.value }))
              }
              className="rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white"
              placeholder="esp32_device_id"
            />
          </label>
        </div>
      </Modal>

      <Modal
        open={simulateOpen}
        onClose={() => setSimulateOpen(false)}
        title="Simular contra-senha"
        width="max-w-2xl"
        footer={(
          <>
            <button
              type="button"
              className="rounded-xl border border-white/15 px-4 py-2 text-sm text-white/80"
              onClick={() => setSimulateOpen(false)}
            >
              Fechar
            </button>
            <button
              type="button"
              className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-black"
              onClick={performSimulation}
            >
              Simular
            </button>
          </>
        )}
      >
        <div className="grid gap-3 md:grid-cols-2">
          <label className="flex flex-col gap-1 text-xs uppercase tracking-wide text-white/60">
            Usuario
            <input
              value={simulateForm.userId}
              onChange={(event) => setSimulateForm((current) => ({ ...current, userId: event.target.value }))}
              className="rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white"
              placeholder="userId"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs uppercase tracking-wide text-white/60">
            Veiculo
            <input
              value={simulateForm.vehicleId}
              onChange={(event) => setSimulateForm((current) => ({ ...current, vehicleId: event.target.value }))}
              className="rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white"
              placeholder="vehicleId"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs uppercase tracking-wide text-white/60">
            Dispositivo ESP32
            <input
              value={simulateForm.esp32DeviceId}
              onChange={(event) =>
                setSimulateForm((current) => ({ ...current, esp32DeviceId: event.target.value }))
              }
              className="rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white"
              placeholder="esp32_device_id"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs uppercase tracking-wide text-white/60">
            Senha base (6 digitos)
            <input
              value={simulateForm.password}
              onChange={(event) =>
                setSimulateForm((current) => ({ ...current, password: event.target.value.replace(/\D/g, "").slice(0, 6) }))
              }
              className="rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white"
              placeholder="123456"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs uppercase tracking-wide text-white/60 md:col-span-2">
            Challenge (opcional)
            <input
              value={simulateForm.challenge}
              onChange={(event) => setSimulateForm((current) => ({ ...current, challenge: event.target.value }))}
              className="rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white"
              placeholder="challenge"
            />
          </label>
        </div>

        {simulateResult ? (
          <div className="mt-4 rounded-xl border border-white/10 bg-black/30 p-3 text-sm text-white/90">
            <div>Challenge: <strong>{simulateResult.challenge || "-"}</strong></div>
            <div>Contra-senha simulada: <strong>{simulateResult.counterKey || "-"}</strong></div>
          </div>
        ) : null}
      </Modal>

      <Modal
        open={counterModalOpen}
        onClose={() => setCounterModalOpen(false)}
        title="Nova contra-senha"
        width="max-w-2xl"
        footer={(
          <>
            <button
              type="button"
              className="rounded-xl border border-white/15 px-4 py-2 text-sm text-white/80"
              onClick={() => setCounterModalOpen(false)}
            >
              Fechar
            </button>
            <button
              type="button"
              className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-black"
              onClick={createCounterKey}
            >
              Criar
            </button>
          </>
        )}
      >
        <div className="grid gap-3 md:grid-cols-2">
          <label className="flex flex-col gap-1 text-xs uppercase tracking-wide text-white/60">
            1. Selecionar usuario
            <select
              value={counterForm.userId}
              onChange={(event) => setCounterForm((current) => ({ ...current, userId: event.target.value }))}
              className="rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white"
            >
              <option value="">Selecione</option>
              {userOptions.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name || item.email || item.id}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs uppercase tracking-wide text-white/60">
            2. Selecionar veiculo
            <select
              value={counterForm.vehicleId}
              onChange={(event) => setCounterForm((current) => ({ ...current, vehicleId: event.target.value }))}
              className="rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white"
            >
              <option value="">Selecione</option>
              {vehicleOptions.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.plate || item.name || item.id}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs uppercase tracking-wide text-white/60">
            Dispositivo ESP32
            <input
              value={counterForm.esp32DeviceId}
              onChange={(event) =>
                setCounterForm((current) => ({ ...current, esp32DeviceId: event.target.value }))
              }
              className="rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white"
              placeholder="esp32_device_id"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs uppercase tracking-wide text-white/60">
            3. Senha base (6 digitos)
            <input
              value={counterForm.password}
              onChange={(event) =>
                setCounterForm((current) => ({ ...current, password: event.target.value.replace(/\D/g, "").slice(0, 6) }))
              }
              className="rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white"
              placeholder="123456"
            />
          </label>
        </div>
      </Modal>
    </div>
  );
}

export default TrustCenter;
