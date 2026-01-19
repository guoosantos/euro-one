import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Pencil, RefreshCw } from "lucide-react";

import PageHeader from "../../components/ui/PageHeader.jsx";
import FilterBar from "../../components/ui/FilterBar.jsx";
import DataTable from "../../components/ui/DataTable.jsx";
import EmptyState from "../../components/ui/EmptyState.jsx";
import SkeletonTable from "../../components/ui/SkeletonTable.jsx";
import AutocompleteSelect from "../../components/ui/AutocompleteSelect.jsx";
import DataState from "../../ui/DataState.jsx";
import api from "../../lib/api.js";
import { useTenant } from "../../lib/tenant-context.jsx";
import { usePermissionGate, usePermissions } from "../../lib/permissions/permission-gate.js";

const STATUS_OPTIONS = [
  { value: "", label: "Todos" },
  { value: "SOLICITADA", label: "Solicitada" },
  { value: "AGENDADA", label: "Agendada" },
  { value: "EM_DESLOCAMENTO", label: "Em deslocamento" },
  { value: "EM_EXECUCAO", label: "Em execução" },
  { value: "AGUARDANDO_APROVACAO", label: "Aguardando aprovação" },
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

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(date);
}

function normalizeType(value) {
  if (!value) return "";
  return String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();
}

function resolveOrderDate(item) {
  return item?.startAt || item?.createdAt || item?.updatedAt || null;
}

function buildEquipmentLabels(item) {
  const list = Array.isArray(item?.equipmentsData) ? item.equipmentsData : null;
  if (list && list.length) {
    return list.map((equipment) => {
      const id = equipment?.equipmentId || equipment?.id || "";
      const model = equipment?.model || equipment?.name || "";
      if (model && id) return `${model} • ${id}`;
      return model || id;
    });
  }
  if (item?.equipmentsText) {
    return [String(item.equipmentsText)];
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
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [clientId, setClientId] = useState(() => {
    if (user?.role === "admin") return "";
    return user?.clientId ? String(user.clientId) : "";
  });
  const [activeType, setActiveType] = useState("ALL");
  const retryCooldownRef = useRef(0);

  useEffect(() => {
    if (!user) return;
    if (user.role !== "admin") {
      setClientId(user.clientId ? String(user.clientId) : "");
      return;
    }
  }, [user]);

  const fetchOrders = async ({ force = false } = {}) => {
    const now = Date.now();
    if (!force && retryCooldownRef.current > now) {
      return;
    }
    setLoading(true);
    setError(null);
    const params = new URLSearchParams();
    try {
      if (status) params.set("status", status);
      if (q) params.set("q", q);
      if (from) params.set("from", new Date(from).toISOString());
      if (to) params.set("to", new Date(to).toISOString());
      if (clientId) params.set("clientId", clientId);

      const response = await api.get("core/service-orders", { params });
      setItems(response?.data?.items || []);
      retryCooldownRef.current = 0;
    } catch (error) {
      const statusCode = error?.response?.status ?? error?.status;
      console.error("Falha ao buscar ordens de serviço", {
        params: Object.fromEntries(params.entries()),
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

  useEffect(() => {
    if (!listPermission.canShow) return;
    fetchOrders();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, clientId, listPermission.canShow]);

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
      if (!term) return true;
      const values = [
        item.osInternalId,
        item.vehicle?.plate,
        item.vehicle?.name,
        item.responsibleName,
        item.responsiblePhone,
        item.technicianName,
        item.reason,
      ];
      return values.some((value) => String(value || "").toLowerCase().includes(term));
    });
  }, [items, q, from, to]);

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

  const filtered = useMemo(() => {
    if (activeType === "ALL") return baseFiltered;
    return baseFiltered.filter((item) => normalizeType(item.type) === activeType);
  }, [activeType, baseFiltered]);

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
        title="Ordem de Serviço"
        subtitle="Solicitações, execução e aprovação das OS."
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
              className="min-w-[220px] flex-1 rounded-xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-white placeholder:text-white/50 focus:border-white/30 focus:outline-none"
            />
            <div className="min-w-[220px] flex-1">
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
              className="min-w-[200px] flex-1 rounded-xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
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
              className="min-w-[160px] flex-1 rounded-xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
            />
            <input
              type="date"
              value={to}
              onChange={(event) => setTo(event.target.value)}
              className="min-w-[160px] flex-1 rounded-xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
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
        <DataTable className="w-full" tableClassName="min-w-[1100px] w-full">
          <thead className="bg-white/5 text-xs uppercase tracking-wide text-white/70">
            <tr className="text-left">
              <th className="w-32 px-4 py-3">OS</th>
              <th className="w-24 px-4 py-3">Placa</th>
              <th className="w-48 px-4 py-3">Responsável</th>
              <th className="w-32 px-4 py-3">Técnico</th>
              <th className="px-4 py-3">Equipamentos</th>
              <th className="w-36 px-4 py-3">Data</th>
              <th className="w-28 px-4 py-3">Status</th>
              <th className="w-20 px-4 py-3 text-right">Ações</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/10">
            {loading && (
              <tr>
                <td colSpan={8} className="px-4 py-6">
                  <SkeletonTable rows={6} columns={8} />
                </td>
              </tr>
            )}
            {!loading && error && (
              <tr>
                <td colSpan={8} className="px-4 py-8">
                  <DataState
                    tone="error"
                    state="error"
                    title="Não foi possível carregar ordens de serviço"
                    description={error.message}
                  />
                </td>
              </tr>
            )}
            {!loading && !error && filtered.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-8">
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
              filtered.map((item) => (
                <tr key={item.id} className="border-t border-white/10 hover:bg-white/5">
                  <td className="px-4 py-3 font-medium text-white">
                    {item.osInternalId || item.id.slice(0, 8)}
                  </td>
                  <td className="px-4 py-3 truncate">{item.vehicle?.plate || "—"}</td>
                  <td className="px-4 py-3">
                    <div className="truncate text-white">{item.responsibleName || "—"}</div>
                    <div className="truncate text-xs text-white/50">{item.responsiblePhone || ""}</div>
                  </td>
                  <td className="px-4 py-3 truncate">{item.technicianName || "—"}</td>
                  <td className="px-4 py-3">
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
                  <td className="px-4 py-3">
                    <span className="rounded-lg bg-white/10 px-2 py-1 text-xs text-white/80">
                      {item.status || "—"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    {listPermission.isFull ? (
                      <Link
                        className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/10 text-white transition hover:border-white/30"
                        to={`/services/${item.id}`}
                        aria-label="Editar OS"
                      >
                        <Pencil className="h-4 w-4" />
                      </Link>
                    ) : (
                      <span className="text-xs text-white/50">—</span>
                    )}
                  </td>
                </tr>
              ))}
          </tbody>
        </DataTable>
      )}
    </div>
  );
}
