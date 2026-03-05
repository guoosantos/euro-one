import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Download, RefreshCw, RotateCw, Shield, KeyRound } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";

import PageHeader from "../../components/ui/PageHeader.jsx";
import DataTable from "../../components/ui/DataTable.jsx";
import FilterBar from "../../components/ui/FilterBar.jsx";
import Input from "../../ui/Input.jsx";
import Select from "../../ui/Select.jsx";
import Button from "../../ui/Button.jsx";
import Modal from "../../ui/Modal.jsx";
import DataTablePagination from "../../ui/DataTablePagination.jsx";
import api from "../../lib/api.js";
import { API_ROUTES } from "../../lib/api-routes.js";
import { useTenant } from "../../lib/tenant-context.jsx";

const TAB_USERS = "users";
const TAB_ACTIVITY = "activity";
const TAB_COUNTER_KEY = "counter-key";
const USERS_COLUMNS_STORAGE_KEY = "trust-center:users:columns:v1";

const TRUST_TABS = [
  { key: TAB_USERS, label: "Usuários", to: "/trust-center/users" },
  { key: TAB_ACTIVITY, label: "Histórico", to: "/trust-center/activity" },
  { key: TAB_COUNTER_KEY, label: "Contra-senha", to: "/trust-center/counter-key" },
];

const USERS_COLUMNS = [
  { key: "state", label: "Estado", sortable: true },
  { key: "userName", label: "Usuário", sortable: true },
  { key: "profile", label: "Perfil", sortable: true },
  { key: "clientName", label: "Cliente", sortable: true },
  { key: "esp32Device", label: "Dispositivo ESP32", sortable: true },
  { key: "actionType", label: "Tipo de ação", sortable: true },
  { key: "result", label: "Resultado", sortable: true },
  { key: "accessPasswordMasked", label: "Senha (mascarada)", sortable: false },
  { key: "lastHeartbeatAt", label: "Último heartbeat", sortable: true },
  { key: "lastAttemptAt", label: "Última tentativa", sortable: true },
  { key: "lastAccessAt", label: "Último acesso", sortable: true },
];

const ACTIVITY_BASE_COLUMNS = [
  { key: "date", label: "Data", sortable: true },
  { key: "userName", label: "Usuário", sortable: true },
  { key: "profile", label: "Perfil", sortable: true },
  { key: "client", label: "Cliente", sortable: true },
  { key: "vehicle", label: "Veículo", sortable: true },
  { key: "device", label: "Dispositivo", sortable: true },
  { key: "method", label: "Método", sortable: true },
  { key: "action", label: "Ação executada", sortable: true },
  { key: "result", label: "Resultado", sortable: true },
];

const COUNTER_KEY_COLUMNS = [
  { key: "createdAt", label: "Data de criação", sortable: true },
  { key: "createdByName", label: "Usuário que gerou", sortable: true },
  { key: "targetUserName", label: "Usuário alvo", sortable: true },
  { key: "clientId", label: "Cliente", sortable: true },
  { key: "vehicleLabel", label: "Veículo", sortable: true },
  { key: "deviceLabel", label: "Dispositivo", sortable: true },
  { key: "basePasswordMasked", label: "Senha base", sortable: false },
  { key: "counterKey", label: "Contra-senha", sortable: false },
  { key: "status", label: "Status", sortable: true },
  { key: "usesCount", label: "Número de usos", sortable: true },
  { key: "firstUsedAt", label: "Primeiro uso", sortable: true },
  { key: "lastUsedAt", label: "Último uso", sortable: true },
  { key: "usedByName", label: "Usuário que utilizou", sortable: true },
];

function parsePositiveInt(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
}

function formatDateTime(value) {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "-";
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "medium",
    timeZone: "America/Sao_Paulo",
  }).format(parsed);
}

function resolveTabFromPath(pathname) {
  if (pathname.startsWith("/trust-center/activity")) return TAB_ACTIVITY;
  if (pathname.startsWith("/trust-center/counter-key")) return TAB_COUNTER_KEY;
  return TAB_USERS;
}

function toSearchString(params) {
  const text = params.toString();
  return text ? `?${text}` : "";
}

function applyQueryUpdate(currentSearch, updates = {}, removeKeys = []) {
  const params = new URLSearchParams(currentSearch);
  removeKeys.forEach((key) => params.delete(key));

  Object.entries(updates).forEach(([key, value]) => {
    if (value === null || value === undefined || value === "") {
      params.delete(key);
      return;
    }
    params.set(key, String(value));
  });

  return toSearchString(params);
}

function getInitialUserColumns() {
  const defaults = {};
  USERS_COLUMNS.forEach((column) => {
    defaults[column.key] = true;
  });

  if (typeof window === "undefined") {
    return defaults;
  }

  try {
    const raw = window.localStorage?.getItem(USERS_COLUMNS_STORAGE_KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return defaults;
    return {
      ...defaults,
      ...parsed,
    };
  } catch (_error) {
    return defaults;
  }
}

function saveUserColumns(columns) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage?.setItem(USERS_COLUMNS_STORAGE_KEY, JSON.stringify(columns));
  } catch (_error) {
    // ignore
  }
}

function StatusBadge({ state }) {
  const normalized = String(state || "").trim().toUpperCase();
  const className =
    normalized === "ONLINE"
      ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/30"
      : normalized === "TENTANDO"
        ? "bg-amber-500/15 text-amber-300 border-amber-500/30"
        : "bg-sky-500/15 text-sky-300 border-sky-500/30";

  return (
    <span className={`inline-flex rounded-full border px-2 py-1 text-[11px] font-semibold ${className}`}>
      {normalized || "-"}
    </span>
  );
}

function SortableHead({ label, columnKey, sortBy, sortDir, onSort, sortable = true }) {
  if (!sortable) {
    return <th className="whitespace-nowrap px-3 py-2 text-left text-xs uppercase tracking-[0.08em] text-white/60">{label}</th>;
  }

  const isActive = sortBy === columnKey;
  const indicator = isActive ? (sortDir === "asc" ? "▲" : "▼") : "↕";

  return (
    <th className="whitespace-nowrap px-3 py-2 text-left text-xs uppercase tracking-[0.08em] text-white/60">
      <button
        type="button"
        onClick={() => onSort(columnKey)}
        className={`inline-flex items-center gap-1 ${isActive ? "text-white" : "text-white/70 hover:text-white"}`}
      >
        <span>{label}</span>
        <span className="text-[10px]">{indicator}</span>
      </button>
    </th>
  );
}

function TrustTabs({ activeTab, onChange }) {
  return (
    <div className="flex flex-wrap gap-2 border-b border-white/10 pb-3">
      {TRUST_TABS.map((tab) => {
        const isActive = activeTab === tab.key;
        return (
          <button
            key={tab.key}
            type="button"
            onClick={() => onChange(tab.key)}
            className={`rounded-lg border px-4 py-2 text-sm font-semibold transition ${
              isActive
                ? "border-primary/60 bg-primary/20 text-white"
                : "border-white/15 bg-white/5 text-white/70 hover:border-white/35 hover:text-white"
            }`}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}

function UsersDetailDrawer({
  open,
  row,
  summary,
  loading,
  tab,
  onTabChange,
  onClose,
}) {
  if (!open || !row) return null;

  const historyRows = Array.isArray(summary?.history) ? summary.history : [];

  return (
    <div className="fixed inset-0 z-[1600] flex">
      <button type="button" className="flex-1 bg-black/60" onClick={onClose} aria-label="Fechar" />
      <aside className="h-full w-full max-w-2xl overflow-y-auto border-l border-white/10 bg-[#0f141c] p-5">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold text-white">{summary?.summary?.name || row.userName}</h3>
            <p className="text-sm text-white/65">
              Perfil: {summary?.summary?.profile || row.profile || "-"} • Cliente: {summary?.summary?.client || row.clientName || "-"}
            </p>
            <p className="text-sm text-white/65">Dispositivo: {summary?.summary?.linkedDevice || row.esp32Device || "-"}</p>
          </div>
          <button type="button" className="btn btn-outline" onClick={onClose}>
            Fechar
          </button>
        </div>

        <div className="mb-4 flex gap-2">
          <button
            type="button"
            className={`rounded-md border px-3 py-2 text-xs font-semibold uppercase tracking-[0.08em] ${
              tab === "status" ? "border-primary/60 bg-primary/20 text-white" : "border-white/20 text-white/70"
            }`}
            onClick={() => onTabChange("status")}
          >
            Status
          </button>
          <button
            type="button"
            className={`rounded-md border px-3 py-2 text-xs font-semibold uppercase tracking-[0.08em] ${
              tab === "history" ? "border-primary/60 bg-primary/20 text-white" : "border-white/20 text-white/70"
            }`}
            onClick={() => onTabChange("history")}
          >
            Histórico
          </button>
        </div>

        {loading ? (
          <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-8 text-sm text-white/70">Carregando detalhes...</div>
        ) : tab === "status" ? (
          <div className="grid gap-3 rounded-xl border border-white/10 bg-white/5 p-4 text-sm">
            <div><span className="text-white/60">Challenge:</span> <span className="text-white">{summary?.status?.challenge || row.challenge || "-"}</span></div>
            <div><span className="text-white/60">Método:</span> <span className="text-white">{summary?.status?.method || row.validationMethod || "-"}</span></div>
            <div><span className="text-white/60">Resultado:</span> <span className="text-white">{summary?.status?.result || row.result || "-"}</span></div>
            <div><span className="text-white/60">Dispositivo:</span> <span className="text-white">{summary?.status?.device || row.esp32Device || "-"}</span></div>
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-white/10 bg-white/5">
            <DataTable>
              <thead>
                <tr className="border-b border-white/10 text-left text-xs uppercase tracking-[0.08em] text-white/60">
                  <th className="px-3 py-2">Data</th>
                  <th className="px-3 py-2">Ação</th>
                  <th className="px-3 py-2">Resultado</th>
                  <th className="px-3 py-2">created_by</th>
                  <th className="px-3 py-2">used_by</th>
                </tr>
              </thead>
              <tbody>
                {historyRows.length === 0 ? (
                  <tr>
                    <td className="px-3 py-6 text-sm text-white/60" colSpan={5}>Sem eventos para este usuário.</td>
                  </tr>
                ) : historyRows.map((entry) => (
                  <tr key={entry.id} className="border-b border-white/5 text-sm text-white/85">
                    <td className="whitespace-nowrap px-3 py-2">{formatDateTime(entry.date)}</td>
                    <td className="px-3 py-2">{entry.action || "-"}</td>
                    <td className="px-3 py-2">{entry.result || "-"}</td>
                    <td className="px-3 py-2">{entry.created_by || "-"}</td>
                    <td className="px-3 py-2">{entry.used_by || "-"}</td>
                  </tr>
                ))}
              </tbody>
            </DataTable>
          </div>
        )}
      </aside>
    </div>
  );
}

function UsersSection({
  clientId,
  search,
  onReplaceSearch,
  canManageCounter,
}) {
  const params = useMemo(() => new URLSearchParams(search), [search]);

  const filterUser = params.get("u_user") || "";
  const filterDevice = params.get("u_device") || "";
  const filterPassword = params.get("u_password") || "";
  const filterActionType = params.get("u_action") || "";
  const filterResult = params.get("u_result") || "";
  const page = parsePositiveInt(params.get("u_page"), 1);
  const pageSize = parsePositiveInt(params.get("u_page_size"), 20);
  const sortBy = params.get("u_sort_by") || "";
  const sortDir = params.get("u_sort_dir") || "desc";

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [selectedIds, setSelectedIds] = useState([]);
  const [drawerRow, setDrawerRow] = useState(null);
  const [drawerSummary, setDrawerSummary] = useState(null);
  const [drawerLoading, setDrawerLoading] = useState(false);
  const [drawerTab, setDrawerTab] = useState("status");
  const [showColumnsModal, setShowColumnsModal] = useState(false);
  const [showSimulateModal, setShowSimulateModal] = useState(false);
  const [simBasePassword, setSimBasePassword] = useState("");
  const [simChallenge, setSimChallenge] = useState("");
  const [simResult, setSimResult] = useState(null);
  const [columns, setColumns] = useState(() => getInitialUserColumns());

  useEffect(() => {
    saveUserColumns(columns);
  }, [columns]);

  const visibleColumns = useMemo(
    () => USERS_COLUMNS.filter((column) => columns[column.key] !== false),
    [columns],
  );

  const loadRows = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await api.get(API_ROUTES.trustCenter.users, {
        params: {
          clientId,
          user: filterUser || undefined,
          device: filterDevice || undefined,
          password: filterPassword || undefined,
          actionType: filterActionType || undefined,
          result: filterResult || undefined,
          page,
          pageSize,
          sortBy: sortBy || undefined,
          sortDir: sortBy ? sortDir : undefined,
        },
      });

      const payload = response?.data || {};
      setRows(Array.isArray(payload.data) ? payload.data : []);
      setTotal(Number(payload.total || 0));
      setTotalPages(Math.max(1, Number(payload.totalPages || 1)));
    } catch (requestError) {
      setRows([]);
      setTotal(0);
      setTotalPages(1);
      setError(requestError?.message || "Falha ao carregar usuários do Trust Center.");
    } finally {
      setLoading(false);
    }
  }, [
    clientId,
    filterActionType,
    filterDevice,
    filterPassword,
    filterResult,
    filterUser,
    page,
    pageSize,
    sortBy,
    sortDir,
  ]);

  useEffect(() => {
    setSelectedIds([]);
    loadRows();
  }, [loadRows]);

  const updateQuery = useCallback((updates = {}, remove = []) => {
    const next = applyQueryUpdate(search, updates, remove);
    onReplaceSearch(next);
  }, [onReplaceSearch, search]);

  const handleSort = useCallback((columnKey) => {
    if (!columnKey) return;
    const nextDir = sortBy === columnKey ? (sortDir === "asc" ? "desc" : "asc") : "asc";
    updateQuery({
      u_sort_by: columnKey,
      u_sort_dir: nextDir,
      u_page: 1,
    });
  }, [sortBy, sortDir, updateQuery]);

  const toggleRowSelection = (rowId) => {
    setSelectedIds((current) => {
      if (current.includes(rowId)) {
        return current.filter((item) => item !== rowId);
      }
      return [...current, rowId];
    });
  };

  const openDrawer = async (row) => {
    setDrawerRow(row);
    setDrawerSummary(null);
    setDrawerTab("status");
    setDrawerLoading(true);
    try {
      const response = await api.get(API_ROUTES.trustCenter.userSummary(row.id), {
        params: { clientId },
      });
      setDrawerSummary(response?.data || null);
    } catch (_error) {
      setDrawerSummary(null);
    } finally {
      setDrawerLoading(false);
    }
  };

  const rotateChallenge = async () => {
    try {
      await api.post(
        API_ROUTES.trustCenter.rotateChallenge,
        {
          clientId,
          userIds: selectedIds,
        },
      );
      await loadRows();
    } catch (rotationError) {
      setError(rotationError?.message || "Falha ao rotacionar challenge.");
    }
  };

  const simulateCounterKey = async () => {
    try {
      const response = await api.post(API_ROUTES.trustCenter.counterKeySimulate, {
        clientId,
        basePassword: simBasePassword,
        challenge: simChallenge,
        context: selectedIds[0] || "manual",
      });
      setSimResult(response?.data || null);
    } catch (simulationError) {
      setSimResult({ error: simulationError?.message || "Falha na simulação." });
    }
  };

  return (
    <div className="space-y-4">
      <FilterBar
        className="rounded-xl border border-white/10 bg-white/5 p-4"
        left={(
          <>
            <Input
              value={filterUser}
              onChange={(event) => updateQuery({ u_user: event.target.value, u_page: 1 })}
              placeholder="Usuário"
            />
            <Input
              value={filterDevice}
              onChange={(event) => updateQuery({ u_device: event.target.value, u_page: 1 })}
              placeholder="Dispositivo ESP32"
            />
            <Input
              value={filterPassword}
              onChange={(event) => updateQuery({ u_password: event.target.value, u_page: 1 })}
              placeholder="Senha (6 dígitos)"
              maxLength={6}
              inputMode="numeric"
            />
            <Input
              value={filterActionType}
              onChange={(event) => updateQuery({ u_action: event.target.value, u_page: 1 })}
              placeholder="Tipo de ação"
            />
            <Input
              value={filterResult}
              onChange={(event) => updateQuery({ u_result: event.target.value, u_page: 1 })}
              placeholder="Resultado"
            />
          </>
        )}
        right={(
          <>
            <Button type="button" variant="outline" onClick={() => setShowColumnsModal(true)}>
              Colunas
            </Button>
            <Button type="button" variant="outline" onClick={loadRows}>
              <RefreshCw size={14} /> Atualizar
            </Button>
            <Button type="button" variant="outline" onClick={rotateChallenge} disabled={!canManageCounter}>
              <RotateCw size={14} /> Rotacionar challenge
            </Button>
            <Button type="button" onClick={() => setShowSimulateModal(true)} disabled={!canManageCounter}>
              <KeyRound size={14} /> Simular contra-senha
            </Button>
          </>
        )}
      />

      {error ? (
        <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{error}</div>
      ) : null}

      <div className="overflow-hidden rounded-xl border border-white/10 bg-[#0d121a]">
        <DataTable>
          <thead>
            <tr className="border-b border-white/10">
              <th className="w-10 px-3 py-2" />
              {visibleColumns.map((column) => (
                <SortableHead
                  key={column.key}
                  label={column.label}
                  columnKey={column.key}
                  sortBy={sortBy}
                  sortDir={sortDir}
                  onSort={handleSort}
                  sortable={column.sortable}
                />
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={visibleColumns.length + 1} className="px-3 py-8 text-center text-sm text-white/60">
                  Carregando tabela de usuários...
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={visibleColumns.length + 1} className="px-3 py-8 text-center text-sm text-white/60">
                  Nenhum registro encontrado.
                </td>
              </tr>
            ) : rows.map((row) => (
              <tr
                key={row.id}
                className="cursor-pointer border-b border-white/5 text-sm text-white/85 hover:bg-white/5"
                onClick={() => openDrawer(row)}
              >
                <td className="px-3 py-2" onClick={(event) => event.stopPropagation()}>
                  <input
                    type="checkbox"
                    checked={selectedIds.includes(row.id)}
                    onChange={() => toggleRowSelection(row.id)}
                    className="h-4 w-4 rounded border-white/20 bg-white/10"
                  />
                </td>
                {visibleColumns.map((column) => {
                  if (column.key === "state") {
                    return (
                      <td key={`${row.id}:${column.key}`} className="whitespace-nowrap px-3 py-2">
                        <StatusBadge state={row.state} />
                      </td>
                    );
                  }

                  if (["lastHeartbeatAt", "lastAttemptAt", "lastAccessAt"].includes(column.key)) {
                    return (
                      <td key={`${row.id}:${column.key}`} className="whitespace-nowrap px-3 py-2">
                        {formatDateTime(row[column.key])}
                      </td>
                    );
                  }

                  return (
                    <td key={`${row.id}:${column.key}`} className="px-3 py-2">
                      {row[column.key] || "-"}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </DataTable>

        <DataTablePagination
          pageSize={pageSize}
          currentPage={page}
          totalPages={totalPages}
          totalItems={total}
          onPageChange={(next) => updateQuery({ u_page: next })}
          onPageSizeChange={(value) => updateQuery({ u_page_size: value, u_page: 1 })}
        />
      </div>

      <UsersDetailDrawer
        open={Boolean(drawerRow)}
        row={drawerRow}
        summary={drawerSummary}
        loading={drawerLoading}
        tab={drawerTab}
        onTabChange={setDrawerTab}
        onClose={() => {
          setDrawerRow(null);
          setDrawerSummary(null);
        }}
      />

      <Modal
        open={showColumnsModal}
        title="Selecionar colunas"
        onClose={() => setShowColumnsModal(false)}
        width="max-w-xl"
      >
        <div className="grid gap-2">
          {USERS_COLUMNS.map((column) => (
            <label key={column.key} className="flex items-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-sm">
              <input
                type="checkbox"
                checked={columns[column.key] !== false}
                onChange={(event) => {
                  const nextVisible = event.target.checked;
                  setColumns((current) => ({
                    ...current,
                    [column.key]: nextVisible,
                  }));
                }}
              />
              <span>{column.label}</span>
            </label>
          ))}
        </div>
      </Modal>

      <Modal
        open={showSimulateModal}
        title="Simular cálculo de contra-senha"
        onClose={() => {
          setShowSimulateModal(false);
          setSimResult(null);
        }}
        width="max-w-xl"
      >
        <div className="grid gap-3">
          <Input
            label="Senha base (6 dígitos)"
            value={simBasePassword}
            onChange={(event) => setSimBasePassword(event.target.value)}
            maxLength={6}
            inputMode="numeric"
          />
          <Input
            label="Challenge"
            value={simChallenge}
            onChange={(event) => setSimChallenge(event.target.value)}
            placeholder="Ex.: AB12CD34"
          />
          <div className="flex justify-end">
            <Button type="button" onClick={simulateCounterKey}>Simular</Button>
          </div>
          {simResult ? (
            <pre className="rounded-xl border border-white/10 bg-black/30 p-3 text-xs text-white/90">
              {JSON.stringify(simResult, null, 2)}
            </pre>
          ) : null}
        </div>
      </Modal>
    </div>
  );
}

function ActivitySection({ clientId, search, onReplaceSearch }) {
  const params = useMemo(() => new URLSearchParams(search), [search]);

  const filterFrom = params.get("a_from") || "";
  const filterTo = params.get("a_to") || "";
  const filterUser = params.get("a_user") || "";
  const filterClient = params.get("a_client") || "";
  const filterVehicle = params.get("a_vehicle") || "";
  const filterDevice = params.get("a_device") || "";
  const filterMethod = params.get("a_method") || "";
  const filterResult = params.get("a_result") || "";
  const page = parsePositiveInt(params.get("a_page"), 1);
  const pageSize = parsePositiveInt(params.get("a_page_size"), 50);
  const sortBy = params.get("a_sort_by") || "date";
  const sortDir = params.get("a_sort_dir") || "desc";

  const [rows, setRows] = useState([]);
  const [extraColumns, setExtraColumns] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);

  const tableColumns = useMemo(() => {
    const dynamic = (Array.isArray(extraColumns) ? extraColumns : []).map((key) => ({
      key: `esp32.${key}`,
      label: `ESP32 ${key}`,
      sortable: false,
    }));
    return [...ACTIVITY_BASE_COLUMNS, ...dynamic];
  }, [extraColumns]);

  const updateQuery = useCallback((updates = {}, remove = []) => {
    const next = applyQueryUpdate(search, updates, remove);
    onReplaceSearch(next);
  }, [onReplaceSearch, search]);

  const loadRows = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await api.get(API_ROUTES.trustCenter.activity, {
        params: {
          clientId,
          from: filterFrom || undefined,
          to: filterTo || undefined,
          user: filterUser || undefined,
          client: filterClient || undefined,
          vehicle: filterVehicle || undefined,
          device: filterDevice || undefined,
          method: filterMethod || undefined,
          result: filterResult || undefined,
          page,
          pageSize,
          sortBy,
          sortDir,
        },
      });

      const payload = response?.data || {};
      setRows(Array.isArray(payload.data) ? payload.data : []);
      setExtraColumns(Array.isArray(payload.extraEsp32Columns) ? payload.extraEsp32Columns : []);
      setTotal(Number(payload.total || 0));
      setTotalPages(Math.max(1, Number(payload.totalPages || 1)));
    } catch (requestError) {
      setRows([]);
      setExtraColumns([]);
      setTotal(0);
      setTotalPages(1);
      setError(requestError?.message || "Falha ao carregar histórico.");
    } finally {
      setLoading(false);
    }
  }, [
    clientId,
    filterClient,
    filterDevice,
    filterFrom,
    filterMethod,
    filterResult,
    filterTo,
    filterUser,
    filterVehicle,
    page,
    pageSize,
    sortBy,
    sortDir,
  ]);

  useEffect(() => {
    loadRows();
  }, [loadRows]);

  const handleSort = useCallback((columnKey) => {
    if (!columnKey) return;
    const nextDir = sortBy === columnKey ? (sortDir === "asc" ? "desc" : "asc") : "asc";
    updateQuery({
      a_sort_by: columnKey,
      a_sort_dir: nextDir,
      a_page: 1,
    });
  }, [sortBy, sortDir, updateQuery]);

  const exportCsv = async () => {
    try {
      const response = await api.get(API_ROUTES.trustCenter.activityExport, {
        params: {
          clientId,
          from: filterFrom || undefined,
          to: filterTo || undefined,
          user: filterUser || undefined,
          client: filterClient || undefined,
          vehicle: filterVehicle || undefined,
          device: filterDevice || undefined,
          method: filterMethod || undefined,
          result: filterResult || undefined,
          sortBy,
          sortDir,
        },
        responseType: "text",
      });

      const csv = typeof response?.data === "string" ? response.data : "";
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `trust-center-activity-${new Date().toISOString().replace(/[:.]/g, "-")}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (downloadError) {
      setError(downloadError?.message || "Falha ao exportar histórico.");
    }
  };

  return (
    <div className="space-y-4">
      <FilterBar
        className="rounded-xl border border-white/10 bg-white/5 p-4"
        left={(
          <>
            <Input
              type="datetime-local"
              value={filterFrom}
              onChange={(event) => updateQuery({ a_from: event.target.value, a_page: 1 })}
              label="De"
            />
            <Input
              type="datetime-local"
              value={filterTo}
              onChange={(event) => updateQuery({ a_to: event.target.value, a_page: 1 })}
              label="Até"
            />
            <Input
              value={filterUser}
              onChange={(event) => updateQuery({ a_user: event.target.value, a_page: 1 })}
              placeholder="Usuário"
            />
            <Input
              value={filterClient}
              onChange={(event) => updateQuery({ a_client: event.target.value, a_page: 1 })}
              placeholder="Cliente"
            />
            <Input
              value={filterVehicle}
              onChange={(event) => updateQuery({ a_vehicle: event.target.value, a_page: 1 })}
              placeholder="Veículo"
            />
            <Input
              value={filterDevice}
              onChange={(event) => updateQuery({ a_device: event.target.value, a_page: 1 })}
              placeholder="Dispositivo"
            />
            <Input
              value={filterMethod}
              onChange={(event) => updateQuery({ a_method: event.target.value, a_page: 1 })}
              placeholder="Método"
            />
            <Input
              value={filterResult}
              onChange={(event) => updateQuery({ a_result: event.target.value, a_page: 1 })}
              placeholder="Resultado"
            />
          </>
        )}
        right={(
          <>
            <Button type="button" variant="outline" onClick={loadRows}>
              <RefreshCw size={14} /> Atualizar
            </Button>
            <Button type="button" onClick={exportCsv}>
              <Download size={14} /> Exportar
            </Button>
          </>
        )}
      />

      {error ? (
        <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{error}</div>
      ) : null}

      <div className="overflow-hidden rounded-xl border border-white/10 bg-[#0d121a]">
        <DataTable>
          <thead>
            <tr className="border-b border-white/10">
              {tableColumns.map((column) => (
                <SortableHead
                  key={column.key}
                  label={column.label}
                  columnKey={column.key}
                  sortBy={sortBy}
                  sortDir={sortDir}
                  onSort={handleSort}
                  sortable={column.sortable !== false}
                />
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={tableColumns.length} className="px-3 py-8 text-center text-sm text-white/60">
                  Carregando histórico...
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={tableColumns.length} className="px-3 py-8 text-center text-sm text-white/60">
                  Nenhum registro de auditoria encontrado.
                </td>
              </tr>
            ) : rows.map((row) => (
              <tr key={row.id} className="border-b border-white/5 text-sm text-white/85">
                {tableColumns.map((column) => {
                  const isDate = column.key === "date";
                  const isEsp32 = column.key.startsWith("esp32.");
                  const value = isEsp32
                    ? row?.esp32?.[column.key.split(".")[1]]
                    : row?.[column.key];

                  return (
                    <td key={`${row.id}:${column.key}`} className="px-3 py-2">
                      {isDate ? formatDateTime(value) : value || "-"}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </DataTable>

        <DataTablePagination
          pageSize={pageSize}
          currentPage={page}
          totalPages={totalPages}
          totalItems={total}
          onPageChange={(next) => updateQuery({ a_page: next })}
          onPageSizeChange={(value) => updateQuery({ a_page_size: value, a_page: 1 })}
        />
      </div>
    </div>
  );
}

function CounterKeySection({
  clientId,
  search,
  onReplaceSearch,
  canManageCounter,
}) {
  const params = useMemo(() => new URLSearchParams(search), [search]);

  const filterUser = params.get("k_user") || "";
  const filterVehicle = params.get("k_vehicle") || "";
  const filterDevice = params.get("k_device") || "";
  const filterStatus = params.get("k_status") || "";
  const page = parsePositiveInt(params.get("k_page"), 1);
  const pageSize = parsePositiveInt(params.get("k_page_size"), 20);
  const sortBy = params.get("k_sort_by") || "createdAt";
  const sortDir = params.get("k_sort_dir") || "desc";

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [targetUserId, setTargetUserId] = useState("");
  const [vehicleId, setVehicleId] = useState("");
  const [deviceId, setDeviceId] = useState("");
  const [basePassword, setBasePassword] = useState("");

  const [lookupUsers, setLookupUsers] = useState([]);
  const [lookupVehicles, setLookupVehicles] = useState([]);
  const [lookupDevices, setLookupDevices] = useState([]);

  const updateQuery = useCallback((updates = {}, remove = []) => {
    const next = applyQueryUpdate(search, updates, remove);
    onReplaceSearch(next);
  }, [onReplaceSearch, search]);

  const loadRows = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await api.get(API_ROUTES.trustCenter.counterKeys, {
        params: {
          clientId,
          user: filterUser || undefined,
          vehicle: filterVehicle || undefined,
          device: filterDevice || undefined,
          status: filterStatus || undefined,
          page,
          pageSize,
          sortBy,
          sortDir,
        },
      });

      const payload = response?.data || {};
      const list = Array.isArray(payload.data) ? payload.data : [];
      setRows(list);
      setTotal(Number(payload.total || 0));
      setTotalPages(Math.max(1, Number(payload.totalPages || 1)));

      const users = new Map();
      const vehicles = new Map();
      const devices = new Map();

      list.forEach((entry) => {
        if (entry.targetUserId) {
          users.set(String(entry.targetUserId), {
            id: String(entry.targetUserId),
            label: entry.targetUserName || `Usuário ${entry.targetUserId}`,
          });
        }
        if (entry.vehicleId) {
          vehicles.set(String(entry.vehicleId), {
            id: String(entry.vehicleId),
            label: entry.vehicleLabel || `Veículo ${entry.vehicleId}`,
          });
        }
        if (entry.deviceId) {
          devices.set(String(entry.deviceId), {
            id: String(entry.deviceId),
            label: entry.deviceLabel || `Dispositivo ${entry.deviceId}`,
          });
        }
      });

      setLookupUsers((current) => {
        const merged = new Map(current.map((entry) => [entry.id, entry]));
        users.forEach((value, key) => merged.set(key, value));
        return Array.from(merged.values());
      });
      setLookupVehicles((current) => {
        const merged = new Map(current.map((entry) => [entry.id, entry]));
        vehicles.forEach((value, key) => merged.set(key, value));
        return Array.from(merged.values());
      });
      setLookupDevices((current) => {
        const merged = new Map(current.map((entry) => [entry.id, entry]));
        devices.forEach((value, key) => merged.set(key, value));
        return Array.from(merged.values());
      });
    } catch (requestError) {
      setRows([]);
      setTotal(0);
      setTotalPages(1);
      setError(requestError?.message || "Falha ao carregar contra-senhas.");
    } finally {
      setLoading(false);
    }
  }, [
    clientId,
    filterDevice,
    filterStatus,
    filterUser,
    filterVehicle,
    page,
    pageSize,
    sortBy,
    sortDir,
  ]);

  const loadLookupUsers = useCallback(async () => {
    try {
      const response = await api.get(API_ROUTES.trustCenter.users, {
        params: {
          clientId,
          page: 1,
          pageSize: 500,
        },
      });
      const list = Array.isArray(response?.data?.data) ? response.data.data : [];
      setLookupUsers((current) => {
        const merged = new Map(current.map((entry) => [entry.id, entry]));
        list.forEach((entry) => {
          if (!entry.userId) return;
          merged.set(String(entry.userId), {
            id: String(entry.userId),
            label: entry.userName || `Usuário ${entry.userId}`,
          });
        });
        return Array.from(merged.values());
      });
      setLookupVehicles((current) => {
        const merged = new Map(current.map((entry) => [entry.id, entry]));
        list.forEach((entry) => {
          if (!entry.vehicleId) return;
          merged.set(String(entry.vehicleId), {
            id: String(entry.vehicleId),
            label: entry.vehicleLabel || `Veículo ${entry.vehicleId}`,
          });
        });
        return Array.from(merged.values());
      });
      setLookupDevices((current) => {
        const merged = new Map(current.map((entry) => [entry.id, entry]));
        list.forEach((entry) => {
          if (!entry.deviceId) return;
          merged.set(String(entry.deviceId), {
            id: String(entry.deviceId),
            label: entry.esp32Device || `Dispositivo ${entry.deviceId}`,
          });
        });
        return Array.from(merged.values());
      });
    } catch (_error) {
      // keep local lookup from current rows
    }
  }, [clientId]);

  useEffect(() => {
    loadRows();
  }, [loadRows]);

  useEffect(() => {
    loadLookupUsers();
  }, [loadLookupUsers]);

  const handleSort = useCallback((columnKey) => {
    if (!columnKey) return;
    const nextDir = sortBy === columnKey ? (sortDir === "asc" ? "desc" : "asc") : "asc";
    updateQuery({
      k_sort_by: columnKey,
      k_sort_dir: nextDir,
      k_page: 1,
    });
  }, [sortBy, sortDir, updateQuery]);

  const handleCreate = async () => {
    setCreating(true);
    setError("");
    try {
      await api.post(API_ROUTES.trustCenter.counterKeys, {
        clientId,
        targetUserId,
        vehicleId,
        deviceId: deviceId || null,
        basePassword,
      });

      setShowCreateModal(false);
      setTargetUserId("");
      setVehicleId("");
      setDeviceId("");
      setBasePassword("");
      await loadRows();
    } catch (createError) {
      setError(createError?.message || "Falha ao criar contra-senha.");
    } finally {
      setCreating(false);
    }
  };

  const handleUseCounterKey = async (entry) => {
    try {
      await api.post(API_ROUTES.trustCenter.counterKeyUse(entry.id), {
        clientId,
        counterKey: entry.counterKey,
      });
      await loadRows();
    } catch (useError) {
      setError(useError?.message || "Falha ao registrar uso da contra-senha.");
    }
  };

  const handleCancelCounterKey = async (entry) => {
    try {
      await api.post(API_ROUTES.trustCenter.counterKeyCancel(entry.id), { clientId });
      await loadRows();
    } catch (cancelError) {
      setError(cancelError?.message || "Falha ao cancelar contra-senha.");
    }
  };

  return (
    <div className="space-y-4">
      <FilterBar
        className="rounded-xl border border-white/10 bg-white/5 p-4"
        left={(
          <>
            <Input
              value={filterUser}
              onChange={(event) => updateQuery({ k_user: event.target.value, k_page: 1 })}
              placeholder="Usuário"
            />
            <Input
              value={filterVehicle}
              onChange={(event) => updateQuery({ k_vehicle: event.target.value, k_page: 1 })}
              placeholder="Veículo"
            />
            <Input
              value={filterDevice}
              onChange={(event) => updateQuery({ k_device: event.target.value, k_page: 1 })}
              placeholder="Dispositivo"
            />
            <Select
              value={filterStatus}
              onChange={(event) => updateQuery({ k_status: event.target.value, k_page: 1 })}
            >
              <option value="">Todos os status</option>
              <option value="ATIVA">ATIVA</option>
              <option value="USADA">USADA</option>
              <option value="CANCELADA">CANCELADA</option>
              <option value="EXPIRADA">EXPIRADA</option>
            </Select>
          </>
        )}
        right={(
          <>
            <Button type="button" variant="outline" onClick={loadRows}>
              <RefreshCw size={14} /> Atualizar
            </Button>
            <Button type="button" onClick={() => setShowCreateModal(true)} disabled={!canManageCounter}>
              <KeyRound size={14} /> Criar Nova Contra-senha
            </Button>
          </>
        )}
      />

      {error ? (
        <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{error}</div>
      ) : null}

      <div className="overflow-hidden rounded-xl border border-white/10 bg-[#0d121a]">
        <DataTable>
          <thead>
            <tr className="border-b border-white/10">
              {COUNTER_KEY_COLUMNS.map((column) => (
                <SortableHead
                  key={column.key}
                  label={column.label}
                  columnKey={column.key}
                  sortBy={sortBy}
                  sortDir={sortDir}
                  onSort={handleSort}
                  sortable={column.sortable}
                />
              ))}
              <th className="px-3 py-2 text-left text-xs uppercase tracking-[0.08em] text-white/60">Ações</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={COUNTER_KEY_COLUMNS.length + 1} className="px-3 py-8 text-center text-sm text-white/60">
                  Carregando contra-senhas...
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={COUNTER_KEY_COLUMNS.length + 1} className="px-3 py-8 text-center text-sm text-white/60">
                  Nenhuma contra-senha encontrada.
                </td>
              </tr>
            ) : rows.map((row) => (
              <tr key={row.id} className="border-b border-white/5 text-sm text-white/85">
                {COUNTER_KEY_COLUMNS.map((column) => {
                  const isDate = ["createdAt", "firstUsedAt", "lastUsedAt"].includes(column.key);
                  return (
                    <td key={`${row.id}:${column.key}`} className="whitespace-nowrap px-3 py-2">
                      {isDate ? formatDateTime(row[column.key]) : row[column.key] || "-"}
                    </td>
                  );
                })}
                <td className="px-3 py-2">
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => handleUseCounterKey(row)}
                      disabled={!canManageCounter || row.status !== "ATIVA"}
                    >
                      Usar
                    </Button>
                    <Button
                      type="button"
                      variant="danger"
                      onClick={() => handleCancelCounterKey(row)}
                      disabled={!canManageCounter || row.status !== "ATIVA"}
                    >
                      Cancelar
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </DataTable>

        <DataTablePagination
          pageSize={pageSize}
          currentPage={page}
          totalPages={totalPages}
          totalItems={total}
          onPageChange={(next) => updateQuery({ k_page: next })}
          onPageSizeChange={(value) => updateQuery({ k_page_size: value, k_page: 1 })}
        />
      </div>

      <Modal
        open={showCreateModal}
        title="Criar nova contra-senha"
        onClose={() => setShowCreateModal(false)}
        width="max-w-xl"
      >
        <div className="grid gap-3">
          <Select
            label="1) Usuário"
            value={targetUserId}
            onChange={(event) => setTargetUserId(event.target.value)}
          >
            <option value="">Selecione</option>
            {lookupUsers.map((entry) => (
              <option key={entry.id} value={entry.id}>{entry.label}</option>
            ))}
          </Select>

          <Select
            label="2) Veículo"
            value={vehicleId}
            onChange={(event) => setVehicleId(event.target.value)}
          >
            <option value="">Selecione</option>
            {lookupVehicles.map((entry) => (
              <option key={entry.id} value={entry.id}>{entry.label}</option>
            ))}
          </Select>

          <Select
            label="Dispositivo (opcional)"
            value={deviceId}
            onChange={(event) => setDeviceId(event.target.value)}
          >
            <option value="">Selecione</option>
            {lookupDevices.map((entry) => (
              <option key={entry.id} value={entry.id}>{entry.label}</option>
            ))}
          </Select>

          <Input
            label="3) Senha base (6 dígitos)"
            value={basePassword}
            onChange={(event) => setBasePassword(event.target.value)}
            maxLength={6}
            inputMode="numeric"
            placeholder="000000"
          />

          <div className="flex justify-end">
            <Button
              type="button"
              onClick={handleCreate}
              disabled={!canManageCounter || creating || !targetUserId || !vehicleId || !/^\d{6}$/.test(basePassword)}
            >
              {creating ? "Gerando..." : "Salvar"}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

export default function TrustCenterPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { tenantId, tenant, user } = useTenant();

  const activeTab = resolveTabFromPath(location.pathname);
  const [capabilities, setCapabilities] = useState(null);
  const [capabilityError, setCapabilityError] = useState("");
  const [loadingCapabilities, setLoadingCapabilities] = useState(true);

  useEffect(() => {
    if (location.pathname === "/trust-center") {
      navigate(`/trust-center/users${location.search || ""}`, { replace: true });
    }
  }, [location.pathname, location.search, navigate]);

  const loadCapabilities = useCallback(async () => {
    setLoadingCapabilities(true);
    setCapabilityError("");
    try {
      const response = await api.get(API_ROUTES.trustCenter.capabilities);
      setCapabilities(response?.data?.permissions || null);
    } catch (error) {
      setCapabilities(null);
      setCapabilityError(error?.message || "Falha ao carregar permissões do Trust Center.");
    } finally {
      setLoadingCapabilities(false);
    }
  }, []);

  useEffect(() => {
    loadCapabilities();
  }, [loadCapabilities]);

  const switchTab = (tabKey) => {
    const next = TRUST_TABS.find((tab) => tab.key === tabKey);
    if (!next) return;
    navigate(`${next.to}${location.search || ""}`);
  };

  const canView = Boolean(capabilities?.["trust_center.view"]);
  const canAudit = Boolean(capabilities?.["trust_center.audit_view"]);
  const canManageCounter = Boolean(capabilities?.["trust_center.manage_counter_key"]);

  const replaceSearch = useCallback((searchString) => {
    navigate(`${location.pathname}${searchString}`, { replace: true });
  }, [location.pathname, navigate]);

  const requiresTenantSelection = user?.role === "admin" && (tenantId === null || tenantId === undefined);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Trust Center"
        subtitle="Painel de gerenciamento de acessos, auditoria de ações e geração de contra-senha para dispositivos ESP32."
        rightSlot={(
          <Button type="button" variant="outline" onClick={loadCapabilities}>
            <RefreshCw size={14} /> Atualizar permissões
          </Button>
        )}
      />

      <TrustTabs activeTab={activeTab} onChange={switchTab} />

      {loadingCapabilities ? (
        <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-6 text-sm text-white/70">
          Carregando permissões do Trust Center...
        </div>
      ) : null}

      {!loadingCapabilities && capabilityError ? (
        <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
          {capabilityError}
        </div>
      ) : null}

      {!loadingCapabilities && requiresTenantSelection ? (
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
          Selecione um cliente no topo para acessar o Trust Center.
        </div>
      ) : null}

      {!loadingCapabilities && !requiresTenantSelection && !canView ? (
        <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-6 text-sm text-white/70">
          Seu perfil não possui permissão `trust_center.view`.
        </div>
      ) : null}

      {!loadingCapabilities && !requiresTenantSelection && canView && activeTab === TAB_USERS ? (
        <UsersSection
          clientId={tenant?.id || tenantId}
          search={location.search}
          onReplaceSearch={replaceSearch}
          canManageCounter={canManageCounter}
        />
      ) : null}

      {!loadingCapabilities && !requiresTenantSelection && canView && activeTab === TAB_ACTIVITY ? (
        canAudit ? (
          <ActivitySection
            clientId={tenant?.id || tenantId}
            search={location.search}
            onReplaceSearch={replaceSearch}
          />
        ) : (
          <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-6 text-sm text-white/70">
            Seu perfil não possui permissão `trust_center.audit_view`.
          </div>
        )
      ) : null}

      {!loadingCapabilities && !requiresTenantSelection && canView && activeTab === TAB_COUNTER_KEY ? (
        <CounterKeySection
          clientId={tenant?.id || tenantId}
          search={location.search}
          onReplaceSearch={replaceSearch}
          canManageCounter={canManageCounter}
        />
      ) : null}

      <div className="rounded-xl border border-primary/20 bg-primary/5 px-4 py-3 text-xs text-white/60">
        <div className="mb-1 inline-flex items-center gap-2 font-semibold uppercase tracking-[0.08em] text-white/75">
          <Shield size={14} /> Trust Center
        </div>
        <p>
          Tenant ativo: <strong>{tenant?.name || "-"}</strong>
        </p>
        <p>
          Permissões: view={String(canView)} • audit_view={String(canAudit)} • manage_counter_key={String(canManageCounter)}
        </p>
      </div>
    </div>
  );
}
