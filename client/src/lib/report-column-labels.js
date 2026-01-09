import { isIotmProtocol, resolveIotmReportColumnLabel } from "../../../shared/positionsColumns.js";
import { resolveReportColumnLabelOverride } from "../../../shared/reportColumnLabels.js";

export const REPORT_COLUMN_LABELS = {
  gpsTime: { label: "Hora do Evento", tooltip: "Hora do Evento" },
  occurredAt: { label: "Hora do Evento", tooltip: "Hora do Evento" },
  deviceTime: { label: "Hora do Dispositivo", tooltip: "Hora do Dispositivo" },
  serverTime: { label: "Hora do Servidor", tooltip: "Hora do Servidor" },
  latitude: { label: "Latitude", tooltip: "Latitude" },
  longitude: { label: "Longitude", tooltip: "Longitude" },
  address: { label: "Endereço", tooltip: "Endereço" },
  speed: { label: "Velocidade", tooltip: "Velocidade" },
  ignition: { label: "Ignição", tooltip: "Ignição" },
  geofence: { label: "Itinerário", tooltip: "Itinerário" },
  vehicleVoltage: { label: "Tensão do Veículo", tooltip: "Tensão do Veículo" },
  battery: { label: "Bateria Dispositivo", tooltip: "Bateria Dispositivo" },
  ioDetails: { label: "Detalhes IO", tooltip: "Detalhes IO" },
  ioSummary: { label: "Detalhes IO", tooltip: "Detalhes IO" },
  input2: { label: "Entrada 2", tooltip: "Entrada 2" },
  input4: { label: "Entrada 4", tooltip: "Entrada 4" },
  input5: { label: "Entrada 5", tooltip: "Entrada 5" },
  in2: { label: "Entrada 2", tooltip: "Entrada 2" },
  in4: { label: "Entrada 4", tooltip: "Entrada 4" },
  in5: { label: "Entrada 5", tooltip: "Entrada 5" },
  digitalInput2: { label: "Entrada 2", tooltip: "Entrada 2" },
  digitalInput4: { label: "Entrada 4", tooltip: "Entrada 4" },
  digitalInput5: { label: "Entrada 5", tooltip: "Entrada 5" },
  out1: { label: "Saída 1", tooltip: "Saída 1" },
  out2: { label: "Saída 2", tooltip: "Saída 2" },
  out3: { label: "Saída 3", tooltip: "Saída 3" },
  digitalOutput1: { label: "Saída 1", tooltip: "Saída 1" },
  digitalOutput2: { label: "Saída 2", tooltip: "Saída 2" },
  digitalOutput3: { label: "Saída 3", tooltip: "Saída 3" },
  geozoneInside: { label: "Dentro do Itinerário", tooltip: "Dentro do Itinerário" },
  geozoneId: { label: "Itinerário", tooltip: "Itinerário" },
  geozoneInsidePrimary: { label: "Dentro do Itinerário", tooltip: "Dentro do Itinerário" },
  vehicleState: { label: "Status Veículo", tooltip: "Status Veículo" },
  direction: { label: "Direção em graus", tooltip: "Direção em graus" },
  motion: { label: "Veiculo Movimento", tooltip: "Veiculo Movimento" },
  distance: { label: "Distância", tooltip: "Distância" },
  totalDistance: { label: "Distância Total", tooltip: "Distância Total" },
  topSpeed: { label: "Velocidade Máxima", tooltip: "Velocidade Máxima" },
  satellites: { label: "Satélites", tooltip: "Satélites" },
  sat: { label: "Satélites", tooltip: "Satélites" },
  hdop: { label: "Precisão GPS", tooltip: "Precisão GPS" },
  accuracy: { label: "Altitude", tooltip: "Altitude" },
  valid: { label: "GPS com sinal válido", tooltip: "GPS com sinal válido" },
  deviceStatus: { label: "Status", tooltip: "Status" },
  deviceTemp: { label: "Temperatura", tooltip: "Temperatura" },
  rssi: { label: "Sinal Celular", tooltip: "Sinal Celular" },
  status: { label: "Status", tooltip: "Status" },
  batteryLevel: { label: "Nível da Bateria", tooltip: "Nível da Bateria" },
  event: { label: "Evento", tooltip: "Evento" },
  eventActive: { label: "Evento Ativo", tooltip: "Evento Ativo" },
  eventSeverity: { label: "Criticidade", tooltip: "Criticidade" },
  criticality: { label: "Criticidade", tooltip: "Criticidade" },
  jamming: { label: "Bloqueador", tooltip: "Bloqueador" },
  audit: { label: "Auditoria", tooltip: "Ação do usuário" },
  portaFL: { label: "CAN - Porta Motorista", tooltip: "CAN - Porta Motorista" },
  portaRL: { label: "CAN - Porta Passageiro", tooltip: "CAN - Porta Passageiro" },
  obdOdometer: { label: "CAN - Odômetro", tooltip: "CAN - Odômetro" },
};

export function resolveReportColumnLabel(key, fallbackLabel, options = {}) {
  if (!key) return fallbackLabel;
  if (isIotmProtocol(options.protocol, options.deviceModel)) {
    const iotmLabel = resolveIotmReportColumnLabel(key, fallbackLabel);
    if (iotmLabel) return iotmLabel;
  }
  const override = resolveReportColumnLabelOverride(key, fallbackLabel);
  if (override) return override;
  const normalizedKey = String(key || "").trim();
  const entry = REPORT_COLUMN_LABELS[normalizedKey] || REPORT_COLUMN_LABELS[normalizedKey.toLowerCase()];
  return entry?.tooltip || entry?.label || fallbackLabel || key;
}

export function resolveReportColumnTooltip(key, fallbackTooltip, options = {}) {
  if (!key) return fallbackTooltip;
  if (isIotmProtocol(options.protocol, options.deviceModel)) {
    const iotmLabel = resolveIotmReportColumnLabel(key, fallbackTooltip);
    if (iotmLabel) return iotmLabel;
  }
  const override = resolveReportColumnLabelOverride(key, fallbackTooltip);
  if (override) return override;
  const normalizedKey = String(key || "").trim();
  const entry = REPORT_COLUMN_LABELS[normalizedKey] || REPORT_COLUMN_LABELS[normalizedKey.toLowerCase()];
  return entry?.tooltip || fallbackTooltip || entry?.label || key;
}

export function formatLatLng(lat, lng) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return "";
  return `(${lat.toFixed(5)}, ${lng.toFixed(5)})`;
}

export function buildAddressWithLatLng(address, lat, lng) {
  const coords = formatLatLng(lat, lng);
  if (!coords) return address || "—";
  if (!address || address === "—") return coords;
  return `${address} ${coords}`;
}
