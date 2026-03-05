import React, { useCallback, useEffect, useMemo, useState } from "react";
import { NavLink, Navigate, useLocation, useNavigate } from "react-router-dom";
import { ChevronDown, RefreshCw, RotateCw, Shield } from "lucide-react";

import Button from "../../ui/Button";
import DataTablePagination from "../../ui/DataTablePagination.jsx";
import DataTable from "../../components/ui/DataTable.jsx";
import FilterBar from "../../components/ui/FilterBar.jsx";
import PageHeader from "../../components/ui/PageHeader.jsx";
import SkeletonTable from "../../components/ui/SkeletonTable.jsx";
import { CoreApi } from "../../lib/coreApi.js";
import { loadColumnVisibility, saveColumnVisibility } from "../../lib/column-visibility.js";
import { useTenant } from "../../lib/tenant-context.jsx";

const TAB_ITEMS = [
  { key: "users", label: "Usuários", path: "/trust-center/users" },
  { key: "activity", label: "Histórico", path: "/trust-center/activity" },
  { key: "counter-key", label: "Contra-senha", path: "/trust-center/counter-key" },
];

const USER_COLUMNS = [
  { key: "state", label: "Estado", sortable: true },
  { key: "userName", label: "Usuário", sortable: true },
  { key: "profile", label: "Perfil", sortable: true },
  { key: "clientName", label: "Cliente", sortable: true },
  { key: "vehicle", label: "Veículo", sortable: true },
  { key: "deviceName", label: "Dispositivo ESP32", sortable: true },
  { key: "actionType", label: "Tipo de ação", sortable: true },
  { key: "result", label: "Resultado", sortable: true },
  { key: "lastHeartbeatAt", label: "Último heartbeat", sortable: true },
  { key: "lastAttemptAt", label: "Última tentativa", sortable: true },
  { key: "lastAccessAt", label: "Último acesso", sortable: true },
];

const USER_COLUMN_DEFAULTS = USER_COLUMNS.reduce((acc, column) => {
  acc[column.key] = true;
  return acc;
}, {});

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("pt-BR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function normalizeTab(pathname) {
  if (pathname.endsWith("/activity")) return "activity";
  if (pathname.endsWith("/counter-key")) return "counter-key";
  return "users";
}

function toInt(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function pickSearchValue(search, key, fallback = "") {
  const value = search.get(key);
  if (value == null) return fallback;
  return String(value);
}

function SortableHeader({ column, currentSortBy, currentSortDir, onSort }) {
  const isActive = currentSortBy === column.key;
  const marker = isActive ? (currentSortDir === "asc" ? "↑" : "↓") : "";
  return (
    <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-[0.08em] text-white/60">
      {column.sortable ? (
        <button
          type="button"
          className="inline-flex items-center gap-1 text-white/75 transition hover:text-white"
          onClick={() => onSort(column.key)}
        >
          {column.label}
          <span className="text-[10px] text-white/50">{marker}</span>
        </button>
      ) : (
        column.label
      )}
    </th>
  );
}

function StateBadge({ value }) {
  const normalized = String(value || "").toUpperCase();
  if (normalized === "ONLINE") {
    return <span className="rounded-full bg-emerald-500/20 px-2 py-1 text-xs font-semibold text-emerald-300">ONLINE</span>;
  }
  if (normalized === "TENTANDO") {
    return <span className="rounded-full bg-amber-500/20 px-2 py-1 text-xs font-semibold text-amber-300">TENTANDO</span>;
  }
  return <span className="rounded-full bg-sky-500/20 px-2 py-1 text-xs font-semibold text-sky-200">ACESSO_REGISTRADO</span>;
}

function SideDrawer({ open, onClose, title, children }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[9998] flex">
      <div className="flex-1 bg-black/40" onClick={onClose} />
      <div className="relative h-full w-full max-w-2xl border-l border-white/10 bg-[#0f141c] shadow-2xl">
        <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
          <h3 className="text-lg font-semibold text-white">{title}</h3>
          <button
            type="button"
            className="rounded-full border border-white/15 px-3 py-1 text-xs text-white/70 hover:text-white"
            onClick={onClose}
          >
            Fechar
          </button>
        </div>
        <div className="h-[calc(100%-68px)] overflow-y-auto p-5">{children}</div>
      </div>
    </div>
  );
}

function useScopedClientId() {
  const { tenantId, tenantScope, user } = useTenant();
  return useMemo(() => {
    if (tenantScope === "ALL") return null;
    return tenantId || user?.clientId || null;
  }, [tenantId, tenantScope, user?.clientId]);
}

function UsersTab() {
  const location = useLocation();
  const navigate = useNavigate();
  const scopedClientId = useScopedClientId();
  const { user } = useTenant();

  const search = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const page = toInt(search.get("u_page"), 1);
  const pageSize = search.get("u_pageSize") === "all" ? "all" : toInt(search.get("u_pageSize"), 20);
  const sortBy = pickSearchValue(search, "u_sortBy", "state");
  const sortDir = pickSearchValue(search, "u_sortDir", "desc") === "asc" ? "asc" : "desc";
  const userFilter = pickSearchValue(search, "u_user", "");
  const deviceFilter = pickSearchValue(search, "u_device", "");
  const passwordFilter = pickSearchValue(search, "u_password", "");
  const actionTypeFilter = pickSearchValue(search, "u_actionType", "");
  const resultFilter = pickSearchValue(search, "u_result", "");

  const [rows, setRows] = useState([]);
  const [meta, setMeta] = useState({ page: 1, pageSize: 20, totalItems: 0, totalPages: 1 });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState("");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerTab, setDrawerTab] = useState("status");
  const [selectedRow, setSelectedRow] = useState(null);
  const [selectedSummary, setSelectedSummary] = useState(null);
  const [showColumns, setShowColumns] = useState(false);
  const columnStorageKey = useMemo(
    () => `trust-center.users.columns:${user?.id || "anon"}:${scopedClientId || "all"}`,
    [scopedClientId, user?.id],
  );
  const [visibleColumns, setVisibleColumns] = useState(() => loadColumnVisibility(columnStorageKey) || USER_COLUMN_DEFAULTS);

  useEffect(() => {
    const stored = loadColumnVisibility(columnStorageKey) || USER_COLUMN_DEFAULTS;
    setVisibleColumns(stored);
  }, [columnStorageKey]);

  const updateSearch = useCallback(
    (updates = {}, { resetPage = false } = {}) => {
      const params = new URLSearchParams(location.search);
      Object.entries(updates).forEach(([key, value]) => {
        if (value === null || value === undefined || value === "") {
          params.delete(key);
          return;
        }
        params.set(key, String(value));
      });
      if (resetPage) {
        params.set("u_page", "1");
      }
      const searchString = params.toString();
      navigate({ pathname: location.pathname, search: searchString ? `?${searchString}` : "" }, { replace: true });
    },
    [location.pathname, location.search, navigate],
  );

  const loadUsers = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const payload = await CoreApi.trustCenterListUsers({
        clientId: scopedClientId || undefined,
        page,
        pageSize,
        sortBy,
        sortDir,
        user: userFilter || undefined,
        device: deviceFilter || undefined,
        password: passwordFilter || undefined,
        actionType: actionTypeFilter || undefined,
        result: resultFilter || undefined,
      });
      setRows(Array.isArray(payload?.items) ? payload.items : []);
      setMeta(payload?.meta || { page: 1, pageSize: 20, totalItems: 0, totalPages: 1 });
    } catch (requestError) {
      setError(requestError?.response?.data?.message || requestError?.message || "Falha ao carregar usuários do Trust Center.");
    } finally {
      setLoading(false);
    }
  }, [actionTypeFilter, deviceFilter, page, pageSize, passwordFilter, resultFilter, scopedClientId, sortBy, sortDir, userFilter]);

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  const loadSummary = useCallback(
    async (record) => {
      if (!record?.id) return;
      setSelectedSummary(null);
      setDrawerOpen(true);
      setDrawerTab("status");
      try {
        const payload = await CoreApi.trustCenterUserSummary(record.id, { clientId: scopedClientId || undefined });
        setSelectedSummary(payload || null);
      } catch (_error) {
        setSelectedSummary(null);
      }
    },
    [scopedClientId],
  );

  const handleSort = useCallback(
    (columnKey) => {
      if (sortBy === columnKey) {
        updateSearch({ u_sortDir: sortDir === "asc" ? "desc" : "asc" }, { resetPage: true });
        return;
      }
      updateSearch({ u_sortBy: columnKey, u_sortDir: "asc" }, { resetPage: true });
    },
    [sortBy, sortDir, updateSearch],
  );

  const handleRotate = useCallback(async () => {
    try {
      const payload = await CoreApi.trustCenterRotateChallenge({
        userId: selectedRow?.id || undefined,
        clientId: scopedClientId || undefined,
      });
      setFeedback(`Challenge rotacionado (${payload?.rotated || 0} registro(s)).`);
      await loadUsers();
      if (selectedRow) {
        await loadSummary(selectedRow);
      }
    } catch (requestError) {
      setFeedback(requestError?.response?.data?.message || "Falha ao rotacionar challenge.");
    }
  }, [loadSummary, loadUsers, scopedClientId, selectedRow]);

  const handleSimulate = useCallback(async () => {
    const target = selectedRow || rows[0] || null;
    if (!target) {
      setFeedback("Selecione um usuário para simular contra-senha.");
      return;
    }
    const basePassword = window.prompt("Informe a senha base de 6 dígitos para simulação:", "");
    if (!basePassword) return;
    try {
      const payload = await CoreApi.trustCenterSimulateCounterKey({
        userId: target.id,
        basePassword,
        clientId: scopedClientId || undefined,
      });
      setFeedback(`Simulação concluída: challenge ${payload?.challenge || "—"} -> contra-senha ${payload?.counterKey || "—"}`);
      await loadSummary(target);
    } catch (requestError) {
      setFeedback(requestError?.response?.data?.message || "Falha ao simular contra-senha.");
    }
  }, [loadSummary, rows, scopedClientId, selectedRow]);

  const toggleColumn = useCallback(
    (columnKey) => {
      setVisibleColumns((current) => {
        const next = { ...current, [columnKey]: !current[columnKey] };
        saveColumnVisibility(columnStorageKey, next);
        return next;
      });
    },
    [columnStorageKey],
  );

  const visibleUserColumns = useMemo(
    () => USER_COLUMNS.filter((column) => visibleColumns[column.key] !== false),
    [visibleColumns],
  );

  return (
    <div className="space-y-4">
      <FilterBar
        left={(
          <>
            <input
              value={userFilter}
              onChange={(event) => updateSearch({ u_user: event.target.value }, { resetPage: true })}
              placeholder="Usuário"
              className="h-10 rounded-lg border border-white/10 bg-[#0b0f17] px-3 text-sm text-white outline-none focus:border-primary"
            />
            <input
              value={deviceFilter}
              onChange={(event) => updateSearch({ u_device: event.target.value }, { resetPage: true })}
              placeholder="Dispositivo ESP32"
              className="h-10 rounded-lg border border-white/10 bg-[#0b0f17] px-3 text-sm text-white outline-none focus:border-primary"
            />
            <input
              value={passwordFilter}
              onChange={(event) => updateSearch({ u_password: event.target.value.replace(/\D/g, "").slice(0, 6) }, { resetPage: true })}
              placeholder="Senha (6 dígitos)"
              className="h-10 rounded-lg border border-white/10 bg-[#0b0f17] px-3 text-sm text-white outline-none focus:border-primary"
            />
            <input
              value={actionTypeFilter}
              onChange={(event) => updateSearch({ u_actionType: event.target.value }, { resetPage: true })}
              placeholder="Tipo de ação"
              className="h-10 rounded-lg border border-white/10 bg-[#0b0f17] px-3 text-sm text-white outline-none focus:border-primary"
            />
            <input
              value={resultFilter}
              onChange={(event) => updateSearch({ u_result: event.target.value }, { resetPage: true })}
              placeholder="Resultado"
              className="h-10 rounded-lg border border-white/10 bg-[#0b0f17] px-3 text-sm text-white outline-none focus:border-primary"
            />
          </>
        )}
        right={(
          <>
            <Button type="button" variant="ghost" onClick={loadUsers} className="inline-flex items-center gap-2">
              <RefreshCw className="h-4 w-4" />
              Atualizar
            </Button>
            <Button type="button" variant="outline" onClick={handleRotate} className="inline-flex items-center gap-2">
              <RotateCw className="h-4 w-4" />
              Rotacionar challenge
            </Button>
            <Button type="button" variant="outline" onClick={handleSimulate}>
              Simular contra-senha
            </Button>
            <Button type="button" variant="ghost" onClick={() => setShowColumns((state) => !state)} className="inline-flex items-center gap-2">
              Colunas
              <ChevronDown className="h-4 w-4" />
            </Button>
          </>
        )}
      />

      {showColumns && (
        <div className="rounded-xl border border-white/10 bg-[#0c1118] p-3">
          <div className="mb-2 text-xs uppercase tracking-[0.1em] text-white/60">Seleção de colunas</div>
          <div className="flex flex-wrap gap-2">
            {USER_COLUMNS.map((column) => (
              <label key={column.key} className="inline-flex items-center gap-2 rounded-lg border border-white/10 px-3 py-1 text-xs text-white/80">
                <input
                  type="checkbox"
                  checked={visibleColumns[column.key] !== false}
                  onChange={() => toggleColumn(column.key)}
                />
                {column.label}
              </label>
            ))}
          </div>
        </div>
      )}

      {feedback && <div className="rounded-lg border border-sky-400/30 bg-sky-400/10 px-3 py-2 text-sm text-sky-200">{feedback}</div>}
      {error && <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</div>}

      <div className="overflow-hidden rounded-2xl border border-white/10 bg-[#0f141c]">
        <DataTable className="w-full" tableClassName="min-w-[1200px] w-full">
          <thead className="border-b border-white/10 bg-white/[0.02]">
            <tr>
              {visibleUserColumns.map((column) => (
                <SortableHeader
                  key={column.key}
                  column={column}
                  currentSortBy={sortBy}
                  currentSortDir={sortDir}
                  onSort={handleSort}
                />
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={visibleUserColumns.length} className="px-4 py-4">
                  <SkeletonTable rows={6} columns={Math.max(visibleUserColumns.length, 6)} />
                </td>
              </tr>
            ) : rows.length ? (
              rows.map((row) => (
                <tr
                  key={row.id}
                  className="cursor-pointer border-b border-white/5 text-sm text-white/85 hover:bg-white/5"
                  onClick={() => {
                    setSelectedRow(row);
                    loadSummary(row);
                  }}
                >
                  {visibleUserColumns.map((column) => {
                    if (column.key === "state") {
                      return (
                        <td key={column.key} className="px-3 py-3">
                          <StateBadge value={row.state} />
                        </td>
                      );
                    }
                    if (["lastHeartbeatAt", "lastAttemptAt", "lastAccessAt"].includes(column.key)) {
                      return (
                        <td key={column.key} className="px-3 py-3 text-xs text-white/70">
                          {formatDate(row[column.key])}
                        </td>
                      );
                    }
                    return (
                      <td key={column.key} className="px-3 py-3 text-sm text-white/85">
                        {row[column.key] || "—"}
                      </td>
                    );
                  })}
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={visibleUserColumns.length} className="px-3 py-6 text-center text-sm text-white/60">
                  Nenhum registro encontrado.
                </td>
              </tr>
            )}
          </tbody>
        </DataTable>

        <DataTablePagination
          pageSize={pageSize}
          currentPage={meta?.page || page}
          totalPages={meta?.totalPages || 1}
          totalItems={meta?.totalItems || 0}
          onPageChange={(nextPage) => updateSearch({ u_page: nextPage })}
          onPageSizeChange={(nextPageSize) => updateSearch({ u_pageSize: nextPageSize, u_page: 1 })}
        />
      </div>

      <SideDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        title={selectedSummary?.summary?.userName || selectedRow?.userName || "Detalhes do usuário"}
      >
        <div className="space-y-4">
          <div className="rounded-xl border border-white/10 bg-[#0b1017] p-4">
            <div className="grid gap-2 text-sm text-white/80 sm:grid-cols-2">
              <div>
                <span className="text-white/50">Perfil:</span> {selectedSummary?.summary?.profile || selectedRow?.profile || "—"}
              </div>
              <div>
                <span className="text-white/50">Cliente:</span> {selectedSummary?.summary?.clientName || selectedRow?.clientName || "—"}
              </div>
              <div>
                <span className="text-white/50">Dispositivo:</span> {selectedSummary?.summary?.deviceName || selectedRow?.deviceName || "—"}
              </div>
              <div>
                <span className="text-white/50">Status atual:</span> {selectedSummary?.summary?.state || selectedRow?.state || "—"}
              </div>
            </div>
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setDrawerTab("status")}
              className={`rounded-lg border px-3 py-1 text-xs font-semibold uppercase tracking-[0.08em] ${
                drawerTab === "status" ? "border-sky-400/60 bg-sky-400/20 text-sky-100" : "border-white/10 text-white/70"
              }`}
            >
              Status
            </button>
            <button
              type="button"
              onClick={() => setDrawerTab("history")}
              className={`rounded-lg border px-3 py-1 text-xs font-semibold uppercase tracking-[0.08em] ${
                drawerTab === "history" ? "border-sky-400/60 bg-sky-400/20 text-sky-100" : "border-white/10 text-white/70"
              }`}
            >
              Histórico
            </button>
          </div>

          {drawerTab === "status" && (
            <div className="rounded-xl border border-white/10 bg-[#0b1017] p-4">
              <div className="grid gap-3 text-sm text-white/80 sm:grid-cols-2">
                <div>
                  <span className="text-white/50">Challenge:</span> {selectedSummary?.status?.challenge || selectedRow?.challenge || "—"}
                </div>
                <div>
                  <span className="text-white/50">Método:</span> {selectedSummary?.status?.method || selectedRow?.validationMethod || "—"}
                </div>
                <div>
                  <span className="text-white/50">Resultado:</span> {selectedSummary?.status?.result || selectedRow?.result || "—"}
                </div>
                <div>
                  <span className="text-white/50">Dispositivo:</span> {selectedSummary?.status?.device || selectedRow?.deviceName || "—"}
                </div>
                <div>
                  <span className="text-white/50">Último heartbeat:</span> {formatDate(selectedSummary?.status?.lastHeartbeatAt || selectedRow?.lastHeartbeatAt)}
                </div>
                <div>
                  <span className="text-white/50">Última tentativa:</span> {formatDate(selectedSummary?.status?.lastAttemptAt || selectedRow?.lastAttemptAt)}
                </div>
              </div>
            </div>
          )}

          {drawerTab === "history" && (
            <div className="rounded-xl border border-white/10 bg-[#0b1017] p-4">
              <div className="space-y-2">
                {(selectedSummary?.history || []).length ? (
                  selectedSummary.history.map((item) => (
                    <div key={item.id} className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/80">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-semibold text-white/90">{item.action || "Evento"}</span>
                        <span>{formatDate(item.date)}</span>
                      </div>
                      <div className="mt-1 flex flex-wrap gap-3 text-white/70">
                        <span>Método: {item.method || "—"}</span>
                        <span>Resultado: {item.result || "—"}</span>
                        <span>created_by: {item.created_by || "—"}</span>
                        <span>used_by: {item.used_by || "—"}</span>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="text-sm text-white/60">Nenhum evento relacionado encontrado.</div>
                )}
              </div>
            </div>
          )}
        </div>
      </SideDrawer>
    </div>
  );
}

function ActivityTab() {
  const location = useLocation();
  const navigate = useNavigate();
  const scopedClientId = useScopedClientId();

  const search = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const page = toInt(search.get("a_page"), 1);
  const pageSize = search.get("a_pageSize") === "all" ? "all" : toInt(search.get("a_pageSize"), 20);
  const sortBy = pickSearchValue(search, "a_sortBy", "date");
  const sortDir = pickSearchValue(search, "a_sortDir", "desc") === "asc" ? "asc" : "desc";
  const from = pickSearchValue(search, "a_from", "");
  const to = pickSearchValue(search, "a_to", "");
  const user = pickSearchValue(search, "a_user", "");
  const client = pickSearchValue(search, "a_client", "");
  const vehicle = pickSearchValue(search, "a_vehicle", "");
  const device = pickSearchValue(search, "a_device", "");
  const method = pickSearchValue(search, "a_method", "");
  const result = pickSearchValue(search, "a_result", "");

  const [rows, setRows] = useState([]);
  const [meta, setMeta] = useState({ page: 1, pageSize: 20, totalItems: 0, totalPages: 1 });
  const [extraColumns, setExtraColumns] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const updateSearch = useCallback(
    (updates = {}, { resetPage = false } = {}) => {
      const params = new URLSearchParams(location.search);
      Object.entries(updates).forEach(([key, value]) => {
        if (value === null || value === undefined || value === "") {
          params.delete(key);
          return;
        }
        params.set(key, String(value));
      });
      if (resetPage) params.set("a_page", "1");
      const searchString = params.toString();
      navigate({ pathname: location.pathname, search: searchString ? `?${searchString}` : "" }, { replace: true });
    },
    [location.pathname, location.search, navigate],
  );

  const loadActivity = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const payload = await CoreApi.trustCenterListActivity({
        clientId: scopedClientId || undefined,
        page,
        pageSize,
        sortBy,
        sortDir,
        from: from || undefined,
        to: to || undefined,
        user: user || undefined,
        client: client || undefined,
        vehicle: vehicle || undefined,
        device: device || undefined,
        method: method || undefined,
        result: result || undefined,
      });
      setRows(Array.isArray(payload?.items) ? payload.items : []);
      setMeta(payload?.meta || { page: 1, pageSize: 20, totalItems: 0, totalPages: 1 });
      setExtraColumns(Array.isArray(payload?.extraColumns) ? payload.extraColumns : []);
    } catch (requestError) {
      setError(requestError?.response?.data?.message || requestError?.message || "Falha ao carregar auditoria do Trust Center.");
    } finally {
      setLoading(false);
    }
  }, [client, device, from, method, page, pageSize, result, scopedClientId, sortBy, sortDir, to, user, vehicle]);

  useEffect(() => {
    loadActivity();
  }, [loadActivity]);

  const handleExport = useCallback(async () => {
    try {
      const content = await CoreApi.trustCenterExportActivityCsv({
        clientId: scopedClientId || undefined,
        sortBy,
        sortDir,
        from: from || undefined,
        to: to || undefined,
        user: user || undefined,
        client: client || undefined,
        vehicle: vehicle || undefined,
        device: device || undefined,
        method: method || undefined,
        result: result || undefined,
      });
      const blob = new Blob([String(content || "")], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `trust-center-historico-${Date.now()}.csv`;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(url);
    } catch (_error) {
      setError("Falha ao exportar histórico.");
    }
  }, [client, device, from, method, result, scopedClientId, sortBy, sortDir, to, user, vehicle]);

  return (
    <div className="space-y-4">
      <FilterBar
        left={(
          <>
            <input type="date" value={from} onChange={(event) => updateSearch({ a_from: event.target.value }, { resetPage: true })} className="h-10 rounded-lg border border-white/10 bg-[#0b0f17] px-3 text-sm text-white" />
            <input type="date" value={to} onChange={(event) => updateSearch({ a_to: event.target.value }, { resetPage: true })} className="h-10 rounded-lg border border-white/10 bg-[#0b0f17] px-3 text-sm text-white" />
            <input value={user} onChange={(event) => updateSearch({ a_user: event.target.value }, { resetPage: true })} placeholder="Usuário" className="h-10 rounded-lg border border-white/10 bg-[#0b0f17] px-3 text-sm text-white" />
            <input value={client} onChange={(event) => updateSearch({ a_client: event.target.value }, { resetPage: true })} placeholder="Cliente" className="h-10 rounded-lg border border-white/10 bg-[#0b0f17] px-3 text-sm text-white" />
            <input value={vehicle} onChange={(event) => updateSearch({ a_vehicle: event.target.value }, { resetPage: true })} placeholder="Veículo" className="h-10 rounded-lg border border-white/10 bg-[#0b0f17] px-3 text-sm text-white" />
            <input value={device} onChange={(event) => updateSearch({ a_device: event.target.value }, { resetPage: true })} placeholder="Dispositivo" className="h-10 rounded-lg border border-white/10 bg-[#0b0f17] px-3 text-sm text-white" />
            <input value={method} onChange={(event) => updateSearch({ a_method: event.target.value }, { resetPage: true })} placeholder="Método" className="h-10 rounded-lg border border-white/10 bg-[#0b0f17] px-3 text-sm text-white" />
            <input value={result} onChange={(event) => updateSearch({ a_result: event.target.value }, { resetPage: true })} placeholder="Resultado" className="h-10 rounded-lg border border-white/10 bg-[#0b0f17] px-3 text-sm text-white" />
          </>
        )}
        right={(
          <>
            <Button type="button" variant="ghost" onClick={loadActivity} className="inline-flex items-center gap-2">
              <RefreshCw className="h-4 w-4" />
              Atualizar
            </Button>
            <Button type="button" variant="outline" onClick={handleExport}>
              Exportar dados
            </Button>
          </>
        )}
      />

      {error && <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</div>}

      <div className="overflow-hidden rounded-2xl border border-white/10 bg-[#0f141c]">
        <DataTable className="w-full" tableClassName="min-w-[1300px] w-full">
          <thead className="border-b border-white/10 bg-white/[0.02]">
            <tr>
              <th className="px-3 py-2 text-left text-[11px] uppercase tracking-[0.08em] text-white/60">Data</th>
              <th className="px-3 py-2 text-left text-[11px] uppercase tracking-[0.08em] text-white/60">Usuário</th>
              <th className="px-3 py-2 text-left text-[11px] uppercase tracking-[0.08em] text-white/60">Perfil</th>
              <th className="px-3 py-2 text-left text-[11px] uppercase tracking-[0.08em] text-white/60">Cliente</th>
              <th className="px-3 py-2 text-left text-[11px] uppercase tracking-[0.08em] text-white/60">Veículo</th>
              <th className="px-3 py-2 text-left text-[11px] uppercase tracking-[0.08em] text-white/60">Dispositivo</th>
              <th className="px-3 py-2 text-left text-[11px] uppercase tracking-[0.08em] text-white/60">Método</th>
              <th className="px-3 py-2 text-left text-[11px] uppercase tracking-[0.08em] text-white/60">Ação executada</th>
              <th className="px-3 py-2 text-left text-[11px] uppercase tracking-[0.08em] text-white/60">Resultado</th>
              {extraColumns.map((column) => (
                <th key={column} className="px-3 py-2 text-left text-[11px] uppercase tracking-[0.08em] text-white/60">
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={9 + extraColumns.length} className="px-4 py-4">
                  <SkeletonTable rows={6} columns={9 + extraColumns.length} />
                </td>
              </tr>
            ) : rows.length ? (
              rows.map((row) => (
                <tr key={row.id} className="border-b border-white/5 text-sm text-white/85">
                  <td className="px-3 py-3 text-xs text-white/70">{formatDate(row.date)}</td>
                  <td className="px-3 py-3">{row.user || "—"}</td>
                  <td className="px-3 py-3">{row.profile || "—"}</td>
                  <td className="px-3 py-3">{row.client || "—"}</td>
                  <td className="px-3 py-3">{row.vehicle || "—"}</td>
                  <td className="px-3 py-3">{row.device || "—"}</td>
                  <td className="px-3 py-3">{row.method || "—"}</td>
                  <td className="px-3 py-3">{row.action || "—"}</td>
                  <td className="px-3 py-3">{row.result || "—"}</td>
                  {extraColumns.map((column) => (
                    <td key={column} className="px-3 py-3">{row.extra?.[column] ?? "—"}</td>
                  ))}
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={9 + extraColumns.length} className="px-3 py-6 text-center text-sm text-white/60">
                  Nenhum evento de auditoria encontrado.
                </td>
              </tr>
            )}
          </tbody>
        </DataTable>

        <DataTablePagination
          pageSize={pageSize}
          currentPage={meta?.page || page}
          totalPages={meta?.totalPages || 1}
          totalItems={meta?.totalItems || 0}
          onPageChange={(nextPage) => updateSearch({ a_page: nextPage })}
          onPageSizeChange={(nextPageSize) => updateSearch({ a_pageSize: nextPageSize, a_page: 1 })}
        />
      </div>
    </div>
  );
}

function CounterKeyTab() {
  const location = useLocation();
  const navigate = useNavigate();
  const scopedClientId = useScopedClientId();

  const search = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const page = toInt(search.get("c_page"), 1);
  const pageSize = search.get("c_pageSize") === "all" ? "all" : toInt(search.get("c_pageSize"), 20);
  const sortBy = pickSearchValue(search, "c_sortBy", "createdAt");
  const sortDir = pickSearchValue(search, "c_sortDir", "desc") === "asc" ? "asc" : "desc";
  const userFilter = pickSearchValue(search, "c_user", "");
  const clientFilter = pickSearchValue(search, "c_client", "");
  const vehicleFilter = pickSearchValue(search, "c_vehicle", "");
  const deviceFilter = pickSearchValue(search, "c_device", "");
  const statusFilter = pickSearchValue(search, "c_status", "");

  const [rows, setRows] = useState([]);
  const [meta, setMeta] = useState({ page: 1, pageSize: 20, totalItems: 0, totalPages: 1 });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState("");
  const [options, setOptions] = useState({ users: [], vehicles: [] });
  const [form, setForm] = useState({ userId: "", vehicle: "", basePassword: "" });

  const updateSearch = useCallback(
    (updates = {}, { resetPage = false } = {}) => {
      const params = new URLSearchParams(location.search);
      Object.entries(updates).forEach(([key, value]) => {
        if (value === null || value === undefined || value === "") {
          params.delete(key);
          return;
        }
        params.set(key, String(value));
      });
      if (resetPage) params.set("c_page", "1");
      const searchString = params.toString();
      navigate({ pathname: location.pathname, search: searchString ? `?${searchString}` : "" }, { replace: true });
    },
    [location.pathname, location.search, navigate],
  );

  const loadOptions = useCallback(async () => {
    try {
      const payload = await CoreApi.trustCenterUserOptions({ clientId: scopedClientId || undefined });
      setOptions({
        users: Array.isArray(payload?.users) ? payload.users : [],
        vehicles: Array.isArray(payload?.vehicles) ? payload.vehicles : [],
      });
    } catch (_error) {
      setOptions({ users: [], vehicles: [] });
    }
  }, [scopedClientId]);

  const loadCounterKeys = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const payload = await CoreApi.trustCenterListCounterKeys({
        clientId: scopedClientId || undefined,
        page,
        pageSize,
        sortBy,
        sortDir,
        user: userFilter || undefined,
        client: clientFilter || undefined,
        vehicle: vehicleFilter || undefined,
        device: deviceFilter || undefined,
        status: statusFilter || undefined,
      });
      setRows(Array.isArray(payload?.items) ? payload.items : []);
      setMeta(payload?.meta || { page: 1, pageSize: 20, totalItems: 0, totalPages: 1 });
    } catch (requestError) {
      setError(requestError?.response?.data?.message || requestError?.message || "Falha ao carregar contra-senhas.");
    } finally {
      setLoading(false);
    }
  }, [clientFilter, deviceFilter, page, pageSize, scopedClientId, sortBy, sortDir, statusFilter, userFilter, vehicleFilter]);

  useEffect(() => {
    loadOptions();
  }, [loadOptions]);

  useEffect(() => {
    loadCounterKeys();
  }, [loadCounterKeys]);

  const handleCreate = useCallback(async () => {
    if (!form.userId) {
      setFeedback("Selecione o usuário alvo.");
      return;
    }
    if (!/^\d{6}$/.test(form.basePassword || "")) {
      setFeedback("Informe uma senha base de 6 dígitos.");
      return;
    }
    try {
      await CoreApi.trustCenterCreateCounterKey({
        clientId: scopedClientId || undefined,
        userId: form.userId,
        vehicle: form.vehicle || undefined,
        basePassword: form.basePassword,
      });
      setForm((current) => ({ ...current, basePassword: "" }));
      setFeedback("Contra-senha criada com sucesso.");
      await loadCounterKeys();
    } catch (requestError) {
      setFeedback(requestError?.response?.data?.message || "Falha ao criar contra-senha.");
    }
  }, [form.basePassword, form.userId, form.vehicle, loadCounterKeys, scopedClientId]);

  const handleUse = useCallback(
    async (row) => {
      const usedByName = window.prompt("Informe o usuário que utilizou a contra-senha:", "");
      try {
        await CoreApi.trustCenterUseCounterKey(row.id, {
          clientId: scopedClientId || undefined,
          usedByName: usedByName || undefined,
        });
        setFeedback("Uso de contra-senha registrado.");
        await loadCounterKeys();
      } catch (requestError) {
        setFeedback(requestError?.response?.data?.message || "Falha ao registrar uso da contra-senha.");
      }
    },
    [loadCounterKeys, scopedClientId],
  );

  const handleCancel = useCallback(
    async (row) => {
      try {
        await CoreApi.trustCenterCancelCounterKey(row.id, { clientId: scopedClientId || undefined });
        setFeedback("Contra-senha cancelada.");
        await loadCounterKeys();
      } catch (requestError) {
        setFeedback(requestError?.response?.data?.message || "Falha ao cancelar contra-senha.");
      }
    },
    [loadCounterKeys, scopedClientId],
  );

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-white/10 bg-[#0f141c] p-4">
        <div className="mb-3 text-sm font-semibold text-white">Criar nova contra-senha</div>
        <div className="grid gap-3 md:grid-cols-3">
          <select
            value={form.userId}
            onChange={(event) => setForm((current) => ({ ...current, userId: event.target.value }))}
            className="h-10 rounded-lg border border-white/10 bg-[#0b0f17] px-3 text-sm text-white"
          >
            <option value="">Selecionar usuário</option>
            {options.users.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
          <select
            value={form.vehicle}
            onChange={(event) => setForm((current) => ({ ...current, vehicle: event.target.value }))}
            className="h-10 rounded-lg border border-white/10 bg-[#0b0f17] px-3 text-sm text-white"
          >
            <option value="">Selecionar veículo</option>
            {options.vehicles.map((option) => (
              <option key={option.id} value={option.label}>
                {option.label}
              </option>
            ))}
          </select>
          <input
            value={form.basePassword}
            onChange={(event) => setForm((current) => ({ ...current, basePassword: event.target.value.replace(/\D/g, "").slice(0, 6) }))}
            placeholder="Senha base (6 dígitos)"
            className="h-10 rounded-lg border border-white/10 bg-[#0b0f17] px-3 text-sm text-white"
          />
        </div>
        <div className="mt-3 flex justify-end">
          <Button type="button" onClick={handleCreate}>Gerar contra-senha</Button>
        </div>
      </div>

      <FilterBar
        left={(
          <>
            <input value={userFilter} onChange={(event) => updateSearch({ c_user: event.target.value }, { resetPage: true })} placeholder="Usuário" className="h-10 rounded-lg border border-white/10 bg-[#0b0f17] px-3 text-sm text-white" />
            <input value={clientFilter} onChange={(event) => updateSearch({ c_client: event.target.value }, { resetPage: true })} placeholder="Cliente" className="h-10 rounded-lg border border-white/10 bg-[#0b0f17] px-3 text-sm text-white" />
            <input value={vehicleFilter} onChange={(event) => updateSearch({ c_vehicle: event.target.value }, { resetPage: true })} placeholder="Veículo" className="h-10 rounded-lg border border-white/10 bg-[#0b0f17] px-3 text-sm text-white" />
            <input value={deviceFilter} onChange={(event) => updateSearch({ c_device: event.target.value }, { resetPage: true })} placeholder="Dispositivo" className="h-10 rounded-lg border border-white/10 bg-[#0b0f17] px-3 text-sm text-white" />
            <select value={statusFilter} onChange={(event) => updateSearch({ c_status: event.target.value }, { resetPage: true })} className="h-10 rounded-lg border border-white/10 bg-[#0b0f17] px-3 text-sm text-white">
              <option value="">Status (todos)</option>
              <option value="ATIVA">ATIVA</option>
              <option value="USADA">USADA</option>
              <option value="EXPIRADA">EXPIRADA</option>
              <option value="CANCELADA">CANCELADA</option>
            </select>
          </>
        )}
        right={(
          <Button type="button" variant="ghost" onClick={loadCounterKeys} className="inline-flex items-center gap-2">
            <RefreshCw className="h-4 w-4" />
            Atualizar
          </Button>
        )}
      />

      {feedback && <div className="rounded-lg border border-sky-400/30 bg-sky-400/10 px-3 py-2 text-sm text-sky-200">{feedback}</div>}
      {error && <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</div>}

      <div className="overflow-hidden rounded-2xl border border-white/10 bg-[#0f141c]">
        <DataTable className="w-full" tableClassName="min-w-[1450px] w-full">
          <thead className="border-b border-white/10 bg-white/[0.02]">
            <tr>
              <th className="px-3 py-2 text-left text-[11px] uppercase tracking-[0.08em] text-white/60">Data de criação</th>
              <th className="px-3 py-2 text-left text-[11px] uppercase tracking-[0.08em] text-white/60">Usuário que gerou</th>
              <th className="px-3 py-2 text-left text-[11px] uppercase tracking-[0.08em] text-white/60">Usuário alvo</th>
              <th className="px-3 py-2 text-left text-[11px] uppercase tracking-[0.08em] text-white/60">Cliente</th>
              <th className="px-3 py-2 text-left text-[11px] uppercase tracking-[0.08em] text-white/60">Veículo</th>
              <th className="px-3 py-2 text-left text-[11px] uppercase tracking-[0.08em] text-white/60">Dispositivo</th>
              <th className="px-3 py-2 text-left text-[11px] uppercase tracking-[0.08em] text-white/60">Senha base</th>
              <th className="px-3 py-2 text-left text-[11px] uppercase tracking-[0.08em] text-white/60">Contra-senha</th>
              <th className="px-3 py-2 text-left text-[11px] uppercase tracking-[0.08em] text-white/60">Status</th>
              <th className="px-3 py-2 text-left text-[11px] uppercase tracking-[0.08em] text-white/60">Nº usos</th>
              <th className="px-3 py-2 text-left text-[11px] uppercase tracking-[0.08em] text-white/60">Primeiro uso</th>
              <th className="px-3 py-2 text-left text-[11px] uppercase tracking-[0.08em] text-white/60">Último uso</th>
              <th className="px-3 py-2 text-left text-[11px] uppercase tracking-[0.08em] text-white/60">Usuário que utilizou</th>
              <th className="px-3 py-2 text-right text-[11px] uppercase tracking-[0.08em] text-white/60">Ações</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={14} className="px-4 py-4">
                  <SkeletonTable rows={6} columns={14} />
                </td>
              </tr>
            ) : rows.length ? (
              rows.map((row) => (
                <tr key={row.id} className="border-b border-white/5 text-sm text-white/85">
                  <td className="px-3 py-3 text-xs text-white/70">{formatDate(row.createdAt)}</td>
                  <td className="px-3 py-3">{row.createdBy?.name || "—"}</td>
                  <td className="px-3 py-3">{row.targetUserName || "—"}</td>
                  <td className="px-3 py-3">{row.clientName || "—"}</td>
                  <td className="px-3 py-3">{row.vehicle || "—"}</td>
                  <td className="px-3 py-3">{row.deviceName || "—"}</td>
                  <td className="px-3 py-3">{row.basePasswordMasked || "—"}</td>
                  <td className="px-3 py-3 font-semibold text-sky-200">{row.counterKey || "—"}</td>
                  <td className="px-3 py-3">{row.status || "—"}</td>
                  <td className="px-3 py-3">{row.usesCount || 0}/{row.maxUses || 0}</td>
                  <td className="px-3 py-3 text-xs text-white/70">{formatDate(row.firstUsedAt)}</td>
                  <td className="px-3 py-3 text-xs text-white/70">{formatDate(row.lastUsedAt)}</td>
                  <td className="px-3 py-3">{row.usedBy?.name || "—"}</td>
                  <td className="px-3 py-3 text-right">
                    <div className="inline-flex gap-2">
                      {row.status === "ATIVA" && (
                        <>
                          <button type="button" className="rounded border border-emerald-400/40 px-2 py-1 text-xs text-emerald-200" onClick={() => handleUse(row)}>
                            Registrar uso
                          </button>
                          <button type="button" className="rounded border border-red-400/40 px-2 py-1 text-xs text-red-200" onClick={() => handleCancel(row)}>
                            Cancelar
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={14} className="px-3 py-6 text-center text-sm text-white/60">
                  Nenhuma contra-senha encontrada.
                </td>
              </tr>
            )}
          </tbody>
        </DataTable>

        <DataTablePagination
          pageSize={pageSize}
          currentPage={meta?.page || page}
          totalPages={meta?.totalPages || 1}
          totalItems={meta?.totalItems || 0}
          onPageChange={(nextPage) => updateSearch({ c_page: nextPage })}
          onPageSizeChange={(nextPageSize) => updateSearch({ c_pageSize: nextPageSize, c_page: 1 })}
        />
      </div>
    </div>
  );
}

export function TrustCenterRedirect() {
  return <Navigate to="/trust-center/users" replace />;
}

export default function TrustCenterPage() {
  const location = useLocation();
  const currentTab = normalizeTab(location.pathname);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Trust Center"
        subtitle="Painel de gerenciamento de acessos, auditoria de ações e geração de contra-senha para dispositivos ESP32."
        rightSlot={(
          <div className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs uppercase tracking-[0.08em] text-white/70">
            <Shield className="h-4 w-4 text-sky-300" />
            Segurança
          </div>
        )}
      />

      <div className="flex flex-wrap gap-2">
        {TAB_ITEMS.map((tab) => (
          <NavLink
            key={tab.key}
            to={tab.path}
            className={`rounded-lg border px-3 py-2 text-sm font-semibold transition ${
              currentTab === tab.key
                ? "border-sky-400/50 bg-sky-400/20 text-sky-100"
                : "border-white/10 bg-white/5 text-white/70 hover:bg-white/10"
            }`}
          >
            {tab.label}
          </NavLink>
        ))}
      </div>

      {currentTab === "users" && <UsersTab />}
      {currentTab === "activity" && <ActivityTab />}
      {currentTab === "counter-key" && <CounterKeyTab />}
    </div>
  );
}
