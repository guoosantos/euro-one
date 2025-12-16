import React, { useEffect, useMemo, useState } from "react";
import { Plus, RefreshCw, Trash2 } from "lucide-react";

import PageHeader from "../ui/PageHeader";
import Input from "../ui/Input";
import Select from "../ui/Select";
import Button from "../ui/Button";
import Modal from "../ui/Modal";
import Field from "../ui/Field";
import { Search } from "lucide-react";
import { CoreApi } from "../lib/coreApi.js";
import { useTenant } from "../lib/tenant-context.jsx";
import { useLivePositions } from "../lib/hooks/useLivePositions.js";
import { toDeviceKey } from "../lib/hooks/useDevices.helpers.js";

function formatStatus(status) {
  if (!status) return "—";
  return status.charAt(0).toUpperCase() + status.slice(1);
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

  const resolvedClientId = tenantId || user?.clientId || null;

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

  const availableDevices = useMemo(() => devices.filter((device) => !device.chipId || device.chipId === editingId), [devices, editingId]);

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
    <div className="space-y-5">
      <PageHeader
        title="Chips"
        description="Controle de chips vinculados aos equipamentos do tenant."
        right={
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

      <Field label="Filtros">
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
        </div>
      </Field>

      <div className="rounded-2xl border border-white/10 bg-white/5">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm text-white/80">
            <thead className="bg-white/5 text-xs uppercase tracking-wide text-white/60">
              <tr>
                <th className="px-4 py-3 text-left">ICCID</th>
                <th className="px-4 py-3 text-left">Telefone</th>
                <th className="px-4 py-3 text-left">Operadora</th>
                <th className="px-4 py-3 text-left">Status</th>
                <th className="px-4 py-3 text-left">Último ping</th>
                <th className="px-4 py-3 text-left">Equipamento</th>
                <th className="px-4 py-3 text-left">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/10">
              {loading && (
                <tr>
                  <td colSpan={7} className="px-4 py-6 text-center text-white/60">
                    Carregando chips…
                  </td>
                </tr>
              )}
              {!loading && filteredChips.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-6 text-center text-white/60">
                    Nenhum chip encontrado.
                  </td>
                </tr>
              )}
              {!loading &&
                filteredChips.map((chip) => (
                  <tr key={chip.id} className="hover:bg-white/5">
                    <td className="px-4 py-3 text-white">{chip.iccid}</td>
                    <td className="px-4 py-3">{chip.phone || "—"}</td>
                    <td className="px-4 py-3">{chip.carrier || "—"}</td>
                    <td className="px-4 py-3">{formatStatus(chip.status)}</td>
                    <td className="px-4 py-3">{getLastPing(chip)}</td>
                    <td className="px-4 py-3">{chip.device?.name || chip.device?.uniqueId || "—"}</td>
                    <td className="px-4 py-3 space-x-2 whitespace-nowrap">
                      <Button size="sm" variant="ghost" onClick={() => openEdit(chip)}>
                        Editar
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => handleDelete(chip.id)} icon={Trash2}>
                        Remover
                      </Button>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>

      <Modal open={open} onClose={() => setOpen(false)} title={editingId ? "Editar chip" : "Novo chip"} width="max-w-3xl">
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
            <Select value={form.deviceId} onChange={(event) => setForm((current) => ({ ...current, deviceId: event.target.value }))}>
              <option value="">Equipamento (opcional)</option>
              {availableDevices.map((device) => (
                <option key={device.internalId || device.id || device.uniqueId} value={device.internalId || device.id}>
                  {device.name || device.uniqueId || device.internalId}
                </option>
              ))}
            </Select>
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
      </Modal>
    </div>
  );
}
