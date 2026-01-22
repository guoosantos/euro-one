import createError from "http-errors";

import { getClientById } from "../models/client.js";
import { getGroupById } from "../models/group.js";
import { listMirrors } from "../models/mirror.js";

const RECEIVER_TYPES = new Set([
  "GERENCIADORA",
  "SEGURADORA",
  "GERENCIADORA DE RISCO",
  "COMPANHIA DE SEGURO",
  "COMPANHIA DE SEGUROS",
]);

function resolveClientType(client) {
  return client?.attributes?.clientProfile?.clientType || client?.attributes?.clientType || "";
}

function isReceiverType(clientType) {
  return RECEIVER_TYPES.has(String(clientType || "").toUpperCase());
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

function resolveOwnerClientId(req) {
  const queryClientId = req?.query?.clientId ?? req?.query?.tenantId;
  if (queryClientId !== undefined && queryClientId !== null && queryClientId !== "") {
    return String(queryClientId);
  }
  const headerValue = req?.get ? req.get("X-Owner-Client-Id") : req?.headers?.["x-owner-client-id"];
  if (headerValue) return String(headerValue);
  return null;
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

export async function resolveMirrorContext(req) {
  if (!req?.user || req.user.role === "admin") return null;

  const ownerClientId = resolveOwnerClientId(req);
  if (!ownerClientId) return null;

  if (!req.user.clientId) {
    throw createError(401, "Usuário sem tenant associado");
  }

  if (String(ownerClientId) === String(req.user.clientId)) {
    return null;
  }

  const client = await getClientById(req.user.clientId).catch(() => null);
  const clientType = resolveClientType(client);
  if (!isReceiverType(clientType)) {
    return null;
  }

  const mirrors = listMirrors({ ownerClientId, targetClientId: req.user.clientId }).filter((mirror) =>
    isMirrorActive(mirror),
  );
  if (!mirrors.length) {
    throw createError(403, "Espelhamento não autorizado para este cliente");
  }

  const mirror = mirrors[0];
  return {
    ownerClientId: String(ownerClientId),
    targetClientId: String(req.user.clientId),
    mirrorId: String(mirror.id),
    permissionGroupId: mirror.permissionGroupId ?? null,
    vehicleIds: resolveMirrorVehicleIds(mirror),
    vehicleGroupId: mirror.vehicleGroupId ?? null,
  };
}

export async function mirrorContextMiddleware(req, _res, next) {
  try {
    const context = await resolveMirrorContext(req);
    if (context) {
      req.mirrorContext = context;
      req.clientId = context.ownerClientId;
    }
    next();
  } catch (error) {
    next(error);
  }
}

export default mirrorContextMiddleware;
