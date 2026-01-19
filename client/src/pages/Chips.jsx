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

function formatStatus(status) {
  if (!status) return "—";
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function ChipRow({ chip, lastPing, deviceLabel, showCarrier, showStatus, showLastPing, showDevice, onEdit, onDelete }) {
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
  const { tenantId, user } = useTenant();
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

  const resolvedClientId = tenantId || user?.clientId || null;
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
  });

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
      const response = await CoreApi.searchDevices({
        clientId: resolvedClientId || undefined,
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
    [editingId, resolvedClientId],
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
    () => devices.filter((device) => !device.chipId || device.chipId === editingId),
    [devices, editingId],
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
    });
  }

  function toggleColumn(key) {
    setVisibleColumns((current) => ({ ...current, [key]: !current[key] }));
  }

  async function handleSave(event) {
    event.preventDefault();
    if (!form.iccid.trim() || !form.phone.trim()) {
      alert("Preencha ICCID e telefone");
      return;
    }
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
        clientId: tenantId || user?.clientId,
      };
      if (editingId) {
        await CoreApi.updateChip(editingId, payload);
      } else {
        await CoreApi.createChip(payload);
      }
      setOpen(false);
      resetForm();
      await load();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError : new Error("Falha ao salvar chip"));
      alert(requestError?.message || "Falha ao salvar chip");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id) {
    if (!id) return;
    if (!window.confirm("Remover este chip?")) return;
    try {
      await CoreApi.deleteChip(id, { clientId: tenantId || user?.clientId });
      await load();
    } catch (requestError) {
      alert(requestError?.message || "Não foi possível remover o chip");
    }
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
    });
    setOpen(true);
  }

  return (
    <div className="flex min-h-[calc(100vh-180px)] flex-col gap-5">
      <PageHeader
        overline="Central de chips"
        title="Chips"
        subtitle="Gerencie chips ativos, vínculos e informações de conectividade."
        actions={
          <div className="flex gap-2">
            <Button variant="ghost" onClick={load} icon={RefreshCw}>
              Atualizar
            </Button>
            <Button onClick={() => setOpen(true)} icon={Plus}>
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
                    onDelete={() => handleDelete(chip.id)}
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
          <div className="grid gap-3 md:grid-cols-2">
            <Input
              placeholder="ICCID *"
              value={form.iccid}
              onChange={(event) => setForm((current) => ({ ...current, iccid: event.target.value }))}
            />
            <Input
              placeholder="Telefone *"
              value={form.phone}
              onChange={(event) => setForm((current) => ({ ...current, phone: event.target.value }))}
            />
            <Input
              placeholder="Operadora"
              value={form.carrier}
              onChange={(event) => setForm((current) => ({ ...current, carrier: event.target.value }))}
            />
            <Input
              placeholder="Fornecedor"
              value={form.provider}
              onChange={(event) => setForm((current) => ({ ...current, provider: event.target.value }))}
            />
            <Select value={form.status} onChange={(event) => setForm((current) => ({ ...current, status: event.target.value }))}>
              <option value="Disponível">Disponível</option>
              <option value="Vinculado">Vinculado</option>
              <option value="Ativo">Ativo</option>
              <option value="Inativo">Inativo</option>
            </Select>
            <AutocompleteSelect
              label="Equipamento"
              placeholder="Buscar equipamento"
              value={form.deviceId}
              onChange={(nextValue) => setForm((current) => ({ ...current, deviceId: nextValue }))}
              loadOptions={loadDeviceOptions}
              options={availableDevices.map((device) => ({
                value: device.internalId || device.id,
                label: device.name || device.uniqueId || device.internalId,
                description: device.modelName || device.model || "",
              }))}
              allowClear
            />
            <Input
              placeholder="APN"
              value={form.apn}
              onChange={(event) => setForm((current) => ({ ...current, apn: event.target.value }))}
            />
            <Input
              placeholder="APN Usuário"
              value={form.apnUser}
              onChange={(event) => setForm((current) => ({ ...current, apnUser: event.target.value }))}
            />
            <Input
              placeholder="APN Senha"
              value={form.apnPass}
              onChange={(event) => setForm((current) => ({ ...current, apnPass: event.target.value }))}
            />
            <textarea
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
    </div>
  );
}
