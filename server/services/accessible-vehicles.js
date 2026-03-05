import { config } from "../config.js";
import { getClientById } from "../models/client.js";
import { listMirrors } from "../models/mirror.js";
import { listVehicles } from "../models/vehicle.js";
import { listGroups } from "../models/group.js";
import { resolveMirrorVehicleIds } from "../utils/mirror-scope.js";

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

function resolveGroupType(group) {
  const raw = group?.attributes?.groupType || group?.attributes?.type || "CUSTOM";
  return String(raw).trim().toUpperCase() === "BY_CLIENT" ? "BY_CLIENT" : "CUSTOM";
}

function resolveGroupSourceClientId(group) {
  return group?.attributes?.sourceClientId || group?.attributes?.clientId || null;
}

function normalizeIdList(list = []) {
  if (!Array.isArray(list)) return [];
  return list.map((item) => String(item)).filter(Boolean);
}

function resolveVehicleGroupIds(userAccess) {
  if (!userAccess) return [];
  const groupIds = Array.isArray(userAccess.vehicleGroupIds)
    ? userAccess.vehicleGroupIds
    : userAccess.vehicleGroupId
      ? [userAccess.vehicleGroupId]
      : [];
  return normalizeIdList(groupIds);
}

function resolveAllowedVehicleIds({ vehicles, user, isReceiver }) {
  if (!user || user.role === "admin") return null;
  const userAccess = user.attributes?.userAccess || {};
  const accessMode = userAccess.vehicleAccess?.mode || (isReceiver ? "selected" : "all");
  if (accessMode === "all") return null;

  const allowedIds = new Set(normalizeIdList(userAccess.vehicleAccess?.vehicleIds || []));
  const groupIds = resolveVehicleGroupIds(userAccess);
  if (groupIds.length) {
    const clientId = user.clientId || null;
    const groups = listGroups({ clientId });
    const groupMap = new Map(groups.map((group) => [String(group.id), group]));
    groupIds.forEach((groupId) => {
      const group = groupMap.get(String(groupId));
      if (!group || group.attributes?.kind !== "VEHICLE_GROUP") return;
      const groupType = resolveGroupType(group);
      if (groupType === "BY_CLIENT") {
        const sourceClientId = resolveGroupSourceClientId(group);
        if (!sourceClientId) return;
        vehicles
          .filter((vehicle) => String(vehicle.clientId) === String(sourceClientId))
          .forEach((vehicle) => allowedIds.add(String(vehicle.id)));
      } else {
        normalizeIdList(group.attributes?.vehicleIds || []).forEach((id) => allowedIds.add(String(id)));
      }
    });
  }
  return allowedIds;
}

export async function getAccessibleVehicles({
  user,
  clientId,
  includeMirrorsForNonReceivers = true,
  mirrorContext = null,
} = {}) {
  const isAdminAll = user?.role === "admin" && clientId === null;
  const resolvedClientId = isAdminAll ? null : clientId ?? user?.clientId ?? null;
  if (config.features?.mirrorMode && mirrorContext?.ownerClientId) {
    if (String(mirrorContext.ownerClientId) === "all") {
      const allowedIds = new Set(resolveMirrorVehicleIds(mirrorContext));
      const ownerIds = Array.isArray(mirrorContext.ownerClientIds) ? mirrorContext.ownerClientIds : [];
      const mirroredVehicles = ownerIds.flatMap((ownerId) => {
        const ownerVehicles = listVehicles({ clientId: ownerId });
        return ownerVehicles.filter((vehicle) => allowedIds.has(String(vehicle.id)));
      });
      const userAllowedIds = resolveAllowedVehicleIds({
        vehicles: mirroredVehicles,
        user,
        isReceiver: true,
      });
      const scopedVehicles = userAllowedIds
        ? mirroredVehicles.filter((vehicle) => userAllowedIds.has(String(vehicle.id)))
        : mirroredVehicles;
      return {
        vehicles: scopedVehicles,
        mirrorOwnerIds: ownerIds,
        isReceiver: true,
        hasMirrors: true,
        clientId: resolvedClientId,
      };
    }
    const allowedIds = new Set(resolveMirrorVehicleIds(mirrorContext));
    const ownerVehicles = listVehicles({ clientId: mirrorContext.ownerClientId });
    const mirroredVehicles = ownerVehicles.filter((vehicle) => allowedIds.has(String(vehicle.id)));
    const userAllowedIds = resolveAllowedVehicleIds({
      vehicles: mirroredVehicles,
      user,
      isReceiver: true,
    });
    const scopedVehicles = userAllowedIds
      ? mirroredVehicles.filter((vehicle) => userAllowedIds.has(String(vehicle.id)))
      : mirroredVehicles;
    return {
      vehicles: scopedVehicles,
      mirrorOwnerIds: [mirrorContext.ownerClientId],
      isReceiver: true,
      hasMirrors: true,
      clientId: mirrorContext.ownerClientId,
    };
  }
  let vehicles = listVehicles(resolvedClientId ? { clientId: resolvedClientId } : {});
  let mirrorOwnerIds = [];
  let isReceiver = false;
  let hasMirrors = false;

  if (user?.clientId) {
    const client = await getClientById(user.clientId).catch(() => null);
    const clientType = client?.attributes?.clientProfile?.clientType || client?.attributes?.clientType || "";
    isReceiver = RECEIVER_TYPES.has(String(clientType).toUpperCase());

    if (config.features?.mirrorMode) {
      const mirrors = listMirrors({ targetClientId: user.clientId }).filter((mirror) => isMirrorActive(mirror));
      hasMirrors = mirrors.length > 0;
      if (mirrors.length) {
        mirrorOwnerIds = mirrors.map((mirror) => mirror.ownerClientId).filter(Boolean);
        const mirroredVehicles = mirrors.flatMap((mirror) => {
          const ownerVehicles = listVehicles({ clientId: mirror.ownerClientId });
          const allowedIds = new Set(resolveMirrorVehicleIds(mirror));
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
  }

  const userAllowedIds = resolveAllowedVehicleIds({
    vehicles,
    user,
    isReceiver,
  });
  const scopedVehicles = userAllowedIds
    ? vehicles.filter((vehicle) => userAllowedIds.has(String(vehicle.id)))
    : vehicles;

  return { vehicles: scopedVehicles, mirrorOwnerIds, isReceiver, hasMirrors, clientId: resolvedClientId };
}

export default getAccessibleVehicles;
