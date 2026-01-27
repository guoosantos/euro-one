import createError from "http-errors";

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

export function enforceUserAccess(req) {
  const user = req.user;
  if (!user || user.role === "admin") return;
  const access = user.attributes?.userAccess || {};

  const ipRestriction = access.ipRestriction;
  if (ipRestriction?.mode === "single" && ipRestriction.ip) {
    const requestIp = resolveRequestIp(req);
    if (requestIp && String(requestIp).trim() !== String(ipRestriction.ip).trim()) {
      throw createError(403, "Acesso bloqueado para o IP atual");
    }
  }

  const schedule = access.schedule;
  if (!isWithinSchedule(schedule)) {
    throw createError(403, "Acesso bloqueado fora do horário permitido");
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
      throw createError(403, "Sem acesso");
    }
    if (accessType === "mirror" && !isMirrorRead) {
      throw createError(403, "Sem acesso");
    }
  }
}

export default enforceUserAccess;
