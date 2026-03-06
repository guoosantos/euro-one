import express from "express";

import { authenticate } from "../middleware/auth.js";
import { resolveClientId, resolveClientIdMiddleware } from "../middleware/client.js";
import {
  requireTrustCenterView,
  requireTrustCenterAuditView,
  requireTrustCenterManage,
} from "../middleware/trust-center-permissions.js";
import { recordAuditEvent, resolveRequestIp } from "../services/audit-log.js";
import {
  listTrustUsers,
  listTrustUserOptions,
  getTrustUserSummary,
  rotateTrustChallenge,
  simulateTrustCounterKey,
  listTrustActivity,
  exportTrustActivityCsv,
  listTrustCounterKeys,
  createTrustCounterKey,
  useTrustCounterKey,
  cancelTrustCounterKey,
} from "../services/trust-center.js";

const router = express.Router();

function toPositiveInteger(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.floor(parsed));
}

function resolveActor(req) {
  return {
    id: req.user?.id ? String(req.user.id) : null,
    name: req.user?.name || req.user?.username || req.user?.email || null,
    role: req.user?.role || null,
  };
}

function safeClientId(req) {
  return resolveClientId(req, req.query?.clientId || req.body?.clientId, { required: false });
}

function writeSensitiveAudit(req, payload = {}) {
  const actor = resolveActor(req);
  recordAuditEvent({
    category: "trust-center",
    action: payload.action || "TRUST_CENTER_ACTION",
    status: payload.status || "SUCESSO",
    clientId: payload.clientId || req.clientId || req.user?.clientId || null,
    user: {
      id: actor.id,
      name: actor.name,
    },
    ipAddress: resolveRequestIp(req),
    details: payload.details || {},
  });
}

router.use((req, res, next) => authenticate(req, res, next));
router.use((req, res, next) => resolveClientIdMiddleware(req, res, next));

router.get("/trust-center/users/options", requireTrustCenterView, async (req, res, next) => {
  try {
    const clientId = safeClientId(req);
    const payload = listTrustUserOptions({ clientId });
    res.json(payload);
  } catch (error) {
    next(error);
  }
});

router.get("/trust-center/users", requireTrustCenterView, async (req, res, next) => {
  try {
    const clientId = safeClientId(req);
    const payload = listTrustUsers({
      clientId,
      page: toPositiveInteger(req.query?.page, 1),
      pageSize: toPositiveInteger(req.query?.pageSize, 20),
      sortBy: req.query?.sortBy || null,
      sortDir: req.query?.sortDir || "desc",
      filters: {
        user: req.query?.user || "",
        device: req.query?.device || "",
        password: req.query?.password || "",
        actionType: req.query?.actionType || "",
        result: req.query?.result || "",
      },
    });
    res.json(payload);
  } catch (error) {
    next(error);
  }
});

router.get("/trust-center/users/:id/summary", requireTrustCenterView, async (req, res, next) => {
  try {
    const clientId = safeClientId(req);
    const payload = getTrustUserSummary({ userId: req.params.id, clientId });
    if (!payload) {
      return res.status(404).json({ message: "Usuário não encontrado" });
    }
    return res.json(payload);
  } catch (error) {
    return next(error);
  }
});

router.post("/trust-center/challenge/rotate", requireTrustCenterManage, async (req, res, next) => {
  try {
    const clientId = safeClientId(req);
    const actor = resolveActor(req);
    const payload = rotateTrustChallenge({
      userId: req.body?.userId || null,
      actor,
      clientId,
    });

    writeSensitiveAudit(req, {
      action: "TRUST_CENTER_ROTATE_CHALLENGE",
      status: "SUCESSO",
      clientId,
      details: {
        userId: req.body?.userId || null,
        rotated: payload.rotated,
      },
    });

    res.json(payload);
  } catch (error) {
    next(error);
  }
});

router.post("/trust-center/counter-key/simulate", requireTrustCenterManage, async (req, res, next) => {
  try {
    const clientId = safeClientId(req);
    const actor = resolveActor(req);
    const payload = simulateTrustCounterKey({
      userId: req.body?.userId,
      basePassword: req.body?.basePassword,
      actor,
      clientId,
    });
    if (!payload) {
      return res.status(404).json({ message: "Usuário não encontrado para simulação" });
    }

    writeSensitiveAudit(req, {
      action: "TRUST_CENTER_SIMULATE_COUNTER_KEY",
      status: "SUCESSO",
      clientId,
      details: {
        userId: req.body?.userId || null,
      },
    });

    return res.json(payload);
  } catch (error) {
    return next(error);
  }
});

router.get("/trust-center/activity", requireTrustCenterAuditView, async (req, res, next) => {
  try {
    const clientId = safeClientId(req);
    const payload = listTrustActivity({
      clientId,
      page: toPositiveInteger(req.query?.page, 1),
      pageSize: toPositiveInteger(req.query?.pageSize, 20),
      sortBy: req.query?.sortBy || "date",
      sortDir: req.query?.sortDir || "desc",
      filters: {
        from: req.query?.from || null,
        to: req.query?.to || null,
        user: req.query?.user || "",
        client: req.query?.client || "",
        vehicle: req.query?.vehicle || "",
        device: req.query?.device || "",
        method: req.query?.method || "",
        result: req.query?.result || "",
      },
    });
    res.json(payload);
  } catch (error) {
    next(error);
  }
});

router.get("/trust-center/audit", requireTrustCenterAuditView, async (req, res, next) => {
  try {
    const clientId = safeClientId(req);
    const payload = listTrustActivity({
      clientId,
      page: toPositiveInteger(req.query?.page, 1),
      pageSize: toPositiveInteger(req.query?.pageSize, 20),
      sortBy: req.query?.sortBy || "date",
      sortDir: req.query?.sortDir || "desc",
      filters: {
        from: req.query?.from || null,
        to: req.query?.to || null,
        user: req.query?.user || "",
        client: req.query?.client || "",
        vehicle: req.query?.vehicle || "",
        device: req.query?.device || "",
        method: req.query?.method || "",
        result: req.query?.result || "",
      },
    });
    res.json(payload);
  } catch (error) {
    next(error);
  }
});

router.get("/trust-center/activity/export", requireTrustCenterAuditView, async (req, res, next) => {
  try {
    const clientId = safeClientId(req);
    const csv = exportTrustActivityCsv({
      clientId,
      sortBy: req.query?.sortBy || "date",
      sortDir: req.query?.sortDir || "desc",
      filters: {
        from: req.query?.from || null,
        to: req.query?.to || null,
        user: req.query?.user || "",
        client: req.query?.client || "",
        vehicle: req.query?.vehicle || "",
        device: req.query?.device || "",
        method: req.query?.method || "",
        result: req.query?.result || "",
      },
    });

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename=trust-center-audit-${Date.now()}.csv`);
    res.status(200).send(csv);
  } catch (error) {
    next(error);
  }
});

router.get("/trust-center/counter-keys", requireTrustCenterManage, async (req, res, next) => {
  try {
    const clientId = safeClientId(req);
    const payload = listTrustCounterKeys({
      clientId,
      page: toPositiveInteger(req.query?.page, 1),
      pageSize: toPositiveInteger(req.query?.pageSize, 20),
      sortBy: req.query?.sortBy || "createdAt",
      sortDir: req.query?.sortDir || "desc",
      filters: {
        user: req.query?.user || "",
        client: req.query?.client || "",
        vehicle: req.query?.vehicle || "",
        device: req.query?.device || "",
        status: req.query?.status || "",
      },
    });
    res.json(payload);
  } catch (error) {
    next(error);
  }
});

router.post("/trust-center/counter-keys", requireTrustCenterManage, async (req, res, next) => {
  try {
    const clientId = safeClientId(req);
    const actor = resolveActor(req);
    const payload = createTrustCounterKey({
      clientId,
      userId: req.body?.userId,
      vehicle: req.body?.vehicle,
      basePassword: req.body?.basePassword,
      actor,
    });

    writeSensitiveAudit(req, {
      action: "TRUST_CENTER_COUNTER_KEY_CREATE",
      status: "SUCESSO",
      clientId,
      details: {
        userId: req.body?.userId || null,
        vehicle: req.body?.vehicle || null,
      },
    });

    res.status(201).json(payload);
  } catch (error) {
    const status = error?.status || 500;
    if (status < 500) {
      return res.status(status).json({ message: error.message || "Falha ao criar contra-senha" });
    }
    return next(error);
  }
});

router.post("/trust-center/counter-keys/:id/use", requireTrustCenterManage, async (req, res, next) => {
  try {
    const clientId = safeClientId(req);
    const actor = resolveActor(req);
    const payload = useTrustCounterKey({
      id: req.params.id,
      usedBy: {
        id: req.body?.usedById || actor.id,
        name: req.body?.usedByName || actor.name,
        email: req.body?.usedByEmail || req.user?.email || null,
        username: req.body?.usedByUsername || req.user?.username || null,
      },
      clientId,
    });

    writeSensitiveAudit(req, {
      action: "TRUST_CENTER_COUNTER_KEY_USE",
      status: "SUCESSO",
      clientId,
      details: {
        counterKeyId: req.params.id,
      },
    });

    res.json(payload);
  } catch (error) {
    const status = error?.status || 500;
    if (status < 500) {
      return res.status(status).json({ message: error.message || "Falha ao registrar uso da contra-senha" });
    }
    return next(error);
  }
});

router.post("/trust-center/counter-keys/:id/cancel", requireTrustCenterManage, async (req, res, next) => {
  try {
    const clientId = safeClientId(req);
    const actor = resolveActor(req);
    const payload = cancelTrustCounterKey({
      id: req.params.id,
      actor,
      clientId,
    });

    writeSensitiveAudit(req, {
      action: "TRUST_CENTER_COUNTER_KEY_CANCEL",
      status: "SUCESSO",
      clientId,
      details: {
        counterKeyId: req.params.id,
      },
    });

    res.json(payload);
  } catch (error) {
    const status = error?.status || 500;
    if (status < 500) {
      return res.status(status).json({ message: error.message || "Falha ao cancelar contra-senha" });
    }
    return next(error);
  }
});

export default router;
