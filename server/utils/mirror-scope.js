import { getGroupById } from "../models/group.js";

export function resolveMirrorContext(req) {
  if (req?.mirrorContext) return req.mirrorContext;
  if (req?.tenant?.mirrorContext) return req.tenant.mirrorContext;
  return null;
}

export function resolveMirrorVehicleIds(mirrorContext) {
  if (!mirrorContext) return [];
  if (Array.isArray(mirrorContext.vehicleIds) && mirrorContext.vehicleIds.length) {
    return mirrorContext.vehicleIds.map(String);
  }
  if (mirrorContext.vehicleGroupId) {
    const group = getGroupById(mirrorContext.vehicleGroupId);
    if (Array.isArray(group?.attributes?.vehicleIds)) {
      return group.attributes.vehicleIds.map(String);
    }
  }
  return [];
}

export function getEffectiveClientId(req) {
  const mirrorContext = resolveMirrorContext(req);
  if (mirrorContext?.mode === "target" && mirrorContext.ownerClientId) {
    return String(mirrorContext.ownerClientId);
  }
  if (req?.tenant?.clientIdResolved) return String(req.tenant.clientIdResolved);
  if (req?.clientId) return String(req.clientId);
  if (req?.user?.clientId) return String(req.user.clientId);
  return null;
}

export function getEffectiveVehicleIds(req) {
  const mirrorContext = resolveMirrorContext(req);
  if (!mirrorContext) return null;
  return resolveMirrorVehicleIds(mirrorContext);
}

export default {
  getEffectiveClientId,
  getEffectiveVehicleIds,
  resolveMirrorContext,
  resolveMirrorVehicleIds,
};
