import express from "express";
import createError from "http-errors";

import { authenticate } from "../middleware/auth.js";
import { resolveClientId } from "../middleware/client.js";
import {
  TRUST_CENTER_PERMISSIONS,
  authorizeTrustCenter,
  getTrustCenterPermissionPayload,
} from "../middleware/trust-center-permissions.js";
import {
  cancelTrustCenterCounterKey,
  createTrustCenterCounterKey,
  getTrustCenterUserSummary,
  listTrustCenterActivity,
  listTrustCenterAudit,
  listTrustCenterCounterKeys,
  listTrustCenterUsers,
  rotateTrustCenterChallenge,
  simulateCounterKey,
  upsertTrustCenterUserState,
  useTrustCenterCounterKey,
} from "../models/trust-center.js";
import { stringifyCsv } from "../utils/csv.js";

const router = express.Router();

router.use(authenticate);

function parsePositiveNumber(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
}

function pickActor(req) {
  return {
    id: req.user?.id ? String(req.user.id) : null,
    name: req.user?.name || req.user?.username || req.user?.email || "Sistema",
  };
}

router.get("/trust-center/capabilities", (req, res) => {
  const permissions = getTrustCenterPermissionPayload(req.user);
  res.json({
    permissions,
    routes: {
      default: "/trust-center/users",
      users: "/trust-center/users",
      activity: "/trust-center/activity",
      counterKey: "/trust-center/counter-key",
    },
  });
});

router.get(
  "/trust-center/users",
  authorizeTrustCenter(TRUST_CENTER_PERMISSIONS.VIEW),
  async (req, res, next) => {
    try {
      const clientId = resolveClientId(req, req.query?.clientId, { required: true });
      const payload = await listTrustCenterUsers({
        clientId,
        filters: {
          user: req.query?.user,
          device: req.query?.device,
          password: req.query?.password,
          actionType: req.query?.actionType,
          result: req.query?.result,
        },
        page: parsePositiveNumber(req.query?.page, 1),
        pageSize: parsePositiveNumber(req.query?.pageSize, 20),
        sortBy: req.query?.sortBy,
        sortDir: req.query?.sortDir,
      });

      return res.json(payload);
    } catch (error) {
      return next(error);
    }
  },
);

router.get(
  "/trust-center/users/:id/summary",
  authorizeTrustCenter(TRUST_CENTER_PERMISSIONS.VIEW),
  async (req, res, next) => {
    try {
      const clientId = resolveClientId(req, req.query?.clientId, { required: true });
      const summary = await getTrustCenterUserSummary({
        id: req.params.id,
        clientId,
      });

      if (!summary) {
        throw createError(404, "Registro de usuário não encontrado");
      }

      return res.json(summary);
    } catch (error) {
      return next(error);
    }
  },
);

router.post(
  "/trust-center/users/state",
  authorizeTrustCenter(TRUST_CENTER_PERMISSIONS.MANAGE_COUNTER_KEY),
  (req, res, next) => {
    try {
      const clientId = resolveClientId(req, req.body?.clientId || req.query?.clientId, { required: true });
      const item = upsertTrustCenterUserState({
        clientId,
        userId: req.body?.userId,
        userName: req.body?.userName,
        profile: req.body?.profile,
        deviceId: req.body?.deviceId,
        esp32Device: req.body?.esp32Device,
        vehicleId: req.body?.vehicleId,
        vehicleLabel: req.body?.vehicleLabel,
        state: req.body?.state,
        result: req.body?.result,
        actionType: req.body?.actionType,
        method: req.body?.method,
        challenge: req.body?.challenge,
        actor: pickActor(req),
        usedBy: req.body?.usedBy,
      });
      return res.status(201).json({ data: item });
    } catch (error) {
      return next(error);
    }
  },
);

router.get(
  "/trust-center/activity",
  authorizeTrustCenter(TRUST_CENTER_PERMISSIONS.AUDIT_VIEW),
  (req, res, next) => {
    try {
      const clientId = resolveClientId(req, req.query?.clientId, { required: true });
      const payload = listTrustCenterActivity({
        clientId,
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
        page: parsePositiveNumber(req.query?.page, 1),
        pageSize: parsePositiveNumber(req.query?.pageSize, 50),
        sortBy: req.query?.sortBy,
        sortDir: req.query?.sortDir,
      });

      return res.json(payload);
    } catch (error) {
      return next(error);
    }
  },
);

router.get(
  "/trust-center/activity/export",
  authorizeTrustCenter(TRUST_CENTER_PERMISSIONS.AUDIT_VIEW),
  (req, res, next) => {
    try {
      const clientId = resolveClientId(req, req.query?.clientId, { required: true });
      const payload = listTrustCenterActivity({
        clientId,
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
        page: 1,
        pageSize: 100_000,
        sortBy: req.query?.sortBy || "date",
        sortDir: req.query?.sortDir || "desc",
      });

      const rows = payload.data || [];
      const extraColumns = Array.isArray(payload.extraEsp32Columns) ? payload.extraEsp32Columns : [];
      const columns = [
        { key: "date", label: "data" },
        { key: "userName", label: "usuario" },
        { key: "profile", label: "perfil" },
        { key: "client", label: "cliente" },
        { key: "vehicle", label: "veiculo" },
        { key: "device", label: "dispositivo" },
        { key: "method", label: "metodo" },
        { key: "action", label: "acao" },
        { key: "result", label: "resultado" },
        { key: "created_by", label: "created_by" },
        { key: "used_by", label: "used_by" },
      ];

      extraColumns.forEach((key) => {
        columns.push({
          key: `esp32.${key}`,
          label: `esp32_${key}`,
          accessor: (row) => row?.esp32?.[key] || "",
        });
      });

      const csv = stringifyCsv(rows, columns);
      const fileName = `trust-center-activity-${new Date().toISOString().replace(/[:.]/g, "-")}.csv`;

      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
      return res.status(200).send(csv);
    } catch (error) {
      return next(error);
    }
  },
);

router.get(
  "/trust-center/counter-keys",
  authorizeTrustCenter(TRUST_CENTER_PERMISSIONS.MANAGE_COUNTER_KEY),
  (req, res, next) => {
    try {
      const clientId = resolveClientId(req, req.query?.clientId, { required: true });
      const payload = listTrustCenterCounterKeys({
        clientId,
        filters: {
          user: req.query?.user,
          vehicle: req.query?.vehicle,
          device: req.query?.device,
          status: req.query?.status,
        },
        page: parsePositiveNumber(req.query?.page, 1),
        pageSize: parsePositiveNumber(req.query?.pageSize, 20),
        sortBy: req.query?.sortBy,
        sortDir: req.query?.sortDir,
      });
      return res.json(payload);
    } catch (error) {
      return next(error);
    }
  },
);

router.post(
  "/trust-center/counter-keys",
  authorizeTrustCenter(TRUST_CENTER_PERMISSIONS.MANAGE_COUNTER_KEY),
  (req, res, next) => {
    try {
      const clientId = resolveClientId(req, req.body?.clientId || req.query?.clientId, { required: true });
      const data = createTrustCenterCounterKey({
        clientId,
        targetUserId: req.body?.targetUserId,
        vehicleId: req.body?.vehicleId,
        deviceId: req.body?.deviceId,
        basePassword: req.body?.basePassword,
        expiresInMinutes: req.body?.expiresInMinutes,
        maxUses: req.body?.maxUses,
        actor: pickActor(req),
      });
      return res.status(201).json({ data });
    } catch (error) {
      return next(error);
    }
  },
);

router.post(
  "/trust-center/counter-keys/:id/use",
  authorizeTrustCenter(TRUST_CENTER_PERMISSIONS.MANAGE_COUNTER_KEY),
  (req, res, next) => {
    try {
      const clientId = resolveClientId(req, req.body?.clientId || req.query?.clientId, { required: true });
      const data = useTrustCenterCounterKey({
        clientId,
        counterKeyId: req.params.id,
        providedCounterKey: req.body?.counterKey,
        actor: pickActor(req),
      });
      return res.json({ data });
    } catch (error) {
      return next(error);
    }
  },
);

router.post(
  "/trust-center/counter-keys/:id/cancel",
  authorizeTrustCenter(TRUST_CENTER_PERMISSIONS.MANAGE_COUNTER_KEY),
  (req, res, next) => {
    try {
      const clientId = resolveClientId(req, req.body?.clientId || req.query?.clientId, { required: true });
      const data = cancelTrustCenterCounterKey({
        clientId,
        counterKeyId: req.params.id,
        actor: pickActor(req),
      });
      return res.json({ data });
    } catch (error) {
      return next(error);
    }
  },
);

router.post(
  "/trust-center/challenge/rotate",
  authorizeTrustCenter(TRUST_CENTER_PERMISSIONS.MANAGE_COUNTER_KEY),
  (req, res, next) => {
    try {
      const clientId = resolveClientId(req, req.body?.clientId || req.query?.clientId, { required: true });
      const payload = rotateTrustCenterChallenge({
        clientId,
        userIds: req.body?.userIds,
        deviceIds: req.body?.deviceIds,
        actor: pickActor(req),
      });
      return res.json(payload);
    } catch (error) {
      return next(error);
    }
  },
);

router.post(
  "/trust-center/counter-keys/simulate",
  authorizeTrustCenter(TRUST_CENTER_PERMISSIONS.MANAGE_COUNTER_KEY),
  (req, res, next) => {
    try {
      const payload = simulateCounterKey({
        basePassword: req.body?.basePassword,
        challenge: req.body?.challenge,
        context: req.body?.context,
      });
      return res.json(payload);
    } catch (error) {
      return next(error);
    }
  },
);

router.get(
  "/trust-center/audit",
  authorizeTrustCenter(TRUST_CENTER_PERMISSIONS.AUDIT_VIEW),
  (req, res, next) => {
    try {
      const clientId = resolveClientId(req, req.query?.clientId, { required: true });
      const payload = listTrustCenterAudit({
        clientId,
        action: req.query?.action,
        actor: req.query?.actor,
        page: parsePositiveNumber(req.query?.page, 1),
        pageSize: parsePositiveNumber(req.query?.pageSize, 50),
      });
      return res.json(payload);
    } catch (error) {
      return next(error);
    }
  },
);

export default router;
