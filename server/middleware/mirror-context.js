import createError from "http-errors";

import { config } from "../config.js";
import { getClientById } from "../models/client.js";
import { listMirrors } from "../models/mirror.js";
import { resolveMirrorVehicleIds } from "../utils/mirror-scope.js";

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
  const headerValue = req?.get ? req.get("X-Owner-Client-Id") : req?.headers?.["x-owner-client-id"];
  if (headerValue) return String(headerValue);
  const queryClientId = req?.query?.clientId ?? req?.query?.tenantId;
  if (queryClientId !== undefined && queryClientId !== null && queryClientId !== "") {
    return String(queryClientId);
  }
  return null;
}

export async function resolveMirrorContext(req) {
  if (!config.features?.mirrorMode) return null;
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
    return null;
  }

  const mirror = mirrors[0];
  const context = {
    mode: "target",
    ownerClientId: String(ownerClientId),
    targetClientId: String(req.user.clientId),
    mirrorId: String(mirror.id),
    permissionGroupId: mirror.permissionGroupId ?? null,
    vehicleIds: resolveMirrorVehicleIds(mirror),
    vehicleGroupId: mirror.vehicleGroupId ?? null,
  };
  console.info("[mirror] contexto ativo", {
    mirrorModeEnabled: Boolean(config.features?.mirrorMode),
    ownerClientId: context.ownerClientId,
    targetClientId: context.targetClientId,
    vehicleIdsCount: context.vehicleIds.length,
    permissionGroupId: context.permissionGroupId,
  });
  return context;
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
