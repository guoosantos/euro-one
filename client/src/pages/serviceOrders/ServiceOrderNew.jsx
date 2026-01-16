import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import PageHeader from "../../components/ui/PageHeader.jsx";
import DataCard from "../../components/ui/DataCard.jsx";
import EmptyState from "../../components/ui/EmptyState.jsx";
import VehicleSelector from "../../components/VehicleSelector.jsx";
import useVehicles from "../../lib/hooks/useVehicles.js";
import useCrmClients from "../../lib/hooks/useCrmClients.js";
import { loadGooglePlaces } from "../../lib/google.js";

const STATUS_OPTIONS = [
  { value: "SOLICITADA", label: "Solicitada" },
  { value: "AGENDADA", label: "Agendada" },
  { value: "EM_DESLOCAMENTO", label: "Em deslocamento" },
  { value: "EM_EXECUCAO", label: "Em execução" },
  { value: "AGUARDANDO_APROVACAO", label: "Aguardando aprovação" },
  { value: "CONCLUIDA", label: "Concluído" },
  { value: "CANCELADA", label: "Cancelada" },
  { value: "REMANEJADA", label: "Remanejada" },
];

const TYPE_OPTIONS = [
  "Instalação",
  "Manutenção",
  "Retirada",
  "Remanejamento",
  "Socorro",
  "Reinstalação",
];

const CHECKLIST_ITEMS = [
  { key: "ignicao", label: "Ignição" },
  { key: "radio", label: "Rádio" },
  { key: "setas", label: "Setas" },
  { key: "farol_alto", label: "Farol Alto" },
  { key: "luz_painel", label: "Luz Painel" },
  { key: "farol_baixo", label: "Farol Baixo" },
  { key: "lanternas_traseiras", label: "Lanternas Traseiras" },
  { key: "lanternas_dianteiras", label: "Lanternas Dianteiras" },
  { key: "limpador_parabrisa", label: "Limpador Pára-brisa" },
  { key: "iluminacao_interna", label: "Iluminação Interna" },
  { key: "ar", label: "Ar" },
  { key: "lataria", label: "Lataria" },
  { key: "inst_eletrica", label: "Inst. Elétrica" },
];

const CHECKLIST_STATUS = [
  { value: "OK", label: "OK" },
  { value: "NOK", label: "NOK" },
];

function formatPhone(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (!digits) return "";
  const sliced = digits.slice(0, 11);
  if (sliced.length <= 2) return `(${sliced}`;
  if (sliced.length <= 6) return `(${sliced.slice(0, 2)}) ${sliced.slice(2)}`;
  if (sliced.length <= 10) {
    return `(${sliced.slice(0, 2)}) ${sliced.slice(2, 6)}-${sliced.slice(6)}`;
  }
  return `(${sliced.slice(0, 2)}) ${sliced.slice(2, 7)}-${sliced.slice(7)}`;
}

function buildChecklistState() {
  return CHECKLIST_ITEMS.map((item) => ({
    ...item,
    before: null,
    after: null,
  }));
}

function AddressSearchField({ label, value, onChange, onSelect, placeholder }) {
  const [ready, setReady] = useState(false);
  const [query, setQuery] = useState(value || "");
  const [items, setItems] = useState([]);
  const [focused, setFocused] = useState(false);
  const serviceRef = React.useRef(null);
  const placesRef = React.useRef(null);
  const mapDiv = React.useRef(null);

  useEffect(() => {
    setQuery(value || "");
  }, [value]);

  useEffect(() => {
    loadGooglePlaces().then((g) => {
      if (!g) return;
      serviceRef.current = new g.maps.places.AutocompleteService();
      const map = new g.maps.Map(mapDiv.current || document.createElement("div"));
      placesRef.current = new g.maps.places.PlacesService(map);
      setReady(true);
    });
  }, []);

  useEffect(() => {
    const service = serviceRef.current;
    if (!service || !query) {
      setItems([]);
      return;
    }
    service.getPlacePredictions(
      { input: query, componentRestrictions: { country: ["br"] } },
      (predictions = []) => setItems(predictions),
    );
  }, [query]);

  const handleSelect = (item) => {
    const places = placesRef.current;
    if (!places) {
      const nextValue = item?.description || query;
      onSelect?.(nextValue);
      onChange?.(nextValue);
      setItems([]);
      return;
    }
    places.getDetails({ placeId: item.place_id, fields: ["formatted_address"] }, (detail) => {
      const formatted = detail?.formatted_address || item?.description || query;
      onSelect?.(formatted);
      onChange?.(formatted);
      setQuery(formatted);
      setItems([]);
      setFocused(false);
    });
  };

  return (
    <label className="block text-xs text-white/60">
      {label}
      <div className="relative mt-2">
        <input
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            onChange?.(event.target.value);
          }}
          onFocus={() => setFocused(true)}
          onBlur={() => setTimeout(() => setFocused(false), 120)}
          className="w-full rounded-xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
          placeholder={placeholder}
        />
        {focused && ready && items.length > 0 && (
          <div className="absolute z-30 mt-2 w-full rounded-xl border border-white/10 bg-[#0f141c] shadow-2xl">
            <ul className="max-h-64 overflow-auto text-xs text-white/80">
              {items.map((item) => (
                <li key={item.place_id}>
                  <button
                    type="button"
                    className="flex w-full items-start gap-2 px-3 py-2 text-left transition hover:bg-white/5"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => handleSelect(item)}
                  >
                    <span className="mt-1 h-2 w-2 rounded-full bg-primary/80" />
                    <span className="text-white">{item.description}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
      <div ref={mapDiv} style={{ display: "none" }} />
    </label>
  );
}

export default function ServiceOrderNew() {
  const navigate = useNavigate();
  const { vehicles } = useVehicles({ includeUnlinked: true });
  const { clients: crmClients, loading: crmLoading, error: crmError } = useCrmClients();
  const [saving, setSaving] = useState(false);
  const [equipmentLoading, setEquipmentLoading] = useState(false);
  const [equipmentOptions, setEquipmentOptions] = useState([]);
  const [equipmentSelections, setEquipmentSelections] = useState([]);
  const [checklist, setChecklist] = useState(buildChecklistState);
  const [form, setForm] = useState({
    startAt: "",
    status: "SOLICITADA",
    type: "",
    technicianName: "",
    crmClientId: "",
    clientName: "",
    responsibleName: "",
    responsiblePhone: "",
    addressStart: "",
    address: "",
    addressReturn: "",
    km: "",
    vehicleId: "",
    vehiclePlate: "",
    notes: "",
  });

  const setField = useCallback((field, value) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  }, []);

  const selectedVehicle = useMemo(
    () => vehicles.find((vehicle) => String(vehicle.id) === String(form.vehicleId)) || null,
    [form.vehicleId, vehicles],
  );

  const equipmentById = useMemo(() => new Map(equipmentOptions.map((item) => [item.id, item])), [equipmentOptions]);

  const loadEquipments = useCallback(
    async (vehicleId) => {
      if (!vehicleId) {
        setEquipmentOptions([]);
        return;
      }
      setEquipmentLoading(true);
      try {
        const response = await fetch(`/api/core/service-orders/vehicles/${vehicleId}/equipments`, {
          credentials: "include",
        });
        const payload = await response.json();
        setEquipmentOptions(Array.isArray(payload?.items) ? payload.items : []);
      } catch (error) {
        console.error("Falha ao buscar equipamentos", error);
        setEquipmentOptions([]);
      } finally {
        setEquipmentLoading(false);
      }
    },
    [setEquipmentOptions],
  );

  useEffect(() => {
    loadEquipments(form.vehicleId);
  }, [form.vehicleId, loadEquipments]);

  useEffect(() => {
    if (selectedVehicle?.plate) {
      setField("vehiclePlate", selectedVehicle.plate);
    }
  }, [selectedVehicle?.plate, setField]);

  useEffect(() => {
    setEquipmentSelections((prev) => prev.filter((item) => equipmentById.has(item.equipmentId)));
  }, [equipmentById]);

  const handleEquipmentToggle = (equipment) => {
    setEquipmentSelections((prev) => {
      const exists = prev.find((item) => item.equipmentId === equipment.id);
      if (exists) {
        return prev.filter((item) => item.equipmentId !== equipment.id);
      }
      return [
        ...prev,
        {
          equipmentId: equipment.id,
          model: equipment.productName || equipment.internalId || "Equipamento",
          installLocation: "",
        },
      ];
    });
  };

  const handleEquipmentLocationChange = (equipmentId, value) => {
    setEquipmentSelections((prev) =>
      prev.map((item) => (item.equipmentId === equipmentId ? { ...item, installLocation: value } : item)),
    );
  };

  const handleChecklistChange = (index, field, value) => {
    setChecklist((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: value };
      return next;
    });
  };

  const submit = async () => {
    if (!form.startAt) {
      alert("Informe a data do serviço.");
      return;
    }
    if (!form.responsibleName) {
      alert("Informe o nome do responsável.");
      return;
    }
    const missingInstall = equipmentSelections.find((item) => !item.installLocation);
    if (missingInstall) {
      alert("Informe o local de instalação para todos os equipamentos selecionados.");
      return;
    }

    setSaving(true);
    try {
      const response = await fetch("/api/core/service-orders", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          startAt: form.startAt ? new Date(form.startAt).toISOString() : null,
          status: form.status || "SOLICITADA",
          address: form.address || null,
          addressStart: form.addressStart || null,
          addressReturn: form.addressReturn || null,
          km: form.km === "" ? null : Number(form.km),
          equipmentsText: equipmentSelections.length ? equipmentSelections : null,
          checklist,
        }),
      });

      const payload = await response.json();
      if (!payload?.ok) {
        throw new Error(payload?.error || "Falha ao criar OS");
      }

      navigate(`/services/${payload.item.id}`);
    } catch (error) {
      console.error("Falha ao criar ordem de serviço", error);
      alert("Falha ao criar OS.");
    } finally {
      setSaving(false);
    }
  };

  const vehicleDetails = [
    { label: "Placa *", value: selectedVehicle?.plate },
    { label: "Modelo", value: selectedVehicle?.model || selectedVehicle?.name },
    { label: "Marca", value: selectedVehicle?.brand },
    { label: "Chassi", value: selectedVehicle?.chassis },
    { label: "Renavam", value: selectedVehicle?.renavam },
    { label: "Cor", value: selectedVehicle?.color },
    { label: "Ano Modelo", value: selectedVehicle?.modelYear },
    { label: "Ano de Fabricação", value: selectedVehicle?.manufactureYear },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Nova Ordem de Serviço"
        subtitle="Solicite o serviço e acompanhe o status."
        actions={
          <button
            type="button"
            onClick={submit}
            disabled={saving}
            className="rounded-xl bg-sky-500 px-4 py-2 text-sm font-medium text-black transition hover:bg-sky-400 disabled:opacity-60"
          >
            {saving ? "Salvando..." : "Criar OS"}
          </button>
        }
      />

      <DataCard className="space-y-6">
        <div>
          <h2 className="text-sm font-semibold text-white">Dados básicos</h2>
          <div className="mt-3 grid gap-3 md:grid-cols-3">
            <label className="block text-xs text-white/60">
              Data *
              <input
                type="datetime-local"
                value={form.startAt}
                onChange={(event) => setField("startAt", event.target.value)}
                className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
              />
            </label>
            <label className="block text-xs text-white/60">
              Status
              <select
                value={form.status}
                onChange={(event) => setField("status", event.target.value)}
                className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
              >
                {STATUS_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-xs text-white/60">
              Tipo
              <select
                value={form.type}
                onChange={(event) => setField("type", event.target.value)}
                className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
              >
                <option value="">Selecione</option>
                {TYPE_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-xs text-white/60 md:col-span-2">
              Técnico
              <input
                value={form.technicianName}
                onChange={(event) => setField("technicianName", event.target.value)}
                className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
                placeholder="Ex: Lucas Lima"
              />
            </label>
            <label className="block text-xs text-white/60">
              Cliente
              <select
                value={form.crmClientId}
                onChange={(event) => {
                  const selectedId = event.target.value;
                  const selected = crmClients.find((client) => String(client.id) === String(selectedId));
                  setField("crmClientId", selectedId);
                  setField("clientName", selected?.name || "");
                }}
                className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
              >
                <option value="">Selecione</option>
                {crmClients.map((client) => (
                  <option key={client.id} value={client.id}>
                    {client.name}
                  </option>
                ))}
              </select>
              {crmLoading && <span className="mt-2 block text-[11px] text-white/50">Carregando clientes…</span>}
              {crmError && <span className="mt-2 block text-[11px] text-amber-300">{crmError.message}</span>}
            </label>
          </div>
        </div>

        <div>
          <h2 className="text-sm font-semibold text-white">Responsável</h2>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <label className="block text-xs text-white/60">
              Nome *
              <input
                value={form.responsibleName}
                onChange={(event) => setField("responsibleName", event.target.value)}
                className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
                placeholder="Nome do responsável"
              />
            </label>
            <label className="block text-xs text-white/60">
              Telefone/WhatsApp
              <input
                value={form.responsiblePhone}
                onChange={(event) => setField("responsiblePhone", formatPhone(event.target.value))}
                className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
                placeholder="(31) 99999-9999"
              />
            </label>
          </div>
        </div>

        <div>
          <h2 className="text-sm font-semibold text-white">Endereços</h2>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <AddressSearchField
              label="Endereço Partida"
              value={form.addressStart}
              onChange={(value) => setField("addressStart", value)}
              onSelect={(value) => setField("addressStart", value)}
              placeholder="Rua, número, bairro, cidade-UF, CEP"
            />
            <AddressSearchField
              label="Endereço Serviço"
              value={form.address}
              onChange={(value) => setField("address", value)}
              onSelect={(value) => setField("address", value)}
              placeholder="Rua, número, bairro, cidade-UF, CEP"
            />
            <AddressSearchField
              label="Endereço Volta"
              value={form.addressReturn}
              onChange={(value) => setField("addressReturn", value)}
              onSelect={(value) => setField("addressReturn", value)}
              placeholder="Rua, número, bairro, cidade-UF, CEP"
            />
            <label className="block text-xs text-white/60">
              KM Total
              <input
                type="number"
                min="0"
                value={form.km}
                onChange={(event) => setField("km", event.target.value)}
                className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
                placeholder="0"
              />
            </label>
          </div>
        </div>

        <div>
          <h2 className="text-sm font-semibold text-white">Veículo</h2>
          <div className="mt-3">
            <VehicleSelector
              label="Busca/seleção do veículo"
              placeholder="Digite a placa ou identificação"
              allowUnlinked
              onChange={(vehicleId, vehicle) => {
                setField("vehicleId", vehicleId || "");
                setField("vehiclePlate", vehicle?.plate || "");
              }}
            />
          </div>
          {selectedVehicle ? (
            <div className="mt-4 grid gap-3 md:grid-cols-4">
              {vehicleDetails.map((detail) => (
                <div key={detail.label} className="rounded-xl border border-white/10 bg-white/5 px-3 py-2">
                  <div className="text-[11px] uppercase tracking-[0.12em] text-white/50">{detail.label}</div>
                  <div className="mt-1 text-sm text-white/80">{detail.value || "—"}</div>
                </div>
              ))}
            </div>
          ) : (
            <div className="mt-3">
              <EmptyState title="Selecione um veículo para visualizar os detalhes." />
            </div>
          )}
        </div>

        <div>
          <h2 className="text-sm font-semibold text-white">Equipamentos</h2>
          {equipmentLoading ? (
            <div className="mt-3 text-sm text-white/60">Carregando equipamentos vinculados…</div>
          ) : equipmentOptions.length === 0 ? (
            <div className="mt-3">
              <EmptyState title="Nenhum equipamento vinculado ao veículo selecionado." />
            </div>
          ) : (
            <div className="mt-3 space-y-4">
              <div className="grid gap-2 md:grid-cols-2">
                {equipmentOptions.map((equipment) => {
                  const isChecked = Boolean(equipmentSelections.find((item) => item.equipmentId === equipment.id));
                  const label = equipment.productName
                    ? `${equipment.productName} · ${equipment.internalId}`
                    : equipment.internalId;
                  return (
                    <label
                      key={equipment.id}
                      className={`flex items-center justify-between rounded-xl border px-3 py-2 text-sm transition ${
                        isChecked ? "border-sky-400/60 bg-white/10" : "border-white/10 bg-black/30"
                      }`}
                    >
                      <span className="text-white/80">{label}</span>
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => handleEquipmentToggle(equipment)}
                      />
                    </label>
                  );
                })}
              </div>
              {equipmentSelections.length > 0 && (
                <div className="space-y-3">
                  {equipmentSelections.map((item) => (
                    <label key={item.equipmentId} className="block text-xs text-white/60">
                      Local de instalação do equipamento
                      <input
                        value={item.installLocation}
                        onChange={(event) => handleEquipmentLocationChange(item.equipmentId, event.target.value)}
                        className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
                        placeholder={`Ex: Painel do veículo (${item.model})`}
                      />
                    </label>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <div>
          <h2 className="text-sm font-semibold text-white">Checklist</h2>
          <div className="mt-3 overflow-hidden rounded-xl border border-white/10">
            <table className="min-w-full text-sm text-white">
              <thead className="bg-white/5 text-xs uppercase tracking-wide text-white/70">
                <tr>
                  <th className="px-4 py-3 text-left">Item</th>
                  <th className="px-4 py-3 text-center">Antes</th>
                  <th className="px-4 py-3 text-center">Depois</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/10">
                {checklist.map((item, index) => (
                  <tr key={item.key}>
                    <td className="px-4 py-3 text-white/90">{item.label}</td>
                    {(["before", "after"]).map((field) => (
                      <td key={field} className="px-4 py-3 text-center">
                        <div className="inline-flex gap-2">
                          {CHECKLIST_STATUS.map((status) => (
                            <button
                              key={status.value}
                              type="button"
                              className={`rounded-lg px-3 py-1 text-xs transition ${
                                item[field] === status.value
                                  ? "bg-sky-500 text-black"
                                  : "bg-white/10 text-white/70 hover:bg-white/15"
                              }`}
                              onClick={() => handleChecklistChange(index, field, status.value)}
                            >
                              {status.label}
                            </button>
                          ))}
                        </div>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div>
          <h2 className="text-sm font-semibold text-white">Observações</h2>
          <textarea
            value={form.notes}
            onChange={(event) => setField("notes", event.target.value)}
            className="mt-3 min-h-[120px] w-full rounded-xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
            placeholder="Detalhes importantes para a execução."
          />
        </div>
      </DataCard>

      <div className="flex flex-wrap items-center justify-end gap-2">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="rounded-xl bg-white/10 px-4 py-2 text-sm text-white transition hover:bg-white/15"
        >
          Cancelar
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={saving}
          className="rounded-xl bg-sky-500 px-4 py-2 text-sm font-medium text-black transition hover:bg-sky-400 disabled:opacity-60"
        >
          {saving ? "Salvando..." : "Criar OS"}
        </button>
      </div>
    </div>
  );
}
