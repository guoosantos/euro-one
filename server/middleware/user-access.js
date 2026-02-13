import createError from "http-errors";

import { getClientById } from "../models/client.js";
import { ACCESS_REASONS } from "../utils/access-reasons.js";

function resolveRequestIp(req) {
  const forwarded = req.headers?.["x-forwarded-for"];
  if (forwarded) {
    const forwardedIp = String(forwarded).split(",")[0]?.trim();
    if (forwardedIp) return forwardedIp;
  }
  return req.ip || req.connection?.remoteAddress || "";
}

function toMinutes(time) {
  if (!time || typeof time !== "string") return null;
  const [hours, minutes] = time.split(":").map((value) => Number(value));
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  return hours * 60 + minutes;
}

function isWithinSchedule(schedule) {
  if (!schedule) return true;
  const now = new Date();
  const day = now.getDay();
  if (Array.isArray(schedule.days) && schedule.days.length) {
    if (!schedule.days.includes(day)) return false;
  }
  const startMinutes = toMinutes(schedule.start);
  const endMinutes = toMinutes(schedule.end);
  if (startMinutes == null || endMinutes == null) return true;
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  return currentMinutes >= startMinutes && currentMinutes <= endMinutes;
}

const BLOCKED_STATUS_TOKENS = new Set([
  "blocked",
  "bloqueado",
  "inativo",
  "inactive",
  "disabled",
  "suspended",
  "suspenso",
]);
const ACTIVE_STATUS_TOKENS = new Set([
  "active",
  "ativo",
  "enabled",
  "habilitado",
]);

function normalizeStatusToken(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === "boolean") return value ? "active" : "blocked";
  if (typeof value === "number") return value > 0 ? "active" : "blocked";
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (BLOCKED_STATUS_TOKENS.has(normalized)) return "blocked";
    if (ACTIVE_STATUS_TOKENS.has(normalized)) return "active";
  }
  return null;
}

function parseDate(value) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

function isExpired(value) {
  const parsed = parseDate(value);
  if (!parsed) return false;
  return parsed.getTime() < Date.now();
}

function resolveUserAccessReason(user) {
  if (!user) return null;
  const attrs = user.attributes || {};
  const blockedFlag =
    attrs.blocked ??
    attrs.isBlocked ??
    attrs.userBlocked ??
    attrs.accountBlocked ??
    null;
  if (blockedFlag === true) return ACCESS_REASONS.USER_BLOCKED;

  const statusToken = normalizeStatusToken(
    attrs.status ??
      attrs.active ??
      attrs.enabled ??
      attrs.isActive ??
      attrs.isEnabled ??
      attrs.accountStatus ??
      null,
  );
  if (statusToken === "blocked") return ACCESS_REASONS.USER_BLOCKED;

  const expiryCandidates = [
    attrs.expiresAt,
    attrs.expireAt,
    attrs.expirationDate,
    attrs.validUntil,
    attrs.accessExpiresAt,
    attrs.accessValidUntil,
    attrs?.userAccess?.expiresAt,
    attrs?.userAccess?.expirationDate,
  ];
  if (expiryCandidates.some((candidate) => isExpired(candidate))) {
    return ACCESS_REASONS.ACCESS_EXPIRED;
  }

  return null;
}

function resolveTenantAccessReason(client) {
  if (!client) return null;
  const attrs = client.attributes || {};
  const blockedFlag =
    attrs.blocked ??
    attrs.disabled ??
    attrs.inactive ??
    attrs.tenantBlocked ??
    attrs.tenantDisabled ??
    null;
  if (blockedFlag === true) return ACCESS_REASONS.TENANT_DISABLED;

  const statusToken = normalizeStatusToken(
    attrs.status ??
      attrs.active ??
      attrs.enabled ??
      attrs.isActive ??
      attrs.isEnabled ??
      attrs.tenantStatus ??
      null,
  );
  if (statusToken === "blocked") return ACCESS_REASONS.TENANT_DISABLED;

  return null;
}

async function resolveTenantReason(req) {
  const clientId = req?.clientId ?? req?.tenant?.clientIdResolved ?? null;
  if (!clientId) return null;
  const client = await getClientById(clientId).catch(() => null);
  if (!client) return null;
  return resolveTenantAccessReason(client);
}

export async function enforceUserAccess(req) {
  const user = req.user;
  if (!user) return;
  const userReason = resolveUserAccessReason(user);
  if (userReason) {
    const message = userReason === ACCESS_REASONS.ACCESS_EXPIRED ? "Acesso expirado" : "Usuário bloqueado";
    throw createError(403, message, { reason: userReason });
  }

  const tenantReason = await resolveTenantReason(req);
  if (tenantReason) {
    throw createError(403, "Tenant desativado ou bloqueado", { reason: tenantReason });
  }

  if (user.role === "admin") return;
  const access = user.attributes?.userAccess || {};

  const ipRestriction = access.ipRestriction;
  if (ipRestriction?.mode === "single" && ipRestriction.ip) {
    const requestIp = resolveRequestIp(req);
    if (requestIp && String(requestIp).trim() !== String(ipRestriction.ip).trim()) {
      throw createError(403, "Acesso bloqueado para o IP atual", { reason: ACCESS_REASONS.USER_BLOCKED });
    }
  }

  const schedule = access.schedule;
  if (!isWithinSchedule(schedule)) {
    throw createError(403, "Acesso bloqueado fora do horário permitido", { reason: ACCESS_REASONS.USER_BLOCKED });
  }

  const hasTenantMismatch =
    req.clientId &&
    user.clientId &&
    String(req.clientId) !== String(user.clientId);
  if (hasTenantMismatch) {
    const isMirrorRead =
      req.mirrorContext?.mode === "target" && ["GET", "HEAD"].includes(req.method);
    const accessType = req.tenant?.accessType;
    const hasExplicitAccess = accessType === "linked" || accessType === "admin";
    if (isMirrorRead && accessType === "mirror") {
      if (process.env.DEBUG_MIRROR === "true") {
        console.info("[user-access] bypass tenant check for mirror read", {
          path: req.originalUrl || req.url,
          method: req.method,
          userId: user?.id ? String(user.id) : null,
          userClientId: user?.clientId ? String(user.clientId) : null,
          ownerClientId: req.mirrorContext?.ownerClientId ? String(req.mirrorContext.ownerClientId) : null,
          targetClientId: req.mirrorContext?.targetClientId ? String(req.mirrorContext.targetClientId) : null,
          mirrorId: req.mirrorContext?.mirrorId ? String(req.mirrorContext.mirrorId) : null,
        });
      }
      return;
    }
    if (!hasExplicitAccess && accessType !== "mirror") {
      throw createError(403, "Sem acesso", { reason: ACCESS_REASONS.FORBIDDEN_SCOPE });
    }
    if (accessType === "mirror" && !isMirrorRead) {
      throw createError(403, "Sem acesso", { reason: ACCESS_REASONS.FORBIDDEN_SCOPE });
    }
  }
}

export default enforceUserAccess;
