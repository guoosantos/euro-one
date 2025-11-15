import React, { useEffect, useState } from "react";

import PageHeader from "../ui/PageHeader";
import Button from "../ui/Button";
import Modal from "../ui/Modal";
import Input from "../ui/Input";
import Select from "../ui/Select";
import Field from "../ui/Field";
import { CoreApi } from "../lib/coreApi.js";

function ModelCards({ models }) {
  if (!Array.isArray(models) || models.length === 0) {
    return <div className="rounded-xl border border-white/10 bg-white/5 p-6 text-sm text-white/70">Nenhum modelo cadastrado.</div>;
  }
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {models.map((model) => (
        <div key={model.id} className="rounded-2xl border border-white/10 bg-white/5 p-5">
          <div className="text-lg font-semibold text-white">{model.name}</div>
          <div className="text-sm text-white/70">{model.brand}</div>
          <dl className="mt-4 space-y-2 text-sm text-white/70">
            {model.protocol && (
              <div>
                <dt className="font-medium text-white">Protocolo</dt>
                <dd>{model.protocol}</dd>
              </div>
            )}
            {model.connectivity && (
              <div>
                <dt className="font-medium text-white">Conectividade</dt>
                <dd>{model.connectivity}</dd>
              </div>
            )}
          </dl>
          <div className="mt-4">
            <h4 className="text-sm font-semibold text-white">Portas</h4>
            {Array.isArray(model.ports) && model.ports.length > 0 ? (
              <ul className="mt-2 space-y-1 text-sm text-white/70">
                {model.ports.map((port) => (
                  <li key={port.id || `${port.label}-${port.type}`} className="rounded-lg border border-white/10 bg-white/5 px-3 py-2">
                    <div className="font-medium text-white">{port.label || "Porta"}</div>
                    <div className="text-xs uppercase tracking-wide text-white/60">{port.type || "Digital"}</div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-sm text-white/60">Nenhuma porta cadastrada.</p>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function Products() {
  const [models, setModels] = useState([]);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [form, setForm] = useState({ name: "", brand: "", protocol: "", connectivity: "", ports: [{ label: "", type: "digital" }] });

  async function load() {
    setError(null);
    try {
      const modelList = await CoreApi.models();
      setModels(Array.isArray(modelList) ? modelList : []);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError : new Error("Falha ao carregar modelos"));
    }
  }

  useEffect(() => {
    load();
  }, []);

  function updatePort(index, key, value) {
    setForm((current) => {
      const ports = Array.isArray(current.ports) ? [...current.ports] : [];
      ports[index] = { ...ports[index], [key]: value };
      return { ...current, ports };
    });
  }

  function addPort() {
    setForm((current) => ({ ...current, ports: [...(current.ports || []), { label: "", type: "digital" }] }));
  }

  function removePort(index) {
    setForm((current) => ({ ...current, ports: (current.ports || []).filter((_, idx) => idx !== index) }));
  }

  async function handleSave(event) {
    event.preventDefault();
    if (!form.name.trim() || !form.brand.trim()) {
      alert("Informe nome e fabricante");
      return;
    }
    setSaving(true);
    try {
      await CoreApi.createModel({
        name: form.name.trim(),
        brand: form.brand.trim(),
        protocol: form.protocol.trim() || undefined,
        connectivity: form.connectivity.trim() || undefined,
        ports: (form.ports || [])
          .map((port) => ({ label: port.label?.trim() || "", type: port.type?.trim() || "digital" }))
          .filter((port) => port.label),
      });
      setOpen(false);
      setForm({ name: "", brand: "", protocol: "", connectivity: "", ports: [{ label: "", type: "digital" }] });
      await load();
    } catch (requestError) {
      alert(requestError?.message || "Falha ao cadastrar modelo");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader title="Modelos de rastreadores" right={<Button onClick={() => setOpen(true)}>+ Novo modelo</Button>} />

      {error && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">{error.message}</div>
      )}

      <ModelCards models={models} />

      <Modal open={open} onClose={() => setOpen(false)} title="Novo modelo" width="max-w-3xl">
        <form onSubmit={handleSave} className="space-y-4">
          <Field label="Informações básicas">
            <div className="grid gap-3 md:grid-cols-2">
              <Input
                placeholder="Nome *"
                value={form.name}
                onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
              />
              <Input
                placeholder="Fabricante *"
                value={form.brand}
                onChange={(event) => setForm((current) => ({ ...current, brand: event.target.value }))}
              />
              <Input
                placeholder="Protocolo"
                value={form.protocol}
                onChange={(event) => setForm((current) => ({ ...current, protocol: event.target.value }))}
              />
              <Input
                placeholder="Conectividade"
                value={form.connectivity}
                onChange={(event) => setForm((current) => ({ ...current, connectivity: event.target.value }))}
              />
            </div>
          </Field>

          <Field label="Portas">
            <div className="space-y-3">
              {(form.ports || []).map((port, index) => (
                <div key={`product-port-${index}`} className="grid gap-3 md:grid-cols-5">
                  <Input
                    placeholder="Nome"
                    value={port.label}
                    onChange={(event) => updatePort(index, "label", event.target.value)}
                    className="md:col-span-3"
                  />
                  <Select
                    value={port.type}
                    onChange={(event) => updatePort(index, "type", event.target.value)}
                    className="md:col-span-1"
                  >
                    <option value="digital">Digital</option>
                    <option value="analógica">Analógica</option>
                    <option value="entrada">Entrada</option>
                    <option value="saida">Saída</option>
                  </Select>
                  <Button type="button" onClick={() => removePort(index)} disabled={(form.ports || []).length <= 1}>
                    Remover
                  </Button>
                </div>
              ))}
              <Button type="button" onClick={addPort}>
                + Adicionar porta
              </Button>
            </div>
          </Field>

          <div className="flex justify-end gap-2">
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
