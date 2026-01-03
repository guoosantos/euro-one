export const positionsColumns = [
  { key: "gpsTime", labelPt: "Hora GPS", labelPdf: "Hora GPS", width: 140, defaultVisible: true, weight: 1.4 },
  { key: "deviceTime", labelPt: "Hora do Dispositivo", labelPdf: "Hora do Dispositivo", width: 140, defaultVisible: false, weight: 1.4 },
  { key: "serverTime", labelPt: "Hora do Servidor", labelPdf: "Hora do Servidor", width: 140, defaultVisible: false, weight: 1.4 },
  { key: "latitude", labelPt: "Latitude", labelPdf: "Latitude", width: 110, defaultVisible: false, weight: 1 },
  { key: "longitude", labelPt: "Longitude", labelPdf: "Longitude", width: 110, defaultVisible: false, weight: 1 },
  { key: "address", labelPt: "Endereço", labelPdf: "Endereço", width: 260, defaultVisible: true, weight: 2.6 },
  { key: "speed", labelPt: "Velocidade", labelPdf: "Velocidade", width: 90, defaultVisible: true, weight: 0.9 },
  { key: "direction", labelPt: "Direção", labelPdf: "Direção", width: 90, defaultVisible: false, weight: 0.9 },
  { key: "ignition", labelPt: "Ignição", labelPdf: "Ignição", width: 90, defaultVisible: true, weight: 0.9 },
  { key: "vehicleState", labelPt: "Estado do Veículo", labelPdf: "Estado do Veículo", width: 140, defaultVisible: true, weight: 1.4 },
  { key: "batteryLevel", labelPt: "Bateria", labelPdf: "Bateria", width: 110, defaultVisible: false, weight: 1.1 },
  { key: "rssi", labelPt: "RSSI", labelPdf: "RSSI", width: 80, defaultVisible: false, weight: 0.8 },
  { key: "satellites", labelPt: "Satélites", labelPdf: "Satélites", width: 90, defaultVisible: false, weight: 0.9 },
  { key: "geofence", labelPt: "Cerca Virtual", labelPdf: "Cerca Virtual", width: 140, defaultVisible: false, weight: 1.2 },
  { key: "accuracy", labelPt: "Precisão", labelPdf: "Precisão", width: 90, defaultVisible: false, weight: 0.9 },
  { key: "commandResponse", labelPt: "Resposta do Comando", labelPdf: "Resposta do Comando", width: 220, defaultVisible: true, weight: 2.2 },
  {
    key: "deviceStatus",
    labelPt: "Status do Equipamento",
    labelPdf: "Status do Equipamento",
    width: 180,
    defaultVisible: true,
    weight: 1.6,
  },
  {
    key: "deviceStatusEvent",
    labelPt: "Transição de Status",
    labelPdf: "Transição de Status",
    width: 200,
    defaultVisible: true,
    weight: 1.8,
  },
];

export const positionsColumnMap = new Map(positionsColumns.map((column) => [column.key, column]));

export function resolveColumnLabel(column, variant = "pt") {
  if (!column) return "[SEM TRADUÇÃO]";
  const label = variant === "pdf" ? column.labelPdf : column.labelPt;
  return label || `[SEM TRADUÇÃO] ${column.key}`;
}
