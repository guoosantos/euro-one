export const REPORT_COLUMN_LABELS = {
  gpsTime: { label: "Transmissão GPS", tooltip: "Transmissão GPS" },
  occurredAt: { label: "Transmissão GPS", tooltip: "Transmissão GPS" },
  deviceTime: { label: "Transmissão Dispositivo", tooltip: "Transmissão Dispositivo" },
  serverTime: { label: "Transmissão Servidor", tooltip: "Transmissão Servidor" },
  latitude: { label: "Latitude", tooltip: "Latitude" },
  longitude: { label: "Longitude", tooltip: "Longitude" },
  address: { label: "Endereço", tooltip: "Endereço" },
  speed: { label: "Velocidade", tooltip: "Velocidade" },
  ignition: { label: "Ignição", tooltip: "Ignição" },
  geofence: { label: "Itinerário", tooltip: "Itinerário" },
  vehicleVoltage: { label: "Tensão do Veículo", tooltip: "Tensão do Veículo" },
  battery: { label: "Tensão da bateria interna do dispositivo", tooltip: "Tensão da bateria interna do dispositivo" },
  input2: { label: "Entrada 2", tooltip: "Entrada 2" },
  input4: { label: "Entrada 4", tooltip: "Entrada 4" },
  input5: { label: "Entrada 5", tooltip: "Entrada 5" },
  digitalInput2: { label: "Entrada 2", tooltip: "Entrada 2" },
  digitalInput4: { label: "Entrada 4", tooltip: "Entrada 4" },
  digitalInput5: { label: "Entrada 5", tooltip: "Entrada 5" },
  digitalOutput1: { label: "Saída 1", tooltip: "Saída 1" },
  digitalOutput2: { label: "Saída 2", tooltip: "Saída 2" },
  digitalOutput3: { label: "Saída 3", tooltip: "Saída 3" },
  geozoneInside: { label: "Dentro do Itinerário", tooltip: "Dentro do Itinerário" },
  geozoneId: { label: "Itinerário", tooltip: "Itinerário" },
  geozoneInsidePrimary: { label: "Dentro do Itinerário", tooltip: "Dentro do Itinerário" },
  vehicleState: { label: "Status", tooltip: "Status" },
  direction: { label: "Direção em graus", tooltip: "Direção em graus" },
  motion: { label: "Veículo em movimento", tooltip: "Veículo em movimento" },
  distance: { label: "Distância percorrida", tooltip: "Distância percorrida" },
  totalDistance: { label: "Distância total acumulada", tooltip: "Distância total acumulada" },
  topSpeed: { label: "Velocidade Máxima do Veículo", tooltip: "Velocidade Máxima do Veículo" },
  satellites: { label: "Número de satélites", tooltip: "Número de satélites" },
  sat: { label: "Número de satélites", tooltip: "Número de satélites" },
  hdop: { label: "Precisão GPS", tooltip: "Precisão GPS" },
  accuracy: { label: "Precisão do posicionamento", tooltip: "Precisão do posicionamento" },
  valid: { label: "GPS com sinal válido", tooltip: "GPS com sinal válido" },
  deviceStatus: { label: "Status", tooltip: "Status" },
  deviceTemp: { label: "Temperatura do dispositivo", tooltip: "Temperatura do dispositivo" },
  rssi: { label: "Intensidade do Sinal Celular", tooltip: "Intensidade do Sinal Celular" },
  status: { label: "Status", tooltip: "Status" },
  batteryLevel: { label: "Nível da Bateria", tooltip: "Nível da Bateria" },
  event: { label: "Evento", tooltip: "Evento" },
  criticality: { label: "Criticidade", tooltip: "Criticidade" },
  jamming: { label: "Bloqueador", tooltip: "Bloqueador" },
  audit: { label: "Auditoria", tooltip: "Ação do usuário" },
};

export function resolveReportColumnLabel(key, fallbackLabel) {
  if (!key) return fallbackLabel;
  const entry = REPORT_COLUMN_LABELS[key];
  return entry?.tooltip || entry?.label || fallbackLabel || key;
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
