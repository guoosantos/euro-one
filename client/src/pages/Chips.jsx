import React, { useEffect, useMemo, useState } from "react";

import PageHeader from "../ui/PageHeader";
import Input from "../ui/Input";
import Select from "../ui/Select";
import Button from "../ui/Button";
import Modal from "../ui/Modal";
import Field from "../ui/Field";
import { Search } from "lucide-react";
import { CoreApi } from "../lib/coreApi.js";
import { useTenant } from "../lib/tenant-context.jsx";

function formatStatus(status) {
  if (!status) return "—";
  return status.charAt(0).toUpperCase() + status.slice(1);
}

export default function Chips() {
  const { tenantId, user } = useTenant();
  const [chips, setChips] = useState([]);
  const [devices, setDevices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("todos");
  const [carrierFilter, setCarrierFilter] = useState("todos");

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

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [chipList, deviceList] = await Promise.all([CoreApi.listChips(), CoreApi.listDevices()]);
      setChips(Array.isArray(chipList) ? chipList : []);
      setDevices(Array.isArray(deviceList) ? deviceList : []);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError : new Error("Falha ao carregar chips"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

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

  const availableDevices = useMemo(() => devices.filter((device) => !device.chipId), [devices]);

  async function handleSave(event) {
    event.preventDefault();
    if (!form.iccid.trim() || !form.phone.trim()) {
      alert("Preencha ICCID e telefone");
      return;
    }
    setSaving(true);
    try {
      await CoreApi.createChip({
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
      });
      setOpen(false);
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
      await load();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError : new Error("Falha ao cadastrar chip"));
      alert(requestError?.message || "Falha ao cadastrar chip");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Chips"
        right={<Button onClick={() => setOpen(true)}>+ Novo chip</Button>}
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
                <th className="px-4 py-3 text-left">Equipamento</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/10">
              {loading && (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-white/60">
                    Carregando chips…
                  </td>
                </tr>
              )}
              {!loading && filteredChips.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-white/60">
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
                    <td className="px-4 py-3">{chip.device?.name || chip.device?.uniqueId || "—"}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>

      <Modal open={open} onClose={() => setOpen(false)} title="Novo chip" width="max-w-3xl">
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
              {saving ? "Salvando…" : "Salvar"}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
