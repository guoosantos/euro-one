import deviceDiagnosticCatalog from "../../../shared/deviceDiagnosticEventCatalog.pt-BR.json" assert { type: "json" };
import iotmDiagnosticCatalog from "../../../shared/iotmDiagnosticEventCatalog.pt-BR.json" assert { type: "json" };

const LABEL_OVERRIDES = {
  "Interferência GPS": "JAMMER GPS",
  "Interferência GSM": "JAMMER GSM",
};

const normalizeLabel = (label) => {
  if (!label) return "";
  const trimmed = String(label).trim();
  return LABEL_OVERRIDES[trimmed] || trimmed;
};

const toEntries = (catalog = []) =>
  (catalog || [])
    .filter((entry) => entry?.id)
    .map((entry) => [String(entry.id).toLowerCase(), normalizeLabel(entry.labelPt || entry.label || "")]);

export const iotmEventsPtBR = new Map([
  ...toEntries(iotmDiagnosticCatalog),
  ...toEntries(deviceDiagnosticCatalog),
]);

export default iotmEventsPtBR;
