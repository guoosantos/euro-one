import React from "react";
import { VEHICLE_TYPE_OPTIONS } from "../../lib/icons/vehicleIcons.js";

const FIELD_CLASS =
  "mt-1 w-full rounded-xl border border-white/10 bg-white/10 px-3 py-2 text-sm text-white focus:border-white/30 focus:outline-none";

function FieldLabel({ children, required = false }) {
  return (
    <label className="text-xs uppercase tracking-[0.12em] text-white/60">
      {children}
      {required ? " *" : ""}
    </label>
  );
}

export default function VehicleForm({
  value,
  onChange,
  tenants = [],
  showClient = false,
  requireClient = false,
  showStatus = true,
  showDeviceSelect = false,
  deviceOptions = [],
  disabled = false,
}) {
  const handleChange = (field) => (event) => {
    const nextValue = event?.target?.type === "checkbox" ? event.target.checked : event.target.value;
    onChange?.({ ...value, [field]: nextValue });
  };

  return (
    <div className="grid gap-3 md:grid-cols-2">
      {showClient && (
        <div className="md:col-span-2">
          <FieldLabel required={requireClient}>Cliente</FieldLabel>
          <select
            value={value.clientId || ""}
            onChange={handleChange("clientId")}
            className={FIELD_CLASS}
            required={requireClient}
            disabled={disabled}
          >
            <option value="">Selecione o cliente</option>
            {tenants.map((tenant) => (
              <option key={tenant.id || "all"} value={tenant.id || ""}>
                {tenant.name}
              </option>
            ))}
          </select>
        </div>
      )}

      <div>
        <FieldLabel>Item</FieldLabel>
        <input
          value={value.item || ""}
          onChange={handleChange("item")}
          className={FIELD_CLASS}
          disabled={disabled}
        />
      </div>

      <div>
        <FieldLabel required>Tipo do veículo</FieldLabel>
        <select
          value={value.type || ""}
          onChange={handleChange("type")}
          className={FIELD_CLASS}
          required
          disabled={disabled}
        >
          <option value="">Selecione o tipo</option>
          {VEHICLE_TYPE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      <div>
        <FieldLabel required>Placa</FieldLabel>
        <input
          value={value.plate || ""}
          onChange={handleChange("plate")}
          className={FIELD_CLASS}
          required
          disabled={disabled}
        />
      </div>

      <div>
        <FieldLabel>Identificador</FieldLabel>
        <input
          value={value.identifier || ""}
          onChange={handleChange("identifier")}
          className={FIELD_CLASS}
          disabled={disabled}
        />
      </div>

      <div>
        <FieldLabel required>Modelo</FieldLabel>
        <input
          value={value.model || ""}
          onChange={handleChange("model")}
          className={FIELD_CLASS}
          required
          disabled={disabled}
        />
      </div>

      <div>
        <FieldLabel>Marca</FieldLabel>
        <input
          value={value.brand || ""}
          onChange={handleChange("brand")}
          className={FIELD_CLASS}
          disabled={disabled}
        />
      </div>

      <div>
        <FieldLabel>Chassi</FieldLabel>
        <input
          value={value.chassis || ""}
          onChange={handleChange("chassis")}
          className={FIELD_CLASS}
          disabled={disabled}
        />
      </div>

      <div>
        <FieldLabel>Renavam</FieldLabel>
        <input
          value={value.renavam || ""}
          onChange={handleChange("renavam")}
          className={FIELD_CLASS}
          disabled={disabled}
        />
      </div>

      <div>
        <FieldLabel>Cor</FieldLabel>
        <input
          value={value.color || ""}
          onChange={handleChange("color")}
          className={FIELD_CLASS}
          disabled={disabled}
        />
      </div>

      <div>
        <FieldLabel>Ano Modelo</FieldLabel>
        <input
          type="number"
          value={value.modelYear ?? ""}
          onChange={handleChange("modelYear")}
          className={FIELD_CLASS}
          disabled={disabled}
        />
      </div>

      <div>
        <FieldLabel>Ano de Fabricação</FieldLabel>
        <input
          type="number"
          value={value.manufactureYear ?? ""}
          onChange={handleChange("manufactureYear")}
          className={FIELD_CLASS}
          disabled={disabled}
        />
      </div>

      <div>
        <FieldLabel>Código FIPE</FieldLabel>
        <input
          value={value.fipeCode || ""}
          onChange={handleChange("fipeCode")}
          className={FIELD_CLASS}
          disabled={disabled}
        />
      </div>

      <div>
        <FieldLabel>Valor FIPE</FieldLabel>
        <input
          type="number"
          step="0.01"
          value={value.fipeValue ?? ""}
          onChange={handleChange("fipeValue")}
          className={FIELD_CLASS}
          disabled={disabled}
        />
      </div>

      <div className="flex items-center gap-2 md:col-span-2">
        <input
          id="zeroKm"
          type="checkbox"
          checked={Boolean(value.zeroKm)}
          onChange={handleChange("zeroKm")}
          className="h-4 w-4 rounded border-white/30 bg-transparent"
          disabled={disabled}
        />
        <label htmlFor="zeroKm" className="text-xs uppercase tracking-[0.12em] text-white/60">
          Zero Km
        </label>
      </div>

      <div>
        <FieldLabel>Motorista</FieldLabel>
        <input
          value={value.driver || ""}
          onChange={handleChange("driver")}
          className={FIELD_CLASS}
          disabled={disabled}
        />
      </div>

      <div>
        <FieldLabel>Grupo</FieldLabel>
        <input
          value={value.group || ""}
          onChange={handleChange("group")}
          className={FIELD_CLASS}
          disabled={disabled}
        />
      </div>

      {showStatus && (
        <div>
          <FieldLabel>Status</FieldLabel>
          <select
            value={value.status || "ativo"}
            onChange={handleChange("status")}
            className={FIELD_CLASS}
            disabled={disabled}
          >
            <option value="ativo">Ativo</option>
            <option value="inativo">Inativo</option>
            <option value="manutencao">Manutenção</option>
          </select>
        </div>
      )}

      {showDeviceSelect && (
        <div className="md:col-span-2">
          <FieldLabel>Equipamento</FieldLabel>
          <select
            value={value.deviceId || ""}
            onChange={handleChange("deviceId")}
            className={FIELD_CLASS}
            disabled={disabled}
          >
            <option value="">Equipamento (opcional)</option>
            {deviceOptions.map((device) => (
              <option key={device.internalId || device.id || device.uniqueId} value={device.internalId || device.id}>
                {device.name || device.uniqueId || device.internalId}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="md:col-span-2">
        <FieldLabel>Observações</FieldLabel>
        <textarea
          className="mt-1 w-full rounded-xl border border-white/10 bg-white/10 px-3 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
          rows={3}
          value={value.notes || ""}
          onChange={handleChange("notes")}
          disabled={disabled}
        />
      </div>
    </div>
  );
}
