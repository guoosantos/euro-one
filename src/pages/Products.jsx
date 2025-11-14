import React, { useMemo, useState } from "react";

import PageHeader from "../ui/PageHeader";
import Input from "../ui/Input";
import Button from "../ui/Button";
import Field from "../ui/Field";
import { Table, Pager } from "../ui/Table";
import { products } from "../mock/fleet";

export default function Products() {
  const [form, setForm] = useState({ nome: "", fabricante: "", protocolo: "", tipo: "" });

  const rows = useMemo(
    () => products.map((product) => [product.name, "Euro", product.connectivity, product.inputs + " entradas", "Editar"]),
    [],
  );

  const onChange = (key) => (event) => setForm((state) => ({ ...state, [key]: event.target.value }));
  const handleSave = () => {
    console.log("Salvar produto", form);
    setForm({ nome: "", fabricante: "", protocolo: "", tipo: "" });
  };

  return (
    <div className="space-y-5">
      <PageHeader title="Produtos (modelos)" />
      <div className="grid gap-3">
        <Field label="Novo modelo">
          <div className="grid gap-3 md:grid-cols-4">
            <Input placeholder="Nome * (ex.: ES-JAMMER)" value={form.nome} onChange={onChange("nome")} />
            <Input placeholder="Fabricante" value={form.fabricante} onChange={onChange("fabricante")} />
            <Input placeholder="Conectividade" value={form.protocolo} onChange={onChange("protocolo")} />
            <Input placeholder="Tipo" value={form.tipo} onChange={onChange("tipo")} />
          </div>
          <div className="mt-3">
            <Button onClick={handleSave}>Salvar modelo</Button>
          </div>
        </Field>

        <Field label="Modelos cadastrados">
          <Table head={["Nome", "Fabricante", "Conectividade", "IO", "Ações"]} rows={rows} />
          <Pager />
        </Field>
      </div>
    </div>
  );
}
