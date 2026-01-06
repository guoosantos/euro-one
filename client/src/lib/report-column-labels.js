export const REPORT_COLUMN_LABELS = {
  gpsTime: { label: "Data", tooltip: "Data/Hora GPS" },
  occurredAt: { label: "Data", tooltip: "Data/Hora" },
  deviceTime: { label: "Disp.", tooltip: "Hora do dispositivo" },
  serverTime: { label: "Serv.", tooltip: "Hora do servidor" },
  latitude: { label: "Lat", tooltip: "Latitude" },
  longitude: { label: "Long", tooltip: "Longitude" },
  address: { label: "Endereço", tooltip: "Endereço (Lat/Long)" },
  speed: { label: "Vel.", tooltip: "Velocidade" },
  ignition: { label: "Ignição", tooltip: "Ignição" },
  geofence: { label: "Geozona", tooltip: "Geozona" },
  vehicleVoltage: { label: "Tensão", tooltip: "Tensão do veículo" },
  ioDetails: { label: "Entr/Saí", tooltip: "Entradas/Saídas" },
  ioSummary: { label: "Entr/Saí", tooltip: "Entradas/Saídas" },
  input2: { label: "E2", tooltip: "Entrada 2" },
  input4: { label: "E4", tooltip: "Entrada 4" },
  event: { label: "Evento", tooltip: "Evento" },
  criticality: { label: "Critic.", tooltip: "Criticidade" },
  jamming: { label: "Jamming", tooltip: "Bloqueador" },
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
