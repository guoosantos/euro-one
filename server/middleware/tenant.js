import createError from "http-errors";

import { config } from "../config.js";
import { listDevices } from "../models/device.js";
import { getGroupById } from "../models/group.js";
import { listMirrors } from "../models/mirror.js";
import { listVehicles } from "../models/vehicle.js";

function pickRequestedClientId(req, providedClientId) {
  if (providedClientId !== undefined && providedClientId !== null && providedClientId !== "") {
    return String(providedClientId);
  }
  const queryClientId = req?.query?.clientId ?? req?.query?.tenantId;
  if (queryClientId !== undefined && queryClientId !== null && queryClientId !== "") {
    return String(queryClientId);
  }
  const headerValue = req?.get ? req.get("X-Client-Id") : req?.headers?.["x-client-id"];
  if (headerValue) return String(headerValue);
  const ownerHeader = req?.get ? req.get("X-Owner-Client-Id") : req?.headers?.["x-owner-client-id"];
  if (ownerHeader) return String(ownerHeader);
  const bodyClientId = req?.body?.clientId;
  if (bodyClientId !== undefined && bodyClientId !== null && bodyClientId !== "") {
    return String(bodyClientId);
  }
  return null;
}

export function resolveExplicitClientIds(user) {
  if (!user) return [];
  const candidates = [];
  if (Array.isArray(user.clients)) {
    candidates.push(...user.clients);
  }
  if (Array.isArray(user.attributes?.clients)) {
    candidates.push(...user.attributes.clients);
  }
  if (Array.isArray(user.attributes?.clientIds)) {
    candidates.push(...user.attributes.clientIds);
  }
  if (Array.isArray(user.attributes?.clientScopeIds)) {
    candidates.push(...user.attributes.clientScopeIds);
  }
  if (Array.isArray(user.attributes?.tenantIds)) {
    candidates.push(...user.attributes.tenantIds);
  }
  if (Array.isArray(user.attributes?.tenants)) {
    candidates.push(...user.attributes.tenants);
  }
  return candidates
    .map((item) => (item && typeof item === "object" ? item.id || item.clientId || item.tenantId : item))
    .filter(Boolean)
    .map((value) => String(value));
}

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

function resolveMirrorVehicleIds(mirror) {
  if (!mirror) return [];
  if (mirror.vehicleGroupId) {
    const group = getGroupById(mirror.vehicleGroupId);
    if (Array.isArray(group?.attributes?.vehicleIds)) {
      return group.attributes.vehicleIds.map(String);
    }
  }
  return Array.isArray(mirror.vehicleIds) ? mirror.vehicleIds.map(String) : [];
}

function resolveMirrorContext({ user, ownerClientId }) {
  if (!config.features?.mirrorMode) return null;
  if (!user?.clientId || !ownerClientId) return null;
  if (String(ownerClientId) === String(user.clientId)) return null;

  const mirrors = listMirrors({ ownerClientId, targetClientId: user.clientId }).filter((mirror) =>
    isMirrorActive(mirror),
  );
  if (!mirrors.length) return null;
  const mirror = mirrors[0];
  const vehicleIds = resolveMirrorVehicleIds(mirror);
  const vehicles = listVehicles({ clientId: ownerClientId });
  const allowedVehicleIds = new Set(vehicleIds.map(String));
  const allowedVehicles = vehicles.filter((vehicle) => allowedVehicleIds.has(String(vehicle.id)));
  const devices = listDevices({ clientId: ownerClientId });
  const deviceIds = devices
    .filter((device) => device?.vehicleId && allowedVehicleIds.has(String(device.vehicleId)))
    .map((device) => String(device.id));

  return {
    ownerClientId: String(ownerClientId),
    targetClientId: String(user.clientId),
    mirrorId: String(mirror.id),
    permissionGroupId: mirror.permissionGroupId ?? null,
    vehicleIds: allowedVehicles.map((vehicle) => String(vehicle.id)),
    vehicleGroupId: mirror.vehicleGroupId ?? null,
    deviceIds,
  };
}

function logDeniedAccess({ user, requestedClientId, reason }) {
  console.warn("[tenant] acesso negado", {
    userId: user?.id ? String(user.id) : null,
    userClientId: user?.clientId ? String(user.clientId) : null,
    requestedClientId: requestedClientId ? String(requestedClientId) : null,
    reason,
  });
}

export function resolveTenant(req, { requestedClientId, required = true } = {}) {
  if (!req?.user) {
    throw createError(401, "Sessão não autenticada");
  }

  const user = req.user;
  const resolvedRequested = pickRequestedClientId(req, requestedClientId);
  const existingMirror = req.mirrorContext;
  if (existingMirror && (!resolvedRequested || String(existingMirror.ownerClientId) === String(resolvedRequested))) {
    const tenant = {
      requestedClientId: resolvedRequested,
      clientIdResolved: String(existingMirror.ownerClientId),
      mirrorContext: existingMirror,
      accessType: "mirror",
    };
    req.tenant = tenant;
    req.clientId = tenant.clientIdResolved;
    req.mirrorContext = existingMirror;
    return tenant;
  }

  if (user.role === "admin") {
    const adminClientId = resolvedRequested || (required ? user.clientId : user.clientId) || null;
    if (required && !adminClientId) {
      logDeniedAccess({ user, requestedClientId: resolvedRequested, reason: "admin-missing-client" });
      throw createError(401, "clientId é obrigatório");
    }
    const tenant = {
      requestedClientId: resolvedRequested,
      clientIdResolved: adminClientId ? String(adminClientId) : null,
      mirrorContext: null,
      accessType: "admin",
    };
    req.tenant = tenant;
    req.clientId = tenant.clientIdResolved;
    req.mirrorContext = null;
    return tenant;
  }

  if (!user.clientId) {
    logDeniedAccess({ user, requestedClientId: resolvedRequested, reason: "missing-tenant" });
    throw createError(401, "Usuário sem tenant associado");
  }

  const userClientId = String(user.clientId);
  if (!resolvedRequested || String(resolvedRequested) === userClientId) {
    const tenant = {
      requestedClientId: resolvedRequested,
      clientIdResolved: userClientId,
      mirrorContext: null,
      accessType: "self",
    };
    req.tenant = tenant;
    req.clientId = userClientId;
    req.mirrorContext = null;
    return tenant;
  }

  const explicitClientIds = resolveExplicitClientIds(user);
  if (explicitClientIds.some((id) => String(id) === String(resolvedRequested))) {
    const tenant = {
      requestedClientId: resolvedRequested,
      clientIdResolved: String(resolvedRequested),
      mirrorContext: null,
      accessType: "linked",
    };
    req.tenant = tenant;
    req.clientId = tenant.clientIdResolved;
    req.mirrorContext = null;
    return tenant;
  }

  const mirrorContext = resolveMirrorContext({ user, ownerClientId: resolvedRequested });
  if (mirrorContext) {
    const tenant = {
      requestedClientId: resolvedRequested,
      clientIdResolved: mirrorContext.ownerClientId,
      mirrorContext,
      accessType: "mirror",
    };
    req.tenant = tenant;
    req.clientId = tenant.clientIdResolved;
    req.mirrorContext = mirrorContext;
    return tenant;
  }

  const reason = explicitClientIds.length ? "not-linked" : "no-mirror-found";
  logDeniedAccess({ user, requestedClientId: resolvedRequested, reason });
  throw createError(403, "Sem acesso");
}

export function resolveTenantMiddleware({ required = false } = {}) {
  return (req, _res, next) => {
    try {
      resolveTenant(req, { required });
      return next();
    } catch (error) {
      return next(error);
    }
  };
}

export default resolveTenant;
