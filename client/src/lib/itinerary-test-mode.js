import { isDisembarkedStatus, translateItineraryStatusLabel } from "./itinerary-status.js";

const normalizeText = (value) => String(value ?? "").trim();

export function buildTestModeBannerData({
  enabled = false,
  itineraryName,
  plate,
  status,
  hasConfirmedEmbarked = false,
  isDisembarked = false,
  labels = {},
} = {}) {
  if (!enabled) return null;
  const {
    headline = "MODO TESTE",
    lastItineraryLabel = "Último itinerário",
    itineraryLabel = "Itinerário",
    plateLabel = "Placa",
    statusLabel = "Status",
    disembarkedMessage = "Itinerário desembarcado (por isso a rota não aparece automaticamente)",
  } = labels;
  const safeName = normalizeText(itineraryName) || "—";
  const safePlate = normalizeText(plate) || "—";
  const translatedStatus = translateItineraryStatusLabel(status, { style: "upper", fallback: "—" });

  const hasDisembarkedStatus = isDisembarked || isDisembarkedStatus(status);

  if (hasDisembarkedStatus) {
    return {
      kind: "disembarked",
      headline,
      message: disembarkedMessage,
      itineraryName: safeName,
      plate: safePlate,
      statusLabel: translatedStatus,
      statusTone: "muted",
    };
  }

  if (!hasConfirmedEmbarked) {
    return {
      kind: "last",
      headline,
      itineraryName: safeName,
      itineraryLabel: lastItineraryLabel,
      plate: safePlate,
      plateLabel,
      statusLabel: translatedStatus,
      statusLabelPrefix: statusLabel,
      statusTone: "danger",
    };
  }

  return {
    kind: "confirmed",
    headline,
    itineraryName: safeName,
    itineraryLabel,
    plate: safePlate,
    plateLabel,
    statusLabel: translatedStatus,
    statusLabelPrefix: statusLabel,
    statusTone: "confirmed",
  };
}

export function shouldAutoShowTestModeOverlay({
  enabled = false,
  hasConfirmedEmbarked = false,
  isDisembarked = false,
  hasOverlay = false,
} = {}) {
  if (!enabled) return false;
  if (!hasOverlay) return false;
  if (hasConfirmedEmbarked) return false;
  if (isDisembarked) return false;
  return true;
}
