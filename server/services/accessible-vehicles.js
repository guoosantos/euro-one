import { getClientById } from "../models/client.js";
import { listMirrors } from "../models/mirror.js";
import { listVehicles } from "../models/vehicle.js";

const RECEIVER_TYPES = new Set([
  "GERENCIADORA",
  "SEGURADORA",
  "GERENCIADORA DE RISCO",
  "COMPANHIA DE SEGURO",
]);

function isMirrorActive(mirror, now = new Date()) {
  if (!mirror) return false;
  const start = mirror.startAt ? new Date(mirror.startAt) : null;
  const end = mirror.endAt ? new Date(mirror.endAt) : null;
  if (start && Number.isNaN(start.getTime())) return false;
  if (end && Number.isNaN(end.getTime())) return false;
  if (start && now < start) return false;
  if (end && now > end) return false;
  return true;
}

function mergeById(primary = [], secondary = []) {
  const map = new Map(primary.map((item) => [String(item.id), item]));
  secondary.forEach((item) => {
    const key = String(item.id);
    if (!map.has(key)) {
      map.set(key, item);
    }
  });
  return Array.from(map.values());
}

export async function getAccessibleVehicles({
  user,
  clientId,
  includeMirrorsForNonReceivers = true,
} = {}) {
  const resolvedClientId = clientId ?? user?.clientId ?? null;
  const isAdmin = user?.role === "admin";
  let vehicles = listVehicles(resolvedClientId ? { clientId: resolvedClientId } : {});
  let mirrorOwnerIds = [];
  let isReceiver = false;
  let hasMirrors = false;

  if (!isAdmin && user?.clientId) {
    const client = await getClientById(user.clientId).catch(() => null);
    const clientType = client?.attributes?.clientProfile?.clientType || client?.attributes?.clientType || "";
    isReceiver = RECEIVER_TYPES.has(String(clientType).toUpperCase());

    const mirrors = listMirrors({ targetClientId: user.clientId }).filter((mirror) => isMirrorActive(mirror));
    hasMirrors = mirrors.length > 0;
    if (mirrors.length) {
      mirrorOwnerIds = mirrors.map((mirror) => mirror.ownerClientId).filter(Boolean);
      const mirroredVehicles = mirrors.flatMap((mirror) => {
        const ownerVehicles = listVehicles({ clientId: mirror.ownerClientId });
        const allowedIds = new Set((mirror.vehicleIds || []).map(String));
        return ownerVehicles.filter((vehicle) => allowedIds.has(String(vehicle.id)));
      });
      if (isReceiver) {
        vehicles = mirroredVehicles;
      } else if (includeMirrorsForNonReceivers) {
        vehicles = mergeById(vehicles, mirroredVehicles);
      }
    } else if (isReceiver) {
      vehicles = [];
    }
  }

  return { vehicles, mirrorOwnerIds, isReceiver, hasMirrors, clientId: resolvedClientId };
}

export default getAccessibleVehicles;
