import express from "express";
import createError from "http-errors";

import { authenticate } from "../middleware/auth.js";
import { authorizePermission } from "../middleware/permissions.js";
import { resolveTenantScope } from "../utils/tenant-scope.js";
import { recordAuditEvent, resolveRequestIp } from "../services/audit-log.js";
import {
  cancelCounterKey,
  createCounterKey,
  exportActivityCsv,
  getUserSummary,
  listActivity,
  listAudit,
  listCounterKeys,
  listOptions,
  listUserStates,
  rotateChallenge,
  simulateCounterKey,
  useCounterKey,
} from "../services/trust-center/index.js";

const router = express.Router();

const canViewTrustCenter = authorizePermission({
  menuKey: "trust_center",
  pageKey: "view",
});

const canViewTrustCenterAudit = authorizePermission({
  menuKey: "trust_center",
  pageKey: "audit_view",
});

const canManageCounterKey = authorizePermission({
  menuKey: "trust_center",
  pageKey: "manage_counter_key",
});

router.use(authenticate);

function parsePagination(query = {}) {
  const page = Number(query.page);
  const pageSize = Number(query.pageSize);
  return {
    page: Number.isFinite(page) && page > 0 ? Math.floor(page) : 1,
    pageSize: Number.isFinite(pageSize) && pageSize > 0 ? Math.min(200, Math.floor(pageSize)) : 20,
  };
}

function parseSort(query = {}) {
  const sortBy = query.sortBy ? String(query.sortBy) : null;
  const sortDir = String(query.sortDir || "desc").toLowerCase() === "asc" ? "asc" : "desc";
  return { sortBy, sortDir };
}

async function resolveScopedClientIds(req, requestedClientId = null) {
  const scope = await resolveTenantScope(req.user);
  if (scope.isAdmin) {
    if (requestedClientId) return [String(requestedClientId)];
    return null;
  }

  const scopeIds = Array.from(scope.clientIds || []).map((clientId) => String(clientId));
  if (!requestedClientId) return scopeIds;

  if (!scope.clientIds.has(String(requestedClientId))) {
    throw createError(403, "Permissão insuficiente para acessar este cliente");
  }

  return [String(requestedClientId)];
}

function resolveActor(req) {
  return req.user?.name || req.user?.username || req.user?.email || req.user?.id || null;
}

function logSensitiveAudit({ req, action, status = "OK", clientId = null, details = null }) {
  try {
    recordAuditEvent({
      clientId: clientId || req.user?.clientId || null,
      category: "trust-center",
      action,
      status,
      user: {
        id: req.user?.id || null,
        name: resolveActor(req),
      },
      ipAddress: resolveRequestIp(req),
      details,
    });
  } catch (error) {
    console.warn("[trust-center] falha ao registrar auditoria", error?.message || error);
  }
}

router.get("/trust-center/options", canViewTrustCenter, async (req, res, next) => {
  try {
    const clientIds = await resolveScopedClientIds(req, req.query?.clientId || null);
    const payload = await listOptions({ clientIds });
    return res.json(payload);
  } catch (error) {
    return next(error);
  }
});

router.get("/trust-center/users", canViewTrustCenter, async (req, res, next) => {
  try {
    const { page, pageSize } = parsePagination(req.query);
    const { sortBy, sortDir } = parseSort(req.query);
    const clientIds = await resolveScopedClientIds(req, req.query?.clientId || null);

    const payload = listUserStates({
      clientIds,
      page,
      pageSize,
      sortBy,
      sortDir,
      filters: {
        user: req.query?.user,
        device: req.query?.device,
        password: req.query?.password,
        actionType: req.query?.actionType,
        result: req.query?.result,
        state: req.query?.state,
      },
    });

    return res.json(payload);
  } catch (error) {
    return next(error);
  }
});

router.get("/trust-center/users/:stateId/summary", canViewTrustCenter, async (req, res, next) => {
  try {
    const clientIds = await resolveScopedClientIds(req, req.query?.clientId || null);
    const payload = getUserSummary(req.params.stateId, { clientIds });
    return res.json(payload);
  } catch (error) {
    return next(error);
  }
});

router.post("/trust-center/challenge/rotate", canManageCounterKey, async (req, res, next) => {
  try {
    const requestedClientId = req.body?.clientId || req.query?.clientId || null;
    const clientIds = await resolveScopedClientIds(req, requestedClientId);
    const payload = await rotateChallenge({
      clientIds,
      userId: req.body?.userId || null,
      actor: resolveActor(req),
      filters: {
        user: req.body?.filters?.user,
        device: req.body?.filters?.device,
        password: req.body?.filters?.password,
        actionType: req.body?.filters?.actionType,
        result: req.body?.filters?.result,
        state: req.body?.filters?.state,
      },
    });

    logSensitiveAudit({
      req,
      action: "challenge.rotate",
      clientId: requestedClientId,
      details: { rotated: payload.rotated },
    });

    return res.json(payload);
  } catch (error) {
    return next(error);
  }
});

router.post("/trust-center/counter-keys/simulate", canManageCounterKey, async (req, res, next) => {
  try {
    const requestedClientId = req.body?.clientId || req.query?.clientId || req.user?.clientId || null;
    const clientIds = await resolveScopedClientIds(req, requestedClientId);
    if (Array.isArray(clientIds) && clientIds.length === 0) {
      throw createError(403, "Sem escopo de cliente para esta operação");
    }

    const payload = await simulateCounterKey({
      clientId: requestedClientId,
      basePin: req.body?.basePin,
      challenge: req.body?.challenge,
      userId: req.body?.userId,
      vehicleId: req.body?.vehicleId,
      actor: resolveActor(req),
    });

    logSensitiveAudit({
      req,
      action: "counter-key.simulate",
      clientId: requestedClientId,
      details: { challenge: payload.challenge },
    });

    return res.json(payload);
  } catch (error) {
    return next(error);
  }
});

router.get("/trust-center/counter-keys", canManageCounterKey, async (req, res, next) => {
  try {
    const { page, pageSize } = parsePagination(req.query);
    const { sortBy, sortDir } = parseSort(req.query);
    const clientIds = await resolveScopedClientIds(req, req.query?.clientId || null);

    const payload = listCounterKeys({
      clientIds,
      page,
      pageSize,
      sortBy,
      sortDir,
      filters: {
        user: req.query?.user,
        vehicle: req.query?.vehicle,
        device: req.query?.device,
        status: req.query?.status,
      },
    });

    return res.json(payload);
  } catch (error) {
    return next(error);
  }
});

router.post("/trust-center/counter-keys", canManageCounterKey, async (req, res, next) => {
  try {
    const requestedClientId = req.body?.clientId || req.query?.clientId || req.user?.clientId || null;
    const clientIds = await resolveScopedClientIds(req, requestedClientId);
    if (Array.isArray(clientIds) && clientIds.length === 0) {
      throw createError(403, "Sem escopo de cliente para esta operação");
    }

    const payload = await createCounterKey({
      clientId: requestedClientId,
      userId: req.body?.userId,
      targetUserId: req.body?.targetUserId || null,
      vehicleId: req.body?.vehicleId || null,
      esp32Device: req.body?.esp32Device || null,
      basePin: req.body?.basePin,
      challenge: req.body?.challenge || null,
      actor: resolveActor(req),
    });

    logSensitiveAudit({
      req,
      action: "counter-key.create",
      clientId: requestedClientId,
      details: { counterKeyId: payload.id, vehicleId: payload.vehicleId || null },
    });

    return res.status(201).json(payload);
  } catch (error) {
    return next(error);
  }
});

router.post("/trust-center/counter-keys/:id/use", canManageCounterKey, async (req, res, next) => {
  try {
    const requestedClientId = req.body?.clientId || req.query?.clientId || req.user?.clientId || null;
    await resolveScopedClientIds(req, requestedClientId);

    const payload = useCounterKey({
      id: req.params.id,
      actor: resolveActor(req),
      counterKey: req.body?.counterKey || null,
    });

    logSensitiveAudit({
      req,
      action: "counter-key.use",
      clientId: requestedClientId,
      details: { counterKeyId: payload.id, usesCount: payload.usesCount },
    });

    return res.json(payload);
  } catch (error) {
    return next(error);
  }
});

router.post("/trust-center/counter-keys/:id/cancel", canManageCounterKey, async (req, res, next) => {
  try {
    const requestedClientId = req.body?.clientId || req.query?.clientId || req.user?.clientId || null;
    await resolveScopedClientIds(req, requestedClientId);

    const payload = cancelCounterKey({
      id: req.params.id,
      actor: resolveActor(req),
    });

    logSensitiveAudit({
      req,
      action: "counter-key.cancel",
      clientId: requestedClientId,
      details: { counterKeyId: payload.id },
    });

    return res.json(payload);
  } catch (error) {
    return next(error);
  }
});

router.get("/trust-center/activity", canViewTrustCenterAudit, async (req, res, next) => {
  try {
    const { page, pageSize } = parsePagination(req.query);
    const { sortBy, sortDir } = parseSort(req.query);
    const clientIds = await resolveScopedClientIds(req, req.query?.clientId || null);

    const payload = listActivity({
      clientIds,
      page,
      pageSize,
      sortBy,
      sortDir,
      filters: {
        from: req.query?.from,
        to: req.query?.to,
        user: req.query?.user,
        client: req.query?.client,
        vehicle: req.query?.vehicle,
        device: req.query?.device,
        method: req.query?.method,
        result: req.query?.result,
      },
    });

    return res.json(payload);
  } catch (error) {
    return next(error);
  }
});

router.get("/trust-center/activity/export", canViewTrustCenterAudit, async (req, res, next) => {
  try {
    const clientIds = await resolveScopedClientIds(req, req.query?.clientId || null);
    const csv = exportActivityCsv({
      clientIds,
      filters: {
        from: req.query?.from,
        to: req.query?.to,
        user: req.query?.user,
        client: req.query?.client,
        vehicle: req.query?.vehicle,
        device: req.query?.device,
        method: req.query?.method,
        result: req.query?.result,
      },
    });

    const fileName = `trust-center-activity-${new Date().toISOString().replace(/[:.]/g, "-")}.csv`;
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
    return res.status(200).send(csv);
  } catch (error) {
    return next(error);
  }
});

router.get("/trust-center/audit", canViewTrustCenterAudit, async (req, res, next) => {
  try {
    const { page, pageSize } = parsePagination(req.query);
    const clientIds = await resolveScopedClientIds(req, req.query?.clientId || null);

    const payload = listAudit({
      clientIds,
      page,
      pageSize,
      filters: {
        from: req.query?.from,
        to: req.query?.to,
        user: req.query?.user,
        client: req.query?.client,
        vehicle: req.query?.vehicle,
        device: req.query?.device,
        method: req.query?.method,
        result: req.query?.result,
      },
    });

    return res.json(payload);
  } catch (error) {
    return next(error);
  }
});

export default router;
