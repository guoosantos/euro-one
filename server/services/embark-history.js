import { listDeployments, toHistoryEntries } from "../models/xdm-deployment.js";
import { listItineraries } from "../models/itinerary.js";
import { getVehicleById } from "../models/vehicle.js";

function normalizePipelineStatusLabel(label) {
  const normalized = String(label || "").toUpperCase().trim();
  if (!normalized) return null;
  if (normalized.includes("CONCLU")) return "CONCLUÍDO";
  if (normalized.includes("EMBARC")) return "EMBARCADO";
  if (normalized.includes("ENVIAD")) return "ENVIADO";
  if (normalized.includes("PEND")) return "PENDENTE";
  if (normalized.includes("FALHOU") && normalized.includes("ENVIO")) return "FALHOU (ENVIO)";
  if (normalized.includes("FALHOU") && normalized.includes("APLIC")) return "FALHOU (EQUIPAMENTO)";
  if (normalized.includes("FALHOU") && normalized.includes("EQUIP")) return "FALHOU (EQUIPAMENTO)";
  if (normalized.includes("FALHOU")) return "FALHOU (EQUIPAMENTO)";
  return normalized;
}

function resolveStatusLabel(status, preferredLabel = null) {
  const normalizedPreferred = normalizePipelineStatusLabel(preferredLabel);
  if (normalizedPreferred) return normalizedPreferred;
  const normalized = String(status || "").toUpperCase();
  if (["APPLIED", "EMBARKED", "CONFIRMED", "CONCLUDED"].includes(normalized)) return "CONCLUÍDO";
  if (["QUEUED"].includes(normalized)) return "ENVIADO";
  if (["DEPLOYING", "SYNCING", "STARTED", "RUNNING"].includes(normalized)) return "PENDENTE";
  if (["FAILED", "TIMEOUT"].includes(normalized)) return "FALHOU (EQUIPAMENTO)";
  if (["ERROR", "INVALID", "REJECTED"].includes(normalized)) return "FALHOU (ENVIO)";
  if (["DEPLOYED", "CLEARED"].includes(normalized)) return "PENDENTE";
  return "PENDENTE";
}

export function resolveActionLabel(action) {
  const normalizedAction = String(action || "EMBARK").toUpperCase();
  if (normalizedAction === "DISEMBARK") {
    return "Desembarcado itinerário (remover da configuração do equipamento)";
  }
  if (normalizedAction === "CREATE") return "Criado itinerário";
  if (normalizedAction === "UPDATE") return "Atualizado itinerário";
  if (normalizedAction === "DELETE") return "Excluído itinerário";
  return "Embarcado itinerário";
}

function resolveHistoryMessage(entry) {
  const itineraryName = entry.itineraryName || "itinerário";
  const vehicleLabel = entry.plate || entry.vehicleName || "veículo";
  const actionLabel = resolveActionLabel(entry.action);
  const statusLabel = resolveStatusLabel(entry.statusCode || entry.status, entry.statusLabel);
  if (statusLabel === "ERRO") {
    return `Não foi possível concluir "${actionLabel}" para o itinerário ${itineraryName} no veículo ${vehicleLabel}.`;
  }
  if (statusLabel.startsWith("FALHOU")) {
    return `Falha ao executar "${actionLabel}" para o itinerário ${itineraryName} no veículo ${vehicleLabel}.`;
  }
  if (statusLabel === "ENVIADO") {
    return `Itinerário ${itineraryName} enviado para a central do veículo ${vehicleLabel}.`;
  }
  if (statusLabel === "PENDENTE") {
    return `Central confirmou o itinerário ${itineraryName} para o veículo ${vehicleLabel} e aguarda atualização do equipamento.`;
  }
  if (actionLabel.startsWith("Embarcado")) {
    return `Itinerário ${itineraryName} embarcado no veículo ${vehicleLabel}.`;
  }
  if (actionLabel.startsWith("Desembarcado")) {
    return `Itinerário ${itineraryName} desembarcado do veículo ${vehicleLabel} (removido do equipamento).`;
  }
  if (actionLabel.startsWith("Atualizado")) {
    return `Itinerário ${itineraryName} atualizado e reenviado para o veículo ${vehicleLabel}.`;
  }
  if (actionLabel.startsWith("Criado")) {
    return `Itinerário ${itineraryName} criado.`;
  }
  if (actionLabel.startsWith("Excluído")) {
    return `Itinerário ${itineraryName} excluído.`;
  }
  return `Ação "${actionLabel}" registrada para o itinerário ${itineraryName}.`;
}

export function normalizeHistoryEntry(entry) {
  const statusCode = entry.statusCode || entry.status || "SYNCING";
  const statusLabel = resolveStatusLabel(statusCode, entry.statusLabel);
  const actionLabel = resolveActionLabel(entry.action);
  const details = entry.details || entry.result || null;
  const message = entry.message || resolveHistoryMessage({ ...entry, statusCode, statusLabel });
  const deviceConfirmedAt = entry.deviceConfirmedAt || entry.receivedAtDevice || null;
  return {
    ...entry,
    statusCode,
    statusLabel,
    actionLabel,
    message,
    details,
    deviceConfirmedAt,
  };
}

function resolveRangeTimestamp(entry) {
  return entry.sentAt || entry.at || entry.deviceConfirmedAt || entry.receivedAt || entry.timestamp || null;
}

function isWithinRange(entry, { from, to } = {}) {
  if (!from && !to) return true;
  const timestamp = resolveRangeTimestamp(entry);
  if (!timestamp) return false;
  const time = new Date(timestamp).getTime();
  if (Number.isNaN(time)) return false;
  const fromTime = from ? new Date(from).getTime() : null;
  const toTime = to ? new Date(to).getTime() : null;
  if (fromTime !== null && Number.isFinite(fromTime) && time < fromTime) return false;
  if (toTime !== null && Number.isFinite(toTime) && time > toTime) return false;
  return true;
}

export function listVehicleEmbarkHistory({ vehicleId, clientId, vehicle = null, from, to } = {}) {
  const resolvedVehicle = vehicle || (vehicleId ? getVehicleById(vehicleId) : null);
  if (!resolvedVehicle) return [];

  const resolvedClientId = clientId ?? resolvedVehicle.clientId ?? null;
  const deployments = listDeployments(resolvedClientId ? { clientId: resolvedClientId } : {}).filter(
    (deployment) => String(deployment.vehicleId) === String(resolvedVehicle.id),
  );
  const vehiclesById = new Map([[String(resolvedVehicle.id), resolvedVehicle]]);
  const itinerariesById = listItineraries(resolvedClientId ? { clientId: resolvedClientId } : {}).reduce(
    (acc, itinerary) => {
      acc.set(String(itinerary.id), itinerary);
      return acc;
    },
    new Map(),
  );

  return toHistoryEntries({ deploymentsList: deployments, vehiclesById, itinerariesById })
    .map(normalizeHistoryEntry)
    .filter((entry) => isWithinRange(entry, { from, to }));
}
