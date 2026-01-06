export const REPORT_COLUMN_LABELS = {
  gpsTime: { label: "Data/Hora", tooltip: "Data e hora do evento" },
  occurredAt: { label: "Data/Hora", tooltip: "Data e hora do evento" },
  deviceTime: { label: "Hora do Dispositivo", tooltip: "Hora registrada pelo dispositivo" },
  serverTime: { label: "Hora do Servidor", tooltip: "Hora registrada pelo servidor" },
  latitude: { label: "Latitude", tooltip: "Latitude" },
  longitude: { label: "Longitude", tooltip: "Longitude" },
  address: { label: "Endereço (Latitude / Longitude)", tooltip: "Endereço com coordenadas GPS" },
  speed: { label: "Velocidade", tooltip: "Velocidade do veículo" },
  ignition: { label: "Ignição", tooltip: "Ignição (Ligada / Desligada)" },
  geofence: { label: "Geozona", tooltip: "Geozona" },
  vehicleVoltage: { label: "Tensão da Bateria do Veículo", tooltip: "Tensão da bateria do veículo" },
  battery: { label: "Tensão da Bateria Interna do Dispositivo", tooltip: "Tensão da bateria interna do dispositivo" },
  ioDetails: { label: "Entradas/Saídas", tooltip: "Entradas/Saídas" },
  ioSummary: { label: "Entradas/Saídas", tooltip: "Entradas/Saídas" },
  input2: { label: "Entrada Digital 2", tooltip: "Entrada Digital 2" },
  input4: { label: "Entrada Digital 4", tooltip: "Entrada Digital 4" },
  input5: { label: "Entrada Digital 5", tooltip: "Entrada Digital 5" },
  digitalInput2: { label: "Entrada Digital 2", tooltip: "Entrada Digital 2" },
  digitalInput4: { label: "Entrada Digital 4", tooltip: "Entrada Digital 4" },
  digitalInput5: { label: "Entrada Digital 5", tooltip: "Entrada Digital 5" },
  digitalOutput1: { label: "Saída Digital 1", tooltip: "Saída Digital 1" },
  digitalOutput2: { label: "Saída Digital 2", tooltip: "Saída Digital 2" },
  digitalOutput3: { label: "Saída Digital 3", tooltip: "Saída Digital 3" },
  geozoneInside: { label: "Dentro da Geozona", tooltip: "Dentro da Geozona" },
  geozoneId: { label: "Geozona", tooltip: "Geozona" },
  geozoneInsidePrimary: { label: "Dentro de Cerca Eletrônica", tooltip: "Dentro de cerca eletrônica" },
  vehicleState: { label: "Estado do Veículo", tooltip: "Status do veículo (Ligado / Desligado / Parado / Em movimento)" },
  direction: { label: "Direção do Veículo", tooltip: "Direção em graus" },
  motion: { label: "Veículo em movimento", tooltip: "Veículo em movimento (Sim / Não)" },
  distance: { label: "Distância", tooltip: "Distância percorrida no evento" },
  totalDistance: { label: "Distância Total", tooltip: "Distância total acumulada" },
  topSpeed: { label: "Velocidade Máxima do Veículo", tooltip: "Velocidade Máxima do Veículo" },
  satellites: { label: "Número de satélites", tooltip: "Número de satélites" },
  sat: { label: "Número de satélites", tooltip: "Número de satélites" },
  hdop: { label: "Precisão horizontal do GPS", tooltip: "Precisão horizontal do GPS" },
  accuracy: { label: "Precisão do posicionamento", tooltip: "Precisão do posicionamento (em metros)" },
  valid: { label: "GPS com sinal válido", tooltip: "GPS com sinal válido" },
  deviceStatus: { label: "Status Operacional do Dispositivo", tooltip: "Status Operacional do Dispositivo" },
  deviceTemp: { label: "Temperatura do dispositivo", tooltip: "Temperatura do dispositivo" },
  rssi: { label: "Intensidade do Sinal Celular (RSSI em dBm)", tooltip: "Intensidade do Sinal Celular (RSSI em dBm)" },
  status: { label: "Status Operacional do Dispositivo", tooltip: "Status Operacional do Dispositivo" },
  batteryLevel: { label: "Nível da Bateria", tooltip: "Nível da Bateria" },
  event: { label: "Evento", tooltip: "Tipo de evento registrado" },
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
