import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EllipsisVertical, Plus, RefreshCw, Search, Trash2 } from "lucide-react";

import PageHeader from "../components/ui/PageHeader.jsx";
import Input from "../ui/Input";
import Select from "../ui/Select";
import Button from "../ui/Button";
import AutocompleteSelect from "../components/ui/AutocompleteSelect.jsx";
import DropdownMenu from "../ui/DropdownMenu";
import { CoreApi } from "../lib/coreApi.js";
import { useTenant } from "../lib/tenant-context.jsx";
import { useLivePositions } from "../lib/hooks/useLivePositions.js";
import { toDeviceKey } from "../lib/hooks/useDevices.helpers.js";
import { computeAutoVisibility, loadColumnVisibility, saveColumnVisibility } from "../lib/column-visibility.js";
import { useConfirmDialog } from "../components/ui/ConfirmDialogProvider.jsx";
import useAdminGeneralAccess from "../lib/hooks/useAdminGeneralAccess.js";
import usePageToast from "../lib/hooks/usePageToast.js";
import PageToast from "../components/ui/PageToast.jsx";

function formatStatus(status) {
  if (!status) return "—";
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function ChipRow({
  chip,
  lastPing,
  deviceLabel,
  showCarrier,
  showStatus,
  showLastPing,
  showDevice,
  onEdit,
  onDelete,
  canDelete,
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButtonRef = useRef(null);

  return (
    <tr className="hover:bg-white/5">
      <td className="px-4 py-3 text-white">{chip.iccid}</td>
      <td className="px-4 py-3">{chip.phone || "—"}</td>
      {showCarrier && <td className="px-4 py-3">{chip.carrier || "—"}</td>}
      {showStatus && <td className="px-4 py-3">{formatStatus(chip.status)}</td>}
      {showLastPing && <td className="px-4 py-3">{lastPing}</td>}
      {showDevice && <td className="px-4 py-3">{deviceLabel}</td>}
      <td className="px-4 py-3 text-right">
        <button
          type="button"
          ref={menuButtonRef}
          onClick={() => setMenuOpen((prev) => !prev)}
          className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/10 text-white hover:border-white/30"
          aria-label="Ações"
        >
          <EllipsisVertical className="h-4 w-4" />
        </button>
        <DropdownMenu open={menuOpen} anchorRef={menuButtonRef} onClose={() => setMenuOpen(false)}>
          <div className="flex flex-col py-2 text-sm text-white">
            <button
              type="button"
              className="flex w-full items-center gap-2 px-4 py-2 text-left hover:bg-white/5"
              onClick={() => {
                onEdit?.();
                setMenuOpen(false);
              }}
            >
              Editar chip
            </button>
            {canDelete && (
              <button
                type="button"
                className="flex w-full items-center gap-2 px-4 py-2 text-left text-red-200 hover:bg-red-500/10"
                onClick={() => {
                  onDelete?.();
                  setMenuOpen(false);
                }}
              >
                <Trash2 className="h-4 w-4" />
                Remover
              </button>
            )}
          </div>
        </DropdownMenu>
      </td>
    </tr>
  );
}

function Drawer({ open, onClose, title, description, children }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[9998] flex">
      <div className="flex-1 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative h-full w-full max-w-3xl border-l border-white/10 bg-[#0f141c] shadow-3xl">
        <div className="flex items-start justify-between gap-4 border-b border-white/10 px-6 py-5">
          <div>
            <p className="text-xs uppercase tracking-[0.12em] text-white/50">Chips</p>
            <h2 className="text-xl font-semibold text-white">{title}</h2>
            {description ? <p className="mt-1 text-sm text-white/60">{description}</p> : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-white/10 px-3 py-1 text-xs text-white/70 hover:border-white/30 hover:text-white"
          >
            Fechar
          </button>
        </div>
        <div className="h-[calc(100vh-120px)] overflow-y-auto px-6 py-6">{children}</div>
      </div>
    </div>
  );
}

export default function Chips() {
  const { tenantId, tenantScope, user, tenants, hasAdminAccess, homeClient } = useTenant();
  const { positions } = useLivePositions();
  const [chips, setChips] = useState([]);
  const [devices, setDevices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState(null);

  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("todos");
  const [carrierFilter, setCarrierFilter] = useState("todos");
  const [showColumnPicker, setShowColumnPicker] = useState(false);
  const { confirmDelete } = useConfirmDialog();
  const { isAdminGeneral } = useAdminGeneralAccess();
  const { toast, showToast } = usePageToast();

  const resolvedClientId = tenantScope === "ALL" ? null : (tenantId || user?.clientId || null);
  const clientSelectionRequired = !resolvedClientId && hasAdminAccess;
  const columnStorageKey = useMemo(
    () => `chips.columns:${user?.id || "anon"}:${resolvedClientId || "all"}`,
    [resolvedClientId, user?.id],
  );
  const columnDefaults = useMemo(
    () => ({
      carrier: true,
      status: true,
      lastPing: true,
      device: true,
    }),
    [],
  );
  const [visibleColumns, setVisibleColumns] = useState(
    () => loadColumnVisibility(columnStorageKey) ?? columnDefaults,
  );
  const columnAutoApplied = useRef(false);

  const [form, setForm] = useState({
    iccid: "",
    phone: "",
    carrier: "",
    status: "Disponível",
    provider: "",
    apn: "",
    apnUser: "",
    apnPass: "",
    notes: "",
    deviceId: "",
    clientId: resolvedClientId || "",
  });
  const [formErrors, setFormErrors] = useState({});

  const clientOptions = useMemo(() => {
    const base = Array.isArray(tenants) ? tenants : [];
    const merged = homeClient?.id ? [...base, homeClient] : base;
    const seen = new Set();
    return merged
      .filter((tenant) => tenant?.id != null)
      .map((tenant) => ({
        id: String(tenant.id),
        name: tenant.name || tenant.company || tenant.id,
      }))
      .filter((tenant) => {
        if (seen.has(tenant.id)) return false;
        seen.add(tenant.id);
        return true;
      });
  }, [homeClient, tenants]);

  const clientAutocompleteOptions = useMemo(
    () =>
      clientOptions.map((client) => ({
        value: String(client.id),
        label: client.name,
      })),
    [clientOptions],
  );

  const latestPositionByDevice = useMemo(() => {
    const map = new Map();
    (Array.isArray(positions) ? positions : []).forEach((position) => {
      const key = toDeviceKey(position?.deviceId ?? position?.device_id);
      if (!key) return;
      const time = Date.parse(position.fixTime ?? position.deviceTime ?? position.serverTime ?? position.time ?? 0);
      const existing = map.get(key);
      if (!existing || (!Number.isNaN(time) && time > existing.time)) {
        map.set(key, { ...position, parsedTime: time });
      }
    });
    return map;
  }, [positions]);

  const columnDefs = useMemo(
    () => [
      {
        key: "carrier",
        label: "Operadora",
        defaultVisible: true,
        isMissing: (chip) => !chip?.carrier,
      },
      {
        key: "status",
        label: "Status",
        defaultVisible: true,
        isMissing: (chip) => !chip?.status,
      },
      {
        key: "lastPing",
        label: "Último ping",
        defaultVisible: true,
        isMissing: (chip) => {
          const key = toDeviceKey(chip.deviceId || chip.device?.id || chip.device?.traccarId || chip.device?.uniqueId);
          return !key || !latestPositionByDevice.get(key);
        },
      },
      {
        key: "device",
        label: "Equipamento",
        defaultVisible: true,
        isMissing: (chip) => !(chip?.device?.name || chip?.device?.uniqueId),
      },
    ],
    [latestPositionByDevice],
  );

  useEffect(() => {
    columnAutoApplied.current = false;
    const stored = loadColumnVisibility(columnStorageKey);
    setVisibleColumns(stored ?? columnDefaults);
  }, [columnDefaults, columnStorageKey]);

  useEffect(() => {
    if (columnAutoApplied.current) return;
    if (!chips.length) return;
    const stored = loadColumnVisibility(columnStorageKey);
    if (stored) {
      columnAutoApplied.current = true;
      return;
    }
    const autoVisibility = computeAutoVisibility(chips, columnDefs, 0.9);
    setVisibleColumns((current) => ({ ...current, ...autoVisibility }));
    columnAutoApplied.current = true;
  }, [chips, columnDefs, columnStorageKey]);

  useEffect(() => {
    saveColumnVisibility(columnStorageKey, visibleColumns);
  }, [columnStorageKey, visibleColumns]);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const clientParams = resolvedClientId ? { clientId: resolvedClientId } : undefined;
      const [chipList, deviceList] = await Promise.all([
        CoreApi.listChips(clientParams),
        CoreApi.listDevices(clientParams),
      ]);
      setChips(Array.isArray(chipList) ? chipList : []);
      setDevices(Array.isArray(deviceList) ? deviceList : []);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError : new Error("Falha ao carregar chips"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (resolvedClientId || user) {
      load();
    }
  }, [resolvedClientId, user]);

  useEffect(() => {
    setQuery("");
    setStatusFilter("todos");
    setCarrierFilter("todos");
  }, [resolvedClientId]);

  const statusOptions = useMemo(() => {
    const set = new Set();
    chips.forEach((chip) => {
      if (chip?.status) set.add(chip.status);
    });
    return Array.from(set);
  }, [chips]);

  const carrierOptions = useMemo(() => {
    const set = new Set();
    chips.forEach((chip) => {
      if (chip?.carrier) set.add(chip.carrier);
    });
    return Array.from(set);
  }, [chips]);

  const loadDeviceOptions = useCallback(
    async ({ query, page, pageSize }) => {
      const targetClientId = resolvedClientId || form.clientId || undefined;
      const response = await CoreApi.searchDevices({
        clientId: targetClientId,
        query,
        page,
        pageSize,
      });
      const list = response?.devices || response?.data || [];
      const options = list
        .filter((device) => !device.chipId || device.chipId === editingId)
        .map((device) => ({
          value: device.id,
          label: device.name || device.uniqueId || device.id,
          description: device.modelName || device.model || "",
          data: device,
        }));
      return { options, hasMore: Boolean(response?.hasMore) };
    },
    [editingId, form.clientId, resolvedClientId],
  );

  const filteredChips = useMemo(() => {
    return chips.filter((chip) => {
      if (query.trim()) {
        const term = query.trim().toLowerCase();
        const matches = [chip.iccid, chip.phone, chip.device?.uniqueId, chip.device?.name]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(term));
        if (!matches) return false;
      }
      if (statusFilter !== "todos" && chip.status !== statusFilter) {
        return false;
      }
      if (carrierFilter !== "todos" && chip.carrier !== carrierFilter) {
        return false;
      }
      return true;
    });
  }, [chips, query, statusFilter, carrierFilter]);

  const availableDevices = useMemo(
    () => {
      const targetClientId = resolvedClientId || form.clientId || null;
      return devices.filter((device) => {
        if (targetClientId && device?.clientId && String(device.clientId) !== String(targetClientId)) {
          return false;
        }
        return !device.chipId || device.chipId === editingId;
      });
    },
    [devices, editingId, form.clientId, resolvedClientId],
  );
  const deviceById = useMemo(() => {
    const map = new Map();
    devices.forEach((device) => {
      const key = toDeviceKey(device?.id ?? device?.traccarId ?? device?.uniqueId ?? device?.deviceId);
      if (key) map.set(String(key), device);
    });
    return map;
  }, [devices]);

  const resolveDeviceLabel = useCallback(
    (chip) => {
      const direct = chip?.device?.name || chip?.device?.uniqueId;
      if (direct) return direct;
      const key = toDeviceKey(chip?.deviceId ?? chip?.device?.id ?? chip?.device?.traccarId ?? chip?.device?.uniqueId);
      const match = key ? deviceById.get(String(key)) : null;
      return match?.name || match?.uniqueId || "—";
    },
    [deviceById],
  );

  const tableColCount =
    3 +
    (visibleColumns.carrier ? 1 : 0) +
    (visibleColumns.status ? 1 : 0) +
    (visibleColumns.lastPing ? 1 : 0) +
    (visibleColumns.device ? 1 : 0);

  function getLastPing(chip) {
    const key = toDeviceKey(chip.deviceId || chip.device?.id || chip.device?.traccarId || chip.device?.uniqueId);
    const position = key ? latestPositionByDevice.get(key) : null;
    if (!position?.parsedTime) return "—";
    return new Date(position.parsedTime).toLocaleString();
  }

  function resetForm() {
    setEditingId(null);
    setForm({
      iccid: "",
      phone: "",
      carrier: "",
      status: "Disponível",
      provider: "",
      apn: "",
      apnUser: "",
      apnPass: "",
      notes: "",
      deviceId: "",
      clientId: resolvedClientId || "",
    });
    setFormErrors({});
  }

  function toggleColumn(key) {
    setVisibleColumns((current) => ({ ...current, [key]: !current[key] }));
  }

  async function handleSave(event) {
    event.preventDefault();
    const validationErrors = {};
    if (!form.iccid.trim()) validationErrors.iccid = "Informe o ICCID.";
    if (!form.phone.trim()) validationErrors.phone = "Informe o telefone.";
    if (clientSelectionRequired && !form.clientId) {
      validationErrors.clientId = "Selecione um cliente.";
    }
    const targetClientId = resolvedClientId || form.clientId || "";
    if (!clientSelectionRequired && !targetClientId) {
      showToast("Não foi possível identificar o cliente atual. Refaça login ou selecione um cliente.", "error");
      return;
    }
    if (Object.keys(validationErrors).length > 0) {
      setFormErrors(validationErrors);
      return;
    }
    setFormErrors({});
    setSaving(true);
    try {
      const payload = {
        iccid: form.iccid.trim(),
        phone: form.phone.trim(),
        carrier: form.carrier.trim() || undefined,
        status: form.status || undefined,
        provider: form.provider.trim() || undefined,
        apn: form.apn.trim() || undefined,
        apnUser: form.apnUser.trim() || undefined,
        apnPass: form.apnPass.trim() || undefined,
        notes: form.notes.trim() || undefined,
        deviceId: form.deviceId || undefined,
        clientId: targetClientId || undefined,
      };
      if (editingId) {
        await CoreApi.updateChip(editingId, payload);
      } else {
        await CoreApi.createChip(payload);
      }
      setOpen(false);
      resetForm();
      await load();
      showToast(editingId ? "Chip atualizado com sucesso." : "Chip cadastrado com sucesso.");
    } catch (requestError) {
      const requestMessage = requestError?.message || "Falha ao salvar chip";
      setError(requestError instanceof Error ? requestError : new Error("Falha ao salvar chip"));
      if (/clientid/i.test(String(requestMessage))) {
        setFormErrors((current) => ({ ...current, clientId: "Selecione um cliente." }));
        showToast("Selecione um cliente para salvar o chip.", "error");
      } else {
        showToast(requestMessage, "error");
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(chip) {
    const chipId = chip?.id;
    if (!chipId) return;
    if (!isAdminGeneral) return;
    const targetClientId = resolvedClientId || chip?.clientId || null;
    if (!targetClientId) {
      showToast("Selecione um cliente para remover o chip.", "error");
      return;
    }
    await confirmDelete({
      title: "Excluir chip",
      message: "Tem certeza que deseja excluir o chip? Essa ação não pode ser desfeita.",
      confirmLabel: "Excluir",
      onConfirm: async () => {
        try {
          await CoreApi.deleteChip(chipId, { clientId: targetClientId });
          await load();
          showToast("Excluído com sucesso.");
        } catch (requestError) {
          showToast("Falha ao excluir.", "error");
          throw requestError;
        }
      },
    });
  }

  function openEdit(chip) {
    setEditingId(chip.id);
    setForm({
      iccid: chip.iccid || "",
      phone: chip.phone || "",
      carrier: chip.carrier || "",
      status: chip.status || "",
      provider: chip.provider || "",
      apn: chip.apn || "",
      apnUser: chip.apnUser || "",
      apnPass: chip.apnPass || "",
      notes: chip.notes || "",
      deviceId: chip.deviceId || "",
      clientId: chip.clientId || resolvedClientId || "",
    });
    setFormErrors({});
    setOpen(true);
  }

  return (
    <div className="flex min-h-[calc(100vh-180px)] flex-col gap-5">
      <PageHeader
        actions={
          <div className="flex gap-2">
            <Button variant="ghost" onClick={load} icon={RefreshCw}>
              Atualizar
            </Button>
            <Button
              onClick={() => {
                resetForm();
                setOpen(true);
              }}
              icon={Plus}
            >
              Novo chip
            </Button>
          </div>
        }
      />

      {error && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">{error.message}</div>
      )}

      <div className="space-y-2">
        <span className="block text-xs uppercase tracking-wide text-white/60">Filtros</span>
        <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
          <Input
            placeholder="Buscar ICCID/Telefone"
            icon={Search}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <Select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
            <option value="todos">Status: Todos</option>
            {statusOptions.map((status) => (
              <option key={status} value={status}>
                {formatStatus(status)}
              </option>
            ))}
          </Select>
          <Select value={carrierFilter} onChange={(event) => setCarrierFilter(event.target.value)}>
            <option value="todos">Operadora: Todas</option>
            {carrierOptions.map((carrier) => (
              <option key={carrier} value={carrier}>
                {carrier}
              </option>
            ))}
          </Select>
          <Button onClick={load} className="md:col-span-1">
            Atualizar
          </Button>
          <Button
            variant="ghost"
            className="md:col-span-1"
            onClick={() => setShowColumnPicker((prev) => !prev)}
          >
            Exibir colunas
          </Button>
        </div>
      </div>

      {showColumnPicker && (
        <div className="flex flex-wrap gap-4 rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-xs text-white/80">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={visibleColumns.carrier}
              onChange={() => toggleColumn("carrier")}
              className="h-4 w-4 rounded border-white/30 bg-transparent"
            />
            Operadora
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={visibleColumns.status}
              onChange={() => toggleColumn("status")}
              className="h-4 w-4 rounded border-white/30 bg-transparent"
            />
            Status
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={visibleColumns.lastPing}
              onChange={() => toggleColumn("lastPing")}
              className="h-4 w-4 rounded border-white/30 bg-transparent"
            />
            Último ping
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={visibleColumns.device}
              onChange={() => toggleColumn("device")}
              className="h-4 w-4 rounded border-white/30 bg-transparent"
            />
            Equipamento
          </label>
        </div>
      )}

      <div className="flex-1">
        <div className="overflow-x-auto border border-white/10">
          <table className="min-w-full text-sm text-white/80">
            <thead className="bg-white/5 text-xs uppercase tracking-wide text-white/60">
              <tr>
                <th className="px-4 py-3 text-left">ICCID</th>
                <th className="px-4 py-3 text-left">Telefone</th>
                {visibleColumns.carrier && <th className="px-4 py-3 text-left">Operadora</th>}
                {visibleColumns.status && <th className="px-4 py-3 text-left">Status</th>}
                {visibleColumns.lastPing && <th className="px-4 py-3 text-left">Último ping</th>}
                {visibleColumns.device && <th className="px-4 py-3 text-left">Equipamento</th>}
                <th className="px-4 py-3 text-left">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/10">
              {loading && (
                <tr>
                  <td colSpan={tableColCount} className="px-4 py-6 text-center text-white/60">
                    Carregando chips…
                  </td>
                </tr>
              )}
              {!loading && filteredChips.length === 0 && (
                <tr>
                  <td colSpan={tableColCount} className="px-4 py-6 text-center text-white/60">
                    Nenhum chip encontrado.
                  </td>
                </tr>
              )}
              {!loading &&
                filteredChips.map((chip) => (
                  <ChipRow
                    key={chip.id}
                    chip={chip}
                    lastPing={getLastPing(chip)}
                    deviceLabel={resolveDeviceLabel(chip)}
                    showCarrier={visibleColumns.carrier}
                    showStatus={visibleColumns.status}
                    showLastPing={visibleColumns.lastPing}
                    showDevice={visibleColumns.device}
                    onEdit={() => openEdit(chip)}
                    onDelete={() => handleDelete(chip)}
                    canDelete={isAdminGeneral}
                  />
                ))}
            </tbody>
          </table>
        </div>
      </div>

      <Drawer
        open={open}
        onClose={() => setOpen(false)}
        title={editingId ? "Editar chip" : "Novo chip"}
        description="Cadastre dados do chip e vincule um equipamento."
      >
        <form onSubmit={handleSave} className="space-y-4">
          {clientSelectionRequired && (
            <div className="space-y-2">
              <div className="text-xs uppercase tracking-[0.12em] text-white/50">Cliente</div>
              <AutocompleteSelect
                label="Cliente"
                placeholder="Selecione o cliente"
                value={form.clientId}
                options={clientAutocompleteOptions}
                onChange={(nextClientId) => {
                  setForm((current) => ({ ...current, clientId: nextClientId || "", deviceId: "" }));
                  setFormErrors((current) => ({ ...current, clientId: undefined }));
                }}
                allowClear
                inputClassName={formErrors.clientId ? "border-red-500/70 focus:border-red-400/80" : ""}
              />
              {formErrors.clientId ? <p className="text-xs text-red-300">{formErrors.clientId}</p> : null}
            </div>
          )}
          <div className="text-xs uppercase tracking-[0.12em] text-white/50">Dados do chip</div>
          <div className="grid gap-3 md:grid-cols-2">
            <Input
              label="ICCID"
              placeholder="ICCID *"
              value={form.iccid}
              className={formErrors.iccid ? "border-red-500/70 focus:border-red-400/80" : ""}
              onChange={(event) => {
                setForm((current) => ({ ...current, iccid: event.target.value }));
                setFormErrors((current) => ({ ...current, iccid: undefined }));
              }}
            />
            <Input
              label="Telefone"
              placeholder="Telefone *"
              value={form.phone}
              className={formErrors.phone ? "border-red-500/70 focus:border-red-400/80" : ""}
              onChange={(event) => {
                setForm((current) => ({ ...current, phone: event.target.value }));
                setFormErrors((current) => ({ ...current, phone: undefined }));
              }}
            />
            {formErrors.iccid ? <p className="text-xs text-red-300">{formErrors.iccid}</p> : null}
            {formErrors.phone ? <p className="text-xs text-red-300">{formErrors.phone}</p> : null}
            <Input
              label="Operadora"
              placeholder="Operadora"
              value={form.carrier}
              onChange={(event) => setForm((current) => ({ ...current, carrier: event.target.value }))}
            />
            <Input
              label="Fornecedor"
              placeholder="Fornecedor"
              value={form.provider}
              onChange={(event) => setForm((current) => ({ ...current, provider: event.target.value }))}
            />
            <Select
              label="Status"
              value={form.status}
              onChange={(event) => setForm((current) => ({ ...current, status: event.target.value }))}
            >
              <option value="Disponível">Disponível</option>
              <option value="Vinculado">Vinculado</option>
              <option value="Ativo">Ativo</option>
              <option value="Inativo">Inativo</option>
            </Select>
          </div>
          <div className="text-xs uppercase tracking-[0.12em] text-white/50">Vínculo com equipamento</div>
          <div className="grid gap-3 md:grid-cols-2">
            <AutocompleteSelect
              label="Equipamento"
              placeholder="Buscar equipamento"
              value={form.deviceId}
              onChange={(nextValue) => setForm((current) => ({ ...current, deviceId: nextValue }))}
              loadOptions={loadDeviceOptions}
              options={availableDevices.map((device) => ({
                value: device.id,
                label: device.name || device.uniqueId || device.internalId || device.id,
                description: device.modelName || device.model || "",
              }))}
              allowClear
            />
          </div>
          <div className="text-xs uppercase tracking-[0.12em] text-white/50">Configuração de rede</div>
          <div className="grid gap-3 md:grid-cols-2">
            <Input
              label="APN"
              placeholder="APN"
              value={form.apn}
              onChange={(event) => setForm((current) => ({ ...current, apn: event.target.value }))}
            />
            <Input
              label="APN Usuário"
              placeholder="APN Usuário"
              value={form.apnUser}
              onChange={(event) => setForm((current) => ({ ...current, apnUser: event.target.value }))}
            />
            <Input
              label="APN Senha"
              placeholder="APN Senha"
              value={form.apnPass}
              onChange={(event) => setForm((current) => ({ ...current, apnPass: event.target.value }))}
            />
          </div>
          <div className="text-xs uppercase tracking-[0.12em] text-white/50">Observações</div>
          <div className="grid gap-3 md:grid-cols-2">
            <label className="text-xs uppercase tracking-[0.12em] text-white/60 md:col-span-2" htmlFor="chip-notes">
              Observações
            </label>
            <textarea
              id="chip-notes"
              placeholder="Observações"
              value={form.notes}
              onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))}
              className="w-full rounded-xl border border-stroke bg-card/60 px-3 py-2 md:col-span-2"
              rows={3}
            />
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <Button type="button" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Salvando…" : editingId ? "Atualizar" : "Salvar"}
            </Button>
          </div>
        </form>
      </Drawer>
      <PageToast toast={toast} />
    </div>
  );
}
