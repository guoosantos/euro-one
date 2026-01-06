export const REPORT_COLUMN_LABELS = {
  gpsTime: { label: "Data/Hora", tooltip: "Data/Hora GPS" },
  occurredAt: { label: "Data/Hora", tooltip: "Data/Hora" },
  deviceTime: { label: "Hora do Dispositivo", tooltip: "Hora do dispositivo" },
  serverTime: { label: "Hora do Servidor", tooltip: "Hora do servidor" },
  latitude: { label: "Latitude", tooltip: "Latitude" },
  longitude: { label: "Longitude", tooltip: "Longitude" },
  address: { label: "Endereço (Latitude / Longitude)", tooltip: "Endereço (Latitude / Longitude)" },
  speed: { label: "Velocidade", tooltip: "Velocidade" },
  ignition: { label: "Ignição", tooltip: "Ignição" },
  geofence: { label: "Geozona", tooltip: "Geozona" },
  vehicleVoltage: { label: "Tensão do Veículo", tooltip: "Tensão do veículo" },
  ioDetails: { label: "Entradas/Saídas", tooltip: "Entradas/Saídas" },
  ioSummary: { label: "Entradas/Saídas", tooltip: "Entradas/Saídas" },
  input2: { label: "Entrada 2", tooltip: "Entrada 2" },
  input4: { label: "Entrada 4", tooltip: "Entrada 4" },
  digitalInput2: { label: "Entrada 2", tooltip: "Entrada 2" },
  digitalInput4: { label: "Entrada 4", tooltip: "Entrada 4" },
  digitalInput5: { label: "Entrada 5", tooltip: "Entrada 5" },
  digitalOutput1: { label: "Saída 1", tooltip: "Saída 1" },
  digitalOutput2: { label: "Saída 2", tooltip: "Saída 2" },
  geozoneInside: { label: "Dentro da Geozona", tooltip: "Dentro da Geozona" },
  geozoneId: { label: "ID da Geozona", tooltip: "Identificador da Geozona" },
  event: { label: "Evento", tooltip: "Evento" },
  criticality: { label: "Criticidade", tooltip: "Criticidade" },
  jamming: { label: "Bloqueador", tooltip: "Bloqueador" },
  audit: { label: "Auditoria", tooltip: "Ação do usuário" },
};

export function resolveReportColumnLabel(key, fallbackLabel) {
  if (!key) return fallbackLabel;
  const entry = REPORT_COLUMN_LABELS[key];
  return entry?.label || fallbackLabel || key;
}

export function resolveReportColumnTooltip(key, fallbackTooltip) {
  if (!key) return fallbackTooltip;
  const entry = REPORT_COLUMN_LABELS[key];
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
