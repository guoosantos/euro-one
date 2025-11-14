import React, { useMemo, useState } from "react";

import PageHeader from "../ui/PageHeader";
import Input from "../ui/Input";
import Select from "../ui/Select";
import Button from "../ui/Button";
import Modal from "../ui/Modal";
import Field from "../ui/Field";
import { Table, Pager } from "../ui/Table";
import { Search } from "lucide-react";
import { useTenant } from "../lib/tenant-context";
import { chips, devices } from "../mock/fleet";

export default function Chips() {
  const { tenantId } = useTenant();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    iccid: "",
    telefone: "",
    status: "Ativo",
    operadora: "",
    fornecedor: "",
    apn: "",
    apnUser: "",
    apnPass: "",
    obs: "",
  });

  const rows = useMemo(
    () =>
      chips
        .filter((chip) => chip.tenantId === tenantId)
        .map((chip) => {
          const device = devices.find((item) => item.id === chip.deviceId);
          return [chip.iccid, chip.phone, chip.carrier, chip.status, device?.imei ?? "—", "Gerenciar"];
        }),
    [tenantId],
  );

  const onChange = (key) => (event) => setForm((state) => ({ ...state, [key]: event.target.value }));
  const handleSave = () => {
    console.log("Salvar chip", form);
    setOpen(false);
  };

  return (
    <div className="space-y-5">
      <PageHeader title="Chips" right={<Button onClick={() => setOpen(true)}>+ Novo chip</Button>} />

      <Field label="Filtros">
        <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
          <Input placeholder="Buscar ICCID/Telefone" icon={Search} />
          <Select>
            <option>Status: Todos</option>
            <option>Disponível</option>
            <option>Vinculado</option>
          </Select>
          <Select>
            <option>Operadora: Todas</option>
            <option>Vivo</option>
            <option>Claro</option>
            <option>Tim</option>
            <option>Oi</option>
          </Select>
        </div>
      </Field>

      <div className="mt-3">
        <Field label="Resultados">
          <Table head={["ICCID", "Telefone", "Operadora", "Status", "Equipamento", "Ações"]} rows={rows} />
          <Pager />
        </Field>
      </div>

      <Modal open={open} onClose={() => setOpen(false)} title="Novo chip" width="max-w-3xl">
        <div className="grid gap-3 md:grid-cols-2">
          <Input placeholder="ICCID *" value={form.iccid} onChange={onChange("iccid")} />
          <Input placeholder="Telefone *" value={form.telefone} onChange={onChange("telefone")} />
          <Input placeholder="Status *" value={form.status} onChange={onChange("status")} />
          <Input placeholder="Operadora *" value={form.operadora} onChange={onChange("operadora")} />
          <Input placeholder="Fornecedor" value={form.fornecedor} onChange={onChange("fornecedor")} />
          <Input placeholder="APN" value={form.apn} onChange={onChange("apn")} />
          <Input placeholder="APN Usuário" value={form.apnUser} onChange={onChange("apnUser")} />
          <Input placeholder="APN Senha" value={form.apnPass} onChange={onChange("apnPass")} />
          <textarea
            placeholder="Observações"
            value={form.obs}
            onChange={onChange("obs")}
            className="w-full rounded-xl border border-stroke bg-card/60 px-3 py-2 md:col-span-2"
            rows={3}
          />
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button onClick={() => setOpen(false)}>Cancelar</Button>
          <Button onClick={handleSave}>Salvar</Button>
        </div>
      </Modal>
    </div>
  );
}
