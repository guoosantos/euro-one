import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Eye, Pencil, RefreshCw, Trash2 } from "lucide-react";

import PageHeader from "../../components/ui/PageHeader.jsx";
import FilterBar from "../../components/ui/FilterBar.jsx";
import DataTable from "../../components/ui/DataTable.jsx";
import EmptyState from "../../components/ui/EmptyState.jsx";
import SkeletonTable from "../../components/ui/SkeletonTable.jsx";
import AutocompleteSelect from "../../components/ui/AutocompleteSelect.jsx";
import DataState from "../../ui/DataState.jsx";
import DataTablePagination from "../../ui/DataTablePagination.jsx";
import api from "../../lib/api.js";
import { useTenant } from "../../lib/tenant-context.jsx";
import { usePermissionGate, usePermissions } from "../../lib/permissions/permission-gate.js";
import { useConfirmDialog } from "../../components/ui/ConfirmDialogProvider.jsx";
import usePageToast from "../../lib/hooks/usePageToast.js";
import PageToast from "../../components/ui/PageToast.jsx";
import { buildEquipmentDisplayLabel, splitEquipmentText } from "../../lib/equipment-display.js";

const STATUS_OPTIONS = [
  { value: "", label: "Todos" },
  { value: "SOLICITADA", label: "Solicitada" },
  { value: "AGENDADA", label: "Agendada" },
  { value: "EM_DESLOCAMENTO", label: "Em deslocamento" },
  { value: "EM_EXECUCAO", label: "Em execução" },
  { value: "AGUARDANDO_APROVACAO", label: "Aguardando aprovação" },
  { value: "PENDENTE_APROVACAO_ADMIN", label: "Pendente aprovação admin" },
  { value: "EM_RETRABALHO", label: "Em retrabalho" },
  { value: "REENVIADA_PARA_APROVACAO", label: "Reenviada para aprovação" },
  { value: "APROVADA", label: "Aprovada" },
  { value: "CONCLUIDA", label: "Concluída" },
  { value: "CANCELADA", label: "Cancelada" },
  { value: "REMANEJADA", label: "Remanejada" },
];

const TYPE_CHIPS = [
  { key: "ALL", label: "TODOS", permission: { menuKey: "fleet", pageKey: "services", subKey: "service-orders-all" } },
  { key: "INSTALACAO", label: "INSTALAÇÃO", permission: { menuKey: "fleet", pageKey: "services", subKey: "service-orders-installation" } },
  { key: "MANUTENCAO", label: "MANUTENÇÃO", permission: { menuKey: "fleet", pageKey: "services", subKey: "service-orders-maintenance" } },
  { key: "RETIRADA", label: "RETIRADA", permission: { menuKey: "fleet", pageKey: "services", subKey: "service-orders-removal" } },
  { key: "SOCORRO", label: "SOCORRO", permission: { menuKey: "fleet", pageKey: "services", subKey: "service-orders-socorro" } },
  { key: "REMANEJAMENTO", label: "REMANEJAMENTO", permission: { menuKey: "fleet", pageKey: "services", subKey: "service-orders-remanejamento" } },
  { key: "REINSTALACAO", label: "REINSTALAÇÃO", permission: { menuKey: "fleet", pageKey: "services", subKey: "service-orders-reinstall" } },
];
const TYPE_LABEL_BY_KEY = Object.freeze(
  TYPE_CHIPS.reduce((acc, chip) => {
    if (chip.key !== "ALL") acc[chip.key] = chip.label;
    return acc;
  }, {}),
);
const FINAL_STATUS_WITH_TYPE = new Set(["CONCLUIDA", "APROVADA", "CANCELADA", "REMANEJADA"]);
const STATUS_LABEL_BY_KEY = Object.freeze({
  CONCLUIDA: "CONCLUÍDA",
  APROVADA: "APROVADA",
  CANCELADA: "CANCELADA",
  REMANEJADA: "REMANEJADA",
});
const PAGE_SIZE_OPTIONS = [25, 50, 100];
const DEFAULT_PAGE_SIZE = 50;
const APP_TIMEZONE = "America/Sao_Paulo";

function parseApiDate(value) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === "number") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const raw = String(value).trim();
  if (!raw) return null;
  let normalized = raw;
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?$/.test(normalized)) {
    normalized = normalized.replace(" ", "T");
  }
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?$/.test(normalized)) {
    normalized = `${normalized}Z`;
  }
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatDate(value) {
  if (!value) return "—";
  const date = parseApiDate(value);
  if (!date) return "—";
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: APP_TIMEZONE,
  }).format(date);
}

function normalizeType(value) {
  if (!value) return "";
  return String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();
}

function normalizeStatusKey(value) {
  return String(value || "")
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();
}

function formatServiceTypeLabel(value) {
  const key = normalizeType(value);
  if (!key) return "";
  if (TYPE_LABEL_BY_KEY[key]) return TYPE_LABEL_BY_KEY[key];
  return String(value || "").trim().replace(/_/g, " ").toUpperCase();
}

function formatStatusWithType(status, type) {
  const statusKey = normalizeStatusKey(status);
  if (!statusKey) return "—";
  const baseStatus = STATUS_LABEL_BY_KEY[statusKey] || String(status || "").trim().replace(/_/g, " ").toUpperCase();
  if (!FINAL_STATUS_WITH_TYPE.has(statusKey)) return baseStatus;
  const typeLabel = formatServiceTypeLabel(type);
  return typeLabel ? `${baseStatus} ${typeLabel}` : baseStatus;
}

function resolveOrderDate(item) {
  return item?.startAt || item?.createdAt || item?.updatedAt || null;
}

function formatKmTotal(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return "—";
  return `${new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 }).format(parsed)} km`;
}

function buildEquipmentLabels(item) {
  const list = Array.isArray(item?.equipmentsData) ? item.equipmentsData : null;
  if (list && list.length) {
    return list.map((equipment, index) => {
      const serverLabel = String(equipment?.equipmentDisplay || "").trim();
      if (serverLabel) return serverLabel;
      return buildEquipmentDisplayLabel(equipment, index);
    });
  }
  const displayList = Array.isArray(item?.equipmentDisplay) ? item.equipmentDisplay : [];
  if (displayList.length) {
    return displayList
      .map((entry) => String(entry || "").trim())
      .filter(Boolean);
  }
  if (item?.equipmentsText) {
    return splitEquipmentText(item.equipmentsText);
  }
  return [];
}

export default function ServiceOrdersList() {
  const { user, tenants, hasAdminAccess } = useTenant();
  const listPermission = usePermissionGate({ menuKey: "fleet", pageKey: "services", subKey: "service-orders" });
  const { getPermission } = usePermissions();
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState([]);
  const [error, setError] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [forbidden, setForbidden] = useState(false);
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [clientId, setClientId] = useState(() => {
    if (user?.role === "admin") return "";
    if (user?.role === "technician") return "";
    return user?.clientId ? String(user.clientId) : "";
  });
  const { confirmDelete } = useConfirmDialog();
  const { toast, showToast } = usePageToast();
  const [activeType, setActiveType] = useState("ALL");
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const retryCooldownRef = useRef(0);

  useEffect(() => {
    if (!user) return;
    if (user.role === "technician") {
      setClientId("");
      return;
    }
    if (user.role !== "admin") {
      setClientId(user.clientId ? String(user.clientId) : "");
      return;
    }
  }, [user]);

  const fetchOrders = async ({ force = false } = {}) => {
    if (!listPermission.hasAccess) {
      setForbidden(true);
      setLoading(false);
      setItems([]);
      setError(null);
      return;
    }
    const now = Date.now();
    if (!force && retryCooldownRef.current > now) {
      return;
    }
    setLoading(true);
    setError(null);
    setActionError(null);
    const params = {};
    try {
      if (status) params.status = status;
      if (q) params.q = q;
      if (from) params.from = new Date(from).toISOString();
      if (to) params.to = new Date(to).toISOString();
      if (clientId && user?.role !== "technician") params.clientId = clientId;

      const response = await api.get("core/service-orders", { params });
      setItems(response?.data?.items || []);
      retryCooldownRef.current = 0;
    } catch (error) {
      const statusCode = error?.response?.status ?? error?.status;
      if (statusCode === 403) {
        setForbidden(true);
        setError(null);
        setItems([]);
        return;
      }
      console.error("Falha ao buscar ordens de serviço", {
        params,
        status: statusCode,
        error,
      });
      if (statusCode === 503) {
        retryCooldownRef.current = now + 30_000;
        setError(new Error("Serviço indisponível no momento. Tente novamente em instantes."));
      } else {
        setError(error instanceof Error ? error : new Error("Falha ao carregar ordens de serviço."));
      }
      setItems([]);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (item) => {
    if (!item?.id) return;
    await confirmDelete({
      title: "Excluir ordem de serviço",
      message: "Tem certeza que deseja excluir a ordem de serviço? Essa ação não pode ser desfeita.",
      confirmLabel: "Excluir",
      onConfirm: async () => {
        try {
          const params = clientId && user?.role !== "technician" ? { clientId } : undefined;
          await api.delete(`core/service-orders/${item.id}`, { params });
          setItems((prev) => prev.filter((entry) => entry.id !== item.id));
          setActionError(null);
          showToast("Excluído com sucesso.");
        } catch (requestError) {
          setActionError("Falha ao excluir.");
          showToast("Falha ao excluir.", "error");
          throw requestError;
        }
      },
    });
  };

  useEffect(() => {
    if (!listPermission.canShow) return;
    setForbidden(false);
    fetchOrders();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, clientId, listPermission.canShow]);

  const baseFiltered = useMemo(() => {
    const term = q ? q.toLowerCase() : "";
    const fromDate = from ? new Date(from) : null;
    const toDate = to ? new Date(to) : null;
    if (toDate) {
      toDate.setHours(23, 59, 59, 999);
    }
    return items.filter((item) => {
      const orderDate = resolveOrderDate(item);
      if (fromDate || toDate) {
        const parsed = orderDate ? new Date(orderDate) : null;
        if (!parsed || Number.isNaN(parsed.getTime())) return false;
        if (fromDate && parsed < fromDate) return false;
        if (toDate && parsed > toDate) return false;
      }
      if (status && String(item?.status || "") !== String(status)) return false;
      if (clientId && user?.role !== "technician" && String(item?.clientId || "") !== String(clientId)) return false;
      if (!term) return true;
      const values = [
        item.osInternalId,
        item.vehicle?.plate,
        item.vehicle?.name,
        item.clientName,
        item.vehicle?.clientName,
        item.responsibleName,
        item.responsiblePhone,
        item.technicianName,
        item.reason,
      ];
      return values.some((value) => String(value || "").toLowerCase().includes(term));
    });
  }, [clientId, from, items, q, status, to, user?.role]);

  const counts = useMemo(() => {
    const nextCounts = TYPE_CHIPS.reduce(
      (acc, chip) => ({ ...acc, [chip.key]: 0 }),
      {},
    );
    nextCounts.ALL = baseFiltered.length;
    baseFiltered.forEach((item) => {
      const key = normalizeType(item.type);
      if (key && Object.prototype.hasOwnProperty.call(nextCounts, key)) {
        nextCounts[key] += 1;
      }
    });
    return nextCounts;
  }, [baseFiltered]);

  const availableTypeChips = useMemo(
    () => TYPE_CHIPS.filter((chip) => getPermission(chip.permission).canShow),
    [getPermission],
  );

  useEffect(() => {
    if (!availableTypeChips.length) {
      setActiveType("");
      return;
    }
    const hasActive = availableTypeChips.some((chip) => chip.key === activeType);
    if (!hasActive) {
      setActiveType(availableTypeChips[0].key);
    }
  }, [activeType, availableTypeChips]);

  useEffect(() => {
    if (loading) return;
    const raw = sessionStorage.getItem("serviceOrders:created");
    if (!raw) return;
    sessionStorage.removeItem("serviceOrders:created");
    try {
      const created = JSON.parse(raw);
      if (!created?.id) return;
      if (clientId && String(created.clientId) !== String(clientId)) return;
      if (status && String(created.status) !== String(status)) return;
      setItems((prev) => {
        if (prev.some((entry) => entry.id === created.id)) return prev;
        return [created, ...prev];
      });
    } catch {
      // ignore malformed payload
    }
  }, [clientId, loading, status]);

  const filtered = useMemo(() => {
    if (activeType === "ALL") return baseFiltered;
    return baseFiltered.filter((item) => normalizeType(item.type) === activeType);
  }, [activeType, baseFiltered]);

  const totalFiltered = filtered.length;
  const totalPages = Math.max(1, Math.ceil(totalFiltered / pageSize));
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const paginatedItems = useMemo(() => {
    const start = (safeCurrentPage - 1) * pageSize;
    return filtered.slice(start, start + pageSize);
  }, [filtered, pageSize, safeCurrentPage]);

  useEffect(() => {
    setCurrentPage(1);
  }, [activeType, clientId, from, pageSize, q, status, to]);

  useEffect(() => {
    if (currentPage <= totalPages) return;
    setCurrentPage(totalPages);
  }, [currentPage, totalPages]);

  const clientOptions = useMemo(() => {
    if (!hasAdminAccess) {
      return tenants.length
        ? tenants
        : user?.clientId
          ? [{ id: user.clientId, name: user.attributes?.companyName || user.name || "Meu cliente" }]
          : [];
    }
    return tenants;
  }, [hasAdminAccess, tenants, user]);

  const clientAutocompleteOptions = useMemo(() => {
    const baseOptions = clientOptions.map((client) => ({
      value: String(client.id),
      label: client.name,
    }));
    if (!hasAdminAccess) {
      return baseOptions;
    }
    return [{ value: "", label: "Todos os clientes" }, ...baseOptions];
  }, [clientOptions, hasAdminAccess]);

  if (forbidden || (!listPermission.loading && !listPermission.canShow)) {
    return (
      <div className="flex min-h-[calc(100vh-180px)] items-center justify-center">
        <DataState state="info" tone="muted" title="Sem permissão para acessar ordens de serviço" />
      </div>
    );
  }

  if (!listPermission.canShow) {
    return (
      <div className="rounded-xl border border-white/10 bg-white/5 p-6 text-sm text-white/70">
        Sem acesso às ordens de serviço.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader
        actions={
          <>
            {listPermission.isFull && user?.role === "admin" && (
              <Link
                className="rounded-xl bg-white/10 px-4 py-2 text-sm text-white transition hover:bg-white/15"
                to="/services/import"
              >
                Importar XLSX
              </Link>
            )}
            {listPermission.isFull && (
              <Link
                className="rounded-xl bg-sky-500 px-4 py-2 text-sm font-medium text-black transition hover:bg-sky-400"
                to="/services/new"
              >
                Nova OS
              </Link>
            )}
          </>
        }
      />

      <FilterBar
        left={
          <div className="flex w-full flex-wrap items-center gap-3">
            <input
              value={q}
              onChange={(event) => setQ(event.target.value)}
              placeholder="Buscar por OS, placa, contato, técnico..."
              className="min-w-0 flex-1 rounded-xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-white placeholder:text-white/50 focus:border-white/30 focus:outline-none sm:min-w-[220px]"
            />
            <div className="min-w-0 flex-1 sm:min-w-[220px]">
              <AutocompleteSelect
                placeholder="Buscar cliente"
                value={clientId}
                options={clientAutocompleteOptions}
                onChange={(nextValue) => setClientId(String(nextValue ?? ""))}
                disabled={!hasAdminAccess}
              />
            </div>
            <select
              value={status}
              onChange={(event) => setStatus(event.target.value)}
              className="min-w-0 flex-1 rounded-xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-white focus:border-white/30 focus:outline-none sm:min-w-[200px]"
            >
              {STATUS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <input
              type="date"
              value={from}
              onChange={(event) => setFrom(event.target.value)}
              className="min-w-0 flex-1 rounded-xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-white focus:border-white/30 focus:outline-none sm:min-w-[160px]"
            />
            <input
              type="date"
              value={to}
              onChange={(event) => setTo(event.target.value)}
              className="min-w-0 flex-1 rounded-xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-white focus:border-white/30 focus:outline-none sm:min-w-[160px]"
            />
          </div>
        }
        right={
          <button
            type="button"
            onClick={() => fetchOrders({ force: true })}
            className="rounded-xl bg-white/10 px-3 py-2 text-sm text-white transition hover:bg-white/15"
          >
            <span className="inline-flex items-center gap-2">
              <RefreshCw className="h-4 w-4" />
              Atualizar
            </span>
          </button>
        }
      />

      <div className="flex gap-2 overflow-x-auto pb-1">
        {availableTypeChips.map((chip) => {
          const isActive = activeType === chip.key;
          return (
            <button
              key={chip.key}
              type="button"
              onClick={() => setActiveType(chip.key)}
              className={`whitespace-nowrap rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-wide transition ${
                isActive
                  ? "border-sky-400 bg-sky-400/20 text-sky-100"
                  : "border-white/10 bg-white/5 text-white/70 hover:border-white/30 hover:text-white"
              }`}
            >
              {chip.label} {counts[chip.key] ?? 0}
            </button>
          );
        })}
      </div>

      {!availableTypeChips.length ? (
        <div className="rounded-xl border border-white/10 bg-white/5 p-6 text-sm text-white/70">
          Sem acesso aos tipos de ordem de serviço.
        </div>
      ) : (
        <>
          <DataTable className="w-full" tableClassName="min-w-[1180px] w-full">
            <thead className="bg-white/5 text-xs uppercase tracking-wide text-white/70">
              <tr className="text-left">
                <th className="w-32 px-4 py-3">OS</th>
                <th className="w-24 px-4 py-3">Placa</th>
                <th className="e-hide-mobile w-48 px-4 py-3 sm:table-cell">Cliente</th>
                <th className="e-hide-mobile w-32 px-4 py-3 md:table-cell">Técnico</th>
                <th className="e-hide-mobile px-4 py-3 md:table-cell">Equipamentos</th>
                <th className="w-36 px-4 py-3">Data</th>
                <th className="e-hide-mobile w-28 px-4 py-3 md:table-cell">KM total</th>
                <th className="w-28 px-4 py-3">Status</th>
                <th className="w-20 px-4 py-3 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/10">
              {loading && (
                <tr>
                  <td colSpan={9} className="px-4 py-6">
                    <SkeletonTable rows={6} columns={9} />
                  </td>
                </tr>
              )}
              {!loading && error && (
                <tr>
                  <td colSpan={9} className="px-4 py-8">
                    <DataState
                      tone="error"
                      state="error"
                      title="Não foi possível carregar ordens de serviço"
                      description={error.message}
                    />
                  </td>
                </tr>
              )}
              {!loading && !error && actionError && (
                <tr>
                  <td colSpan={9} className="px-4 py-4">
                    <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                      {actionError}
                    </div>
                  </td>
                </tr>
              )}
              {!loading && !error && filtered.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-4 py-8">
                    <EmptyState
                      title="Nenhuma ordem de serviço encontrada com os filtros atuais."
                      subtitle="Crie uma nova OS para iniciar o fluxo."
                      action={
                        <Link
                          className="rounded-xl bg-sky-500 px-4 py-2 text-sm font-medium text-black transition hover:bg-sky-400"
                          to="/services/new"
                        >
                          Criar OS
                        </Link>
                      }
                    />
                  </td>
                </tr>
              )}
              {!loading &&
                paginatedItems.map((item) => (
                  <tr key={item.id} className="border-t border-white/10 hover:bg-white/5">
                    <td className="px-4 py-3 font-medium text-white">
                      {item.osInternalId || item.id.slice(0, 8)}
                    </td>
                    <td className="px-4 py-3 truncate">{item.vehicle?.plate || "—"}</td>
                    <td className="e-hide-mobile px-4 py-3 truncate text-white sm:table-cell">
                      {item.clientName || item.vehicle?.clientName || item.vehicle?.client?.name || "—"}
                    </td>
                    <td className="e-hide-mobile px-4 py-3 truncate md:table-cell">{item.technicianName || "—"}</td>
                    <td className="e-hide-mobile px-4 py-3 md:table-cell">
                      {(() => {
                        const labels = buildEquipmentLabels(item).filter(Boolean);
                        if (!labels.length) return "—";
                        return (
                          <div className="flex flex-wrap gap-1">
                            {labels.map((label, index) => (
                              <span
                                key={`${label}-${index}`}
                                className="max-w-[220px] truncate rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[11px] text-white/80"
                              >
                                {label}
                              </span>
                            ))}
                          </div>
                        );
                      })()}
                    </td>
                    <td className="px-4 py-3">{formatDate(item.startAt)}</td>
                    <td className="e-hide-mobile px-4 py-3 md:table-cell">{formatKmTotal(item.km)}</td>
                    <td className="px-4 py-3">
                      <span className="rounded-lg bg-white/10 px-2 py-1 text-xs text-white/80">
                        {formatStatusWithType(item.status, item.type)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      {item?.id ? (
                        <div className="inline-flex items-center justify-end gap-2">
                          {user?.role !== "technician" ? (
                            <Link
                              className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/10 text-white transition hover:border-white/30"
                              to={`/services/${item.id}`}
                              aria-label="Detalhes da OS"
                            >
                              <Eye className="h-4 w-4" />
                            </Link>
                          ) : null}
                          {listPermission.isFull ? (
                            <>
                              <Link
                                className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/10 text-white transition hover:border-white/30"
                                to={`/services/${item.id}`}
                                aria-label="Editar OS"
                              >
                                <Pencil className="h-4 w-4" />
                              </Link>
                              <button
                                type="button"
                                onClick={() => handleDelete(item)}
                                className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-red-500/40 text-red-300 transition hover:bg-red-500/10"
                                aria-label="Excluir OS"
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            </>
                          ) : null}
                        </div>
                      ) : (
                        <span className="text-xs text-white/50">—</span>
                      )}
                    </td>
                  </tr>
                ))}
            </tbody>
          </DataTable>
          <DataTablePagination
            pageSize={pageSize}
            pageSizeOptions={PAGE_SIZE_OPTIONS}
            onPageSizeChange={(value) => {
              const next = Number(value);
              setPageSize(Number.isFinite(next) && next > 0 ? next : DEFAULT_PAGE_SIZE);
              setCurrentPage(1);
            }}
            currentPage={safeCurrentPage}
            totalPages={totalPages}
            totalItems={totalFiltered}
            onPageChange={setCurrentPage}
            disabled={loading || Boolean(error) || totalFiltered === 0}
          />
        </>
      )}
      <PageToast toast={toast} />
    </div>
  );
}
