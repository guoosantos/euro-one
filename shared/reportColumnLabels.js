const REPORT_COLUMN_LABEL_OVERRIDES = {
  driverseatbelt: "CAN - Cinto do Motorista",
  passengerseatbelt: "CAN - Cinto do Passageiro",
  engineworking: "CAN - Motor",
  lowbeam: "CAN - Farol",
  highbeam: "CAN - Farol Alto",
  fuelused: "CAN - Uso do Combustível",
  fuelusedhighres: "CAN - Uso do Combustível",
  sensor_dtc: "CAN - Códigos de Falha do Veículo",
  sensor_dtc_captured: "CAN - Códigos de Falha do Veículo",
  portafl: "CAN - Porta Motorista",
  portarl: "CAN - Porta Passageiro",
  "cinto do motorista": "CAN - Cinto do Motorista",
  "cinto do passageiro": "CAN - Cinto do Passageiro",
  "códigos de falha do veículo": "CAN - Códigos de Falha do Veículo",
  "códigos de falha do veículo dtc": "CAN - Códigos de Falha do Veículo",
  farol: "CAN - Farol",
  "farol alto": "CAN - Farol Alto",
  motor: "CAN - Motor",
  "porta motorista": "CAN - Porta Motorista",
  "porta passageiro": "CAN - Porta Passageiro",
};

function normalizeLabelKey(value) {
  return String(value || "").trim().toLowerCase();
}

export function resolveReportColumnLabelOverride(key, fallbackLabel) {
  const normalizedKey = normalizeLabelKey(key);
  const normalizedLabel = normalizeLabelKey(fallbackLabel);
  return (
    REPORT_COLUMN_LABEL_OVERRIDES[normalizedKey] ||
    REPORT_COLUMN_LABEL_OVERRIDES[normalizedLabel] ||
    null
  );
}
