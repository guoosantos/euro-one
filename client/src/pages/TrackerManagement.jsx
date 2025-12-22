import React, { useEffect, useMemo, useState } from "react";
import { Plus, Trash } from "lucide-react";

import Button from "../ui/Button";
import Card from "../ui/Card";
import Input from "../ui/Input";
import useTrackerMappings from "../lib/hooks/useTrackerMappings.js";
import { useTenant } from "../lib/tenant-context.jsx";

function MappingRow({ mapping, onDelete }) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-white/5 bg-white/5 px-3 py-2 text-sm text-white">
      <div className="flex flex-col">
        <span className="font-semibold text-white">{mapping.label}</span>
        <span className="text-[11px] text-white/60">{mapping.key || mapping.eventKey}</span>
      </div>
      <div className="flex items-center gap-3 text-xs text-white/70">
        {mapping.dataType && <span className="rounded bg-white/10 px-2 py-1">{mapping.dataType}</span>}
        {mapping.unit && <span className="rounded bg-white/10 px-2 py-1">{mapping.unit}</span>}
        <Button size="xs" variant="ghost" onClick={() => onDelete(mapping)}>
          <Trash size={14} />
        </Button>
      </div>
    </div>
  );
}

export default function TrackerManagement() {
  const { tenantId, role } = useTenant();
  const {
    devices,
    telemetryMappings,
    eventMappings,
    loading,
    error,
    reload,
    saveTelemetryMapping,
    saveEventMapping,
    deleteMapping,
  } = useTrackerMappings();

  const [selectedDeviceId, setSelectedDeviceId] = useState(null);
  const [telemetryDraft, setTelemetryDraft] = useState({ key: "", label: "", dataType: "string", unit: "" });
  const [eventDraft, setEventDraft] = useState({ eventKey: "", label: "" });

  useEffect(() => {
    if (devices.length && !selectedDeviceId) {
      setSelectedDeviceId(String(devices[0].id));
    }
  }, [devices, selectedDeviceId]);

  const filteredTelemetry = useMemo(
    () => telemetryMappings.filter((item) => !selectedDeviceId || String(item.deviceId) === String(selectedDeviceId)),
    [selectedDeviceId, telemetryMappings],
  );

  const filteredEvents = useMemo(
    () => eventMappings.filter((item) => !selectedDeviceId || String(item.deviceId) === String(selectedDeviceId)),
    [selectedDeviceId, eventMappings],
  );

  const handleSaveTelemetry = async () => {
    if (!telemetryDraft.key || !telemetryDraft.label) return;
    await saveTelemetryMapping({ ...telemetryDraft, deviceId: selectedDeviceId, clientId: tenantId });
    setTelemetryDraft({ key: "", label: "", dataType: "string", unit: "" });
    reload({ deviceId: selectedDeviceId });
  };

  const handleSaveEvent = async () => {
    if (!eventDraft.eventKey || !eventDraft.label) return;
    await saveEventMapping({ ...eventDraft, deviceId: selectedDeviceId, clientId: tenantId });
    setEventDraft({ eventKey: "", label: "" });
    reload({ deviceId: selectedDeviceId });
  };

  const handleDelete = async (mapping, type) => {
    await deleteMapping(type, mapping.id);
    reload({ deviceId: selectedDeviceId });
  };

  if (role !== "admin") {
    return <p className="text-white">Apenas administradores podem gerenciar mapeamentos de rastreador.</p>;
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-white">Gerenciar rastreador</h1>
      {error && <p className="text-red-400">{error.message}</p>}
      <Card>
        <div className="flex flex-col gap-4">
          <div>
            <p className="text-sm font-semibold text-white">Selecione um rastreador do Traccar</p>
            <select
              className="mt-2 w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-white"
              value={selectedDeviceId || ""}
              onChange={(event) => setSelectedDeviceId(event.target.value)}
            >
              {devices.map((device) => (
                <option key={device.id} value={device.id} className="bg-slate-900">
                  {device.name || device.uniqueId || device.id} {device.protocol ? `· ${device.protocol}` : ""}
                </option>
              ))}
            </select>
            {loading && <p className="text-xs text-white/60">Carregando dispositivos...</p>}
          </div>

          <div className="grid gap-6 md:grid-cols-2">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold text-white">Mapeamentos de telemetria</h2>
                <Button size="sm" onClick={handleSaveTelemetry} disabled={!telemetryDraft.key || !telemetryDraft.label}>
                  <Plus size={16} /> Adicionar
                </Button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Input
                  label="Chave do atributo"
                  value={telemetryDraft.key}
                  onChange={(event) => setTelemetryDraft((prev) => ({ ...prev, key: event.target.value }))}
                />
                <Input
                  label="Rótulo amigável"
                  value={telemetryDraft.label}
                  onChange={(event) => setTelemetryDraft((prev) => ({ ...prev, label: event.target.value }))}
                />
                <Input
                  label="Tipo"
                  value={telemetryDraft.dataType}
                  onChange={(event) => setTelemetryDraft((prev) => ({ ...prev, dataType: event.target.value }))}
                />
                <Input
                  label="Unidade"
                  value={telemetryDraft.unit}
                  onChange={(event) => setTelemetryDraft((prev) => ({ ...prev, unit: event.target.value }))}
                />
              </div>
              <div className="space-y-2">
                {filteredTelemetry.map((mapping) => (
                  <MappingRow key={mapping.id} mapping={mapping} onDelete={() => handleDelete(mapping, "telemetry")} />
                ))}
                {!filteredTelemetry.length && <p className="text-sm text-white/60">Nenhum mapeamento salvo.</p>}
              </div>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold text-white">Mapeamentos de eventos</h2>
                <Button size="sm" onClick={handleSaveEvent} disabled={!eventDraft.eventKey || !eventDraft.label}>
                  <Plus size={16} /> Adicionar
                </Button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Input
                  label="Evento do Traccar"
                  value={eventDraft.eventKey}
                  onChange={(event) => setEventDraft((prev) => ({ ...prev, eventKey: event.target.value }))}
                />
                <Input
                  label="Rótulo amigável"
                  value={eventDraft.label}
                  onChange={(event) => setEventDraft((prev) => ({ ...prev, label: event.target.value }))}
                />
              </div>
              <div className="space-y-2">
                {filteredEvents.map((mapping) => (
                  <MappingRow key={mapping.id} mapping={mapping} onDelete={() => handleDelete(mapping, "event")} />
                ))}
                {!filteredEvents.length && <p className="text-sm text-white/60">Nenhum evento mapeado.</p>}
              </div>
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}
