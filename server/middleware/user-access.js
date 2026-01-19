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
}

export default enforceUserAccess;
