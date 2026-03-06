import express from "express";
import createError from "http-errors";
import { randomUUID } from "node:crypto";

import { authenticate } from "../middleware/auth.js";
import { resolveClientId } from "../middleware/client.js";
import { authorizePermission, resolvePermissionContext } from "../middleware/permissions.js";
import prisma, { isPrismaAvailable } from "../services/prisma.js";
import {
  TRUST_CENTER_COUNTER_STATUS,
  TRUST_CENTER_STATES,
  computeExpiresAt,
  generateChallenge,
  generateCounterKey,
  hashBasePassword,
  isCounterKeyExpired,
  maskPasswordLast6,
  normalizeSixDigitPassword,
  resolveEsp32Columns,
  resolveTrustCenterConfig,
} from "../services/trust-center.js";

const router = express.Router();

router.use(authenticate);

const TRUST_PERMISSIONS = {
  view: "trust_center.view",
  auditView: "trust_center.audit_view",
  manageCounterKey: "trust_center.manage_counter_key",
};

const TRUST_PERMISSION_ROUTE_MAP = {
  [TRUST_PERMISSIONS.view]: { menuKey: "admin", pageKey: "trust-center" },
  [TRUST_PERMISSIONS.auditView]: { menuKey: "admin", pageKey: "trust-center", subKey: "activity" },
  [TRUST_PERMISSIONS.manageCounterKey]: {
    menuKey: "admin",
    pageKey: "trust-center",
    subKey: "counter-key",
    requireFull: true,
  },
};

const STATE_PRIORITY = {
  [TRUST_CENTER_STATES.ONLINE]: 1,
  [TRUST_CENTER_STATES.TRYING]: 2,
  [TRUST_CENTER_STATES.ACCESS_REGISTERED]: 3,
};

function ensurePrisma() {
  if (!isPrismaAvailable()) {
    throw createError(503, "Banco de dados indisponível");
  }
}

function parseJsonObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value;
}

function resolveTrustPermissionBag(req) {
  const attributes = parseJsonObject(req.user?.attributes);
  const bag = attributes.trustCenterPermissions ?? attributes.trust_center_permissions ?? attributes.permissionsFlat;

  if (Array.isArray(bag)) {
    return new Set(bag.map((item) => String(item || "").trim()).filter(Boolean));
  }

  if (bag && typeof bag === "object") {
    const set = new Set();
    Object.entries(bag).forEach(([key, value]) => {
      if (value === true) set.add(String(key));
    });
    return set;
  }

  return new Set();
}

async function hasTrustPermissionFromContext(req, permissionName) {
  try {
    const context = await resolvePermissionContext(req);
    const permissions = context?.permissions || null;
    if (!permissions || typeof permissions !== "object") return false;

    const trustCenterEntry = permissions?.admin?.["trust-center"];
    if (!trustCenterEntry) return false;

    const access = (entry) => {
      if (!entry) return "none";
      if (typeof entry === "string") return entry;
      if (typeof entry === "object") {
        if (entry.visible === false) return "none";
        return String(entry.access || "read").toLowerCase();
      }
      return "none";
    };

    const pageLevel = access(trustCenterEntry);
    const subpages = trustCenterEntry?.subpages && typeof trustCenterEntry.subpages === "object"
      ? trustCenterEntry.subpages
      : {};

    if (permissionName === TRUST_PERMISSIONS.view) {
      return ["read", "full", "view"].includes(pageLevel);
    }

    if (permissionName === TRUST_PERMISSIONS.auditView) {
      const level = access(subpages.activity) || pageLevel;
      return ["read", "full", "view"].includes(level);
    }

    if (permissionName === TRUST_PERMISSIONS.manageCounterKey) {
      const level = access(subpages["counter-key"]) || pageLevel;
      return level === "full";
    }

    return false;
  } catch (_error) {
    return false;
  }
}

function authorizeTrustPermission(permissionName) {
  const mapped = TRUST_PERMISSION_ROUTE_MAP[permissionName] || null;
  const mappedMiddleware = mapped ? authorizePermission(mapped) : null;

  return async (req, res, next) => {
    const bag = resolveTrustPermissionBag(req);
    if (bag.has(permissionName)) {
      return next();
    }

    if (await hasTrustPermissionFromContext(req, permissionName)) {
      return next();
    }

    if (!mappedMiddleware) {
      return next(createError(403, "Permissão insuficiente"));
    }

    return mappedMiddleware(req, res, next);
  };
}

function normalizeSortDir(value) {
  return String(value || "DESC").toUpperCase() === "ASC" ? "ASC" : "DESC";
}

function parseIntSafe(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.trunc(parsed);
}

function resolvePagination(query, { defaultPageSize = 20, maxPageSize = 200 } = {}) {
  const page = Math.max(1, parseIntSafe(query?.page, 1));
  const pageSize = Math.min(maxPageSize, Math.max(1, parseIntSafe(query?.pageSize, defaultPageSize)));
  const offset = (page - 1) * pageSize;
  return { page, pageSize, offset };
}

function addFilter(where, params, clause, value, transform = (v) => v) {
  const normalized = String(value || "").trim();
  if (!normalized) return;
  params.push(transform(normalized));
  where.push(clause.replace("?", `$${params.length}`));
}

function escapeCsvCell(value) {
  const text = value === null || value === undefined ? "" : String(value);
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

async function recordTrustEvent({
  clientId,
  userId = null,
  vehicleId = null,
  esp32DeviceId = null,
  state = null,
  method = null,
  action,
  result = null,
  createdBy = null,
  usedBy = null,
  ipAddress = null,
  metadata = {},
}) {
  await prisma.$executeRawUnsafe(
    `INSERT INTO "trust_center_event" (
      "id", "client_id", "user_id", "vehicle_id", "esp32_device_id", "state", "method", "action", "result", "created_by", "used_by", "ip_address", "metadata", "created_at"
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,NOW())`,
    randomUUID(),
    String(clientId),
    userId ? String(userId) : null,
    vehicleId ? String(vehicleId) : null,
    esp32DeviceId ? String(esp32DeviceId) : null,
    state,
    method,
    String(action),
    result,
    createdBy,
    usedBy,
    ipAddress,
    JSON.stringify(parseJsonObject(metadata)),
  );
}

async function upsertTrustUserState({
  clientId,
  userId,
  vehicleId = null,
  esp32DeviceId,
  statusState,
  challenge = null,
  validationMethod = null,
  lastResult = null,
  lastActionType = null,
  lastPasswordLast6 = null,
  markHeartbeat = false,
  markAttempt = false,
  markAccess = false,
}) {
  await prisma.$executeRawUnsafe(
    `INSERT INTO "trust_center_user_state" (
      "id", "client_id", "user_id", "vehicle_id", "esp32_device_id", "status_state", "challenge", "validation_method", "last_result", "last_action_type", "last_password_last6", "last_heartbeat_at", "last_attempt_at", "last_access_at", "created_at", "updated_at"
    ) VALUES (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,
      CASE WHEN $12::boolean THEN NOW() ELSE NULL END,
      CASE WHEN $13::boolean THEN NOW() ELSE NULL END,
      CASE WHEN $14::boolean THEN NOW() ELSE NULL END,
      NOW(), NOW()
    )
    ON CONFLICT ("client_id", "user_id", "esp32_device_id") DO UPDATE SET
      "vehicle_id" = EXCLUDED."vehicle_id",
      "status_state" = EXCLUDED."status_state",
      "challenge" = COALESCE(EXCLUDED."challenge", "trust_center_user_state"."challenge"),
      "validation_method" = COALESCE(EXCLUDED."validation_method", "trust_center_user_state"."validation_method"),
      "last_result" = COALESCE(EXCLUDED."last_result", "trust_center_user_state"."last_result"),
      "last_action_type" = COALESCE(EXCLUDED."last_action_type", "trust_center_user_state"."last_action_type"),
      "last_password_last6" = COALESCE(EXCLUDED."last_password_last6", "trust_center_user_state"."last_password_last6"),
      "last_heartbeat_at" = CASE WHEN $12::boolean THEN NOW() ELSE "trust_center_user_state"."last_heartbeat_at" END,
      "last_attempt_at" = CASE WHEN $13::boolean THEN NOW() ELSE "trust_center_user_state"."last_attempt_at" END,
      "last_access_at" = CASE WHEN $14::boolean THEN NOW() ELSE "trust_center_user_state"."last_access_at" END,
      "updated_at" = NOW()`,
    randomUUID(),
    String(clientId),
    String(userId),
    vehicleId ? String(vehicleId) : null,
    String(esp32DeviceId),
    String(statusState || TRUST_CENTER_STATES.TRYING),
    challenge,
    validationMethod,
    lastResult,
    lastActionType,
    lastPasswordLast6,
    Boolean(markHeartbeat),
    Boolean(markAttempt),
    Boolean(markAccess),
  );
}

async function resolveClientUser({ clientId, userId }) {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT "id", "name", "role", "clientId"
     FROM "User"
     WHERE "id" = $1 AND "clientId" = $2
     LIMIT 1`,
    String(userId),
    String(clientId),
  );
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

async function resolveClientVehicle({ clientId, vehicleId }) {
  if (!vehicleId) return null;
  const rows = await prisma.$queryRawUnsafe(
    `SELECT "id", "name", "plate", "clientId"
     FROM "Vehicle"
     WHERE "id" = $1 AND "clientId" = $2
     LIMIT 1`,
    String(vehicleId),
    String(clientId),
  );
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

function resolveUserListSort(sortBy, sortDir) {
  const dir = normalizeSortDir(sortDir);
  const safeMap = {
    user: `COALESCE(u."name", s."user_id") ${dir}`,
    client: `COALESCE(c."name", s."client_id") ${dir}`,
    device: `s."esp32_device_id" ${dir}`,
    result: `COALESCE(s."last_result", '') ${dir}`,
    actionType: `COALESCE(s."last_action_type", '') ${dir}`,
    updatedAt: `s."updated_at" ${dir}`,
  };
  return safeMap[sortBy] || null;
}

function resolveActivitySort(sortBy, sortDir) {
  const dir = normalizeSortDir(sortDir);
  const safeMap = {
    date: `e."created_at" ${dir}`,
    user: `COALESCE(u."name", e."user_id") ${dir}`,
    client: `COALESCE(c."name", e."client_id") ${dir}`,
    vehicle: `COALESCE(v."plate", v."name", e."vehicle_id") ${dir}`,
    device: `COALESCE(e."esp32_device_id", '') ${dir}`,
    method: `COALESCE(e."method", '') ${dir}`,
    action: `COALESCE(e."action", '') ${dir}`,
    result: `COALESCE(e."result", '') ${dir}`,
  };
  return safeMap[sortBy] || safeMap.date;
}

function resolveCounterKeySort(sortBy, sortDir) {
  const dir = normalizeSortDir(sortDir);
  const safeMap = {
    createdAt: `k."created_at" ${dir}`,
    user: `COALESCE(u."name", k."user_id") ${dir}`,
    vehicle: `COALESCE(v."plate", v."name", k."vehicle_id") ${dir}`,
    device: `COALESCE(k."esp32_device_id", '') ${dir}`,
    status: `COALESCE(k."status", '') ${dir}`,
    uses: `k."uses_count" ${dir}`,
    lastUsedAt: `k."last_used_at" ${dir} NULLS LAST`,
  };
  return safeMap[sortBy] || safeMap.createdAt;
}

function parseDateInput(value) {
  if (!value) return null;
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function normalizeRowMetadata(rows) {
  return rows.map((row) => {
    const metadata = parseJsonObject(row.metadata);
    return {
      ...row,
      metadata,
      esp32Columns: resolveEsp32Columns(metadata),
    };
  });
}

async function buildActivityRows({ clientId, query, includePagination = true }) {
  const where = [`e."client_id" = $1`];
  const params = [String(clientId)];

  const userFilter = String(query.user || "").trim();
  if (userFilter) {
    params.push(`%${userFilter}%`);
    const p1 = `$${params.length}`;
    params.push(`%${userFilter}%`);
    const p2 = `$${params.length}`;
    params.push(`%${userFilter}%`);
    const p3 = `$${params.length}`;
    where.push(`(COALESCE(u."name", '') ILIKE ${p1} OR COALESCE(u."email", '') ILIKE ${p2} OR COALESCE(u."username", '') ILIKE ${p3})`);
  }

  addFilter(where, params, `(COALESCE(c."name", '') ILIKE ?)`, query.client, (v) => `%${v}%`);
  const vehicleFilter = String(query.vehicle || "").trim();
  if (vehicleFilter) {
    params.push(`%${vehicleFilter}%`);
    const v1 = `$${params.length}`;
    params.push(`%${vehicleFilter}%`);
    const v2 = `$${params.length}`;
    where.push(`(COALESCE(v."name", '') ILIKE ${v1} OR COALESCE(v."plate", '') ILIKE ${v2})`);
  }
  addFilter(where, params, `COALESCE(e."esp32_device_id", '') ILIKE ?`, query.device, (v) => `%${v}%`);
  addFilter(where, params, `COALESCE(e."method", '') ILIKE ?`, query.method, (v) => `%${v}%`);
  addFilter(where, params, `COALESCE(e."result", '') ILIKE ?`, query.result, (v) => `%${v}%`);
  addFilter(where, params, `COALESCE(e."action", '') ILIKE ?`, query.action, (v) => `%${v}%`);

  const from = parseDateInput(query.dateFrom);
  if (from) {
    params.push(from.toISOString());
    where.push(`e."created_at" >= $${params.length}`);
  }

  const to = parseDateInput(query.dateTo);
  if (to) {
    params.push(to.toISOString());
    where.push(`e."created_at" <= $${params.length}`);
  }

  const whereSql = where.join(" AND ");
  const orderBy = resolveActivitySort(query.sortBy, query.sortDir);

  const countRows = await prisma.$queryRawUnsafe(
    `SELECT COUNT(*)::int AS total
     FROM "trust_center_event" e
     LEFT JOIN "User" u ON u."id" = e."user_id"
     LEFT JOIN "Client" c ON c."id" = e."client_id"
     LEFT JOIN "Vehicle" v ON v."id" = e."vehicle_id"
     WHERE ${whereSql}`,
    ...params,
  );

  const total = Number(countRows?.[0]?.total || 0);

  let dataParams = [...params];
  let limitOffsetSql = "";
  let pagination = null;

  if (includePagination) {
    const { page, pageSize, offset } = resolvePagination(query, { defaultPageSize: 25, maxPageSize: 200 });
    dataParams = [...dataParams, pageSize, offset];
    limitOffsetSql = `LIMIT $${dataParams.length - 1} OFFSET $${dataParams.length}`;
    pagination = {
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    };
  }

  const rows = await prisma.$queryRawUnsafe(
    `SELECT
      e."id",
      e."client_id" AS "clientId",
      e."user_id" AS "userId",
      e."vehicle_id" AS "vehicleId",
      e."esp32_device_id" AS "esp32DeviceId",
      e."state",
      e."method",
      e."action",
      e."result",
      e."created_by" AS "createdBy",
      e."used_by" AS "usedBy",
      e."ip_address" AS "ipAddress",
      e."metadata",
      e."created_at" AS "createdAt",
      u."name" AS "userName",
      u."role" AS "userRole",
      c."name" AS "clientName",
      v."name" AS "vehicleName",
      v."plate" AS "vehiclePlate"
    FROM "trust_center_event" e
    LEFT JOIN "User" u ON u."id" = e."user_id"
    LEFT JOIN "Client" c ON c."id" = e."client_id"
    LEFT JOIN "Vehicle" v ON v."id" = e."vehicle_id"
    WHERE ${whereSql}
    ORDER BY ${orderBy}
    ${limitOffsetSql}`,
    ...dataParams,
  );

  return {
    rows: normalizeRowMetadata(Array.isArray(rows) ? rows : []),
    total,
    pagination,
  };
}

router.get(
  "/trust-center/users",
  authorizeTrustPermission(TRUST_PERMISSIONS.view),
  async (req, res, next) => {
    try {
      ensurePrisma();
      const clientId = resolveClientId(req, req.query?.clientId, { required: true });
      const where = [`s."client_id" = $1`];
      const params = [String(clientId)];

      const userFilter = String(req.query.user || "").trim();
      if (userFilter) {
        params.push(`%${userFilter}%`);
        const p1 = `$${params.length}`;
        params.push(`%${userFilter}%`);
        const p2 = `$${params.length}`;
        params.push(`%${userFilter}%`);
        const p3 = `$${params.length}`;
        where.push(`(COALESCE(u."name", '') ILIKE ${p1} OR COALESCE(u."email", '') ILIKE ${p2} OR COALESCE(u."username", '') ILIKE ${p3})`);
      }

      addFilter(where, params, `COALESCE(s."esp32_device_id", '') ILIKE ?`, req.query.device, (v) => `%${v}%`);
      addFilter(where, params, `COALESCE(s."last_password_last6", '') ILIKE ?`, req.query.password, (v) => `%${v}%`);
      addFilter(where, params, `COALESCE(s."last_action_type", '') ILIKE ?`, req.query.actionType, (v) => `%${v}%`);
      addFilter(where, params, `COALESCE(s."last_result", '') ILIKE ?`, req.query.result, (v) => `%${v}%`);

      const whereSql = where.join(" AND ");
      const { page, pageSize, offset } = resolvePagination(req.query, { defaultPageSize: 20, maxPageSize: 200 });
      const secondarySort = resolveUserListSort(req.query.sortBy, req.query.sortDir);

      const countRows = await prisma.$queryRawUnsafe(
        `SELECT COUNT(*)::int AS total
         FROM "trust_center_user_state" s
         LEFT JOIN "User" u ON u."id" = s."user_id"
         LEFT JOIN "Client" c ON c."id" = s."client_id"
         LEFT JOIN "Vehicle" v ON v."id" = s."vehicle_id"
         WHERE ${whereSql}`,
        ...params,
      );
      const total = Number(countRows?.[0]?.total || 0);

      const dataParams = [...params, pageSize, offset];
      const rows = await prisma.$queryRawUnsafe(
        `SELECT
          s."id",
          s."client_id" AS "clientId",
          s."user_id" AS "userId",
          s."vehicle_id" AS "vehicleId",
          s."esp32_device_id" AS "esp32DeviceId",
          s."status_state" AS "state",
          s."challenge",
          s."validation_method" AS "validationMethod",
          s."last_result" AS "lastResult",
          s."last_action_type" AS "lastActionType",
          s."last_password_last6" AS "lastPasswordLast6",
          s."last_heartbeat_at" AS "lastHeartbeatAt",
          s."last_attempt_at" AS "lastAttemptAt",
          s."last_access_at" AS "lastAccessAt",
          s."created_at" AS "createdAt",
          s."updated_at" AS "updatedAt",
          u."name" AS "userName",
          u."role" AS "userRole",
          c."name" AS "clientName",
          v."name" AS "vehicleName",
          v."plate" AS "vehiclePlate"
        FROM "trust_center_user_state" s
        LEFT JOIN "User" u ON u."id" = s."user_id"
        LEFT JOIN "Client" c ON c."id" = s."client_id"
        LEFT JOIN "Vehicle" v ON v."id" = s."vehicle_id"
        WHERE ${whereSql}
        ORDER BY
          CASE s."status_state"
            WHEN 'ONLINE' THEN ${STATE_PRIORITY[TRUST_CENTER_STATES.ONLINE]}
            WHEN 'TENTANDO' THEN ${STATE_PRIORITY[TRUST_CENTER_STATES.TRYING]}
            WHEN 'ACESSO_REGISTRADO' THEN ${STATE_PRIORITY[TRUST_CENTER_STATES.ACCESS_REGISTERED]}
            ELSE 4
          END ASC,
          CASE WHEN s."status_state" = 'ONLINE' THEN COALESCE(s."last_heartbeat_at", s."updated_at") END DESC NULLS LAST,
          CASE WHEN s."status_state" = 'TENTANDO' THEN COALESCE(s."last_attempt_at", s."updated_at") END DESC NULLS LAST,
          CASE WHEN s."status_state" = 'ACESSO_REGISTRADO' THEN COALESCE(s."last_access_at", s."updated_at") END DESC NULLS LAST
          ${secondarySort ? `, ${secondarySort}` : ""},
          s."updated_at" DESC
        LIMIT $${dataParams.length - 1} OFFSET $${dataParams.length}`,
        ...dataParams,
      );

      res.json({
        rows: Array.isArray(rows) ? rows : [],
        pagination: {
          page,
          pageSize,
          total,
          totalPages: Math.max(1, Math.ceil(total / pageSize)),
        },
      });
    } catch (error) {
      next(error);
    }
  },
);

router.get(
  "/trust-center/users/:userId/summary",
  authorizeTrustPermission(TRUST_PERMISSIONS.view),
  async (req, res, next) => {
    try {
      ensurePrisma();
      const clientId = resolveClientId(req, req.query?.clientId, { required: true });
      const userId = String(req.params.userId || "").trim();
      if (!userId) throw createError(400, "userId obrigatório");

      const esp32DeviceId = String(req.query?.esp32DeviceId || "").trim();
      const stateParams = [String(clientId), userId];
      let whereDeviceSql = "";
      if (esp32DeviceId) {
        stateParams.push(esp32DeviceId);
        whereDeviceSql = ` AND s."esp32_device_id" = $${stateParams.length}`;
      }

      const stateRows = await prisma.$queryRawUnsafe(
        `SELECT
          s."id",
          s."client_id" AS "clientId",
          s."user_id" AS "userId",
          s."vehicle_id" AS "vehicleId",
          s."esp32_device_id" AS "esp32DeviceId",
          s."status_state" AS "state",
          s."challenge",
          s."validation_method" AS "validationMethod",
          s."last_result" AS "lastResult",
          s."last_action_type" AS "lastActionType",
          s."last_password_last6" AS "lastPasswordLast6",
          s."last_heartbeat_at" AS "lastHeartbeatAt",
          s."last_attempt_at" AS "lastAttemptAt",
          s."last_access_at" AS "lastAccessAt",
          s."created_at" AS "createdAt",
          s."updated_at" AS "updatedAt",
          u."name" AS "userName",
          u."role" AS "userRole",
          c."name" AS "clientName",
          v."name" AS "vehicleName",
          v."plate" AS "vehiclePlate"
        FROM "trust_center_user_state" s
        LEFT JOIN "User" u ON u."id" = s."user_id"
        LEFT JOIN "Client" c ON c."id" = s."client_id"
        LEFT JOIN "Vehicle" v ON v."id" = s."vehicle_id"
        WHERE s."client_id" = $1 AND s."user_id" = $2${whereDeviceSql}
        ORDER BY s."updated_at" DESC
        LIMIT 1`,
        ...stateParams,
      );

      const summary = Array.isArray(stateRows) && stateRows.length ? stateRows[0] : null;
      if (!summary) throw createError(404, "Resumo do usuário não encontrado");

      const historyLimit = Math.min(200, Math.max(1, parseIntSafe(req.query?.historyLimit, 30)));
      const historyParams = [String(clientId), userId];
      let historyDeviceSql = "";
      if (summary.esp32DeviceId) {
        historyParams.push(String(summary.esp32DeviceId));
        historyDeviceSql = ` AND COALESCE(e."esp32_device_id", '') = $${historyParams.length}`;
      }
      historyParams.push(historyLimit);

      const historyRows = await prisma.$queryRawUnsafe(
        `SELECT
          e."id",
          e."created_at" AS "createdAt",
          e."state",
          e."method",
          e."action",
          e."result",
          e."created_by" AS "createdBy",
          e."used_by" AS "usedBy",
          e."metadata"
        FROM "trust_center_event" e
        WHERE e."client_id" = $1 AND e."user_id" = $2${historyDeviceSql}
        ORDER BY e."created_at" DESC
        LIMIT $${historyParams.length}`,
        ...historyParams,
      );

      res.json({
        summary,
        history: normalizeRowMetadata(Array.isArray(historyRows) ? historyRows : []),
      });
    } catch (error) {
      next(error);
    }
  },
);

router.get(
  "/trust-center/users/:userId/history",
  authorizeTrustPermission(TRUST_PERMISSIONS.view),
  async (req, res, next) => {
    try {
      ensurePrisma();
      const clientId = resolveClientId(req, req.query?.clientId, { required: true });
      const userId = String(req.params.userId || "").trim();
      if (!userId) throw createError(400, "userId obrigatório");

      const where = [`e."client_id" = $1`, `e."user_id" = $2`];
      const params = [String(clientId), userId];

      addFilter(where, params, `COALESCE(e."esp32_device_id", '') = ?`, req.query.esp32DeviceId);
      addFilter(where, params, `COALESCE(e."result", '') ILIKE ?`, req.query.result, (v) => `%${v}%`);
      addFilter(where, params, `COALESCE(e."action", '') ILIKE ?`, req.query.action, (v) => `%${v}%`);

      const whereSql = where.join(" AND ");
      const { page, pageSize, offset } = resolvePagination(req.query, { defaultPageSize: 20, maxPageSize: 100 });

      const countRows = await prisma.$queryRawUnsafe(
        `SELECT COUNT(*)::int AS total FROM "trust_center_event" e WHERE ${whereSql}`,
        ...params,
      );
      const total = Number(countRows?.[0]?.total || 0);

      const rows = await prisma.$queryRawUnsafe(
        `SELECT
          e."id",
          e."created_at" AS "createdAt",
          e."state",
          e."method",
          e."action",
          e."result",
          e."created_by" AS "createdBy",
          e."used_by" AS "usedBy",
          e."metadata"
        FROM "trust_center_event" e
        WHERE ${whereSql}
        ORDER BY e."created_at" DESC
        LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        ...params,
        pageSize,
        offset,
      );

      res.json({
        rows: normalizeRowMetadata(Array.isArray(rows) ? rows : []),
        pagination: {
          page,
          pageSize,
          total,
          totalPages: Math.max(1, Math.ceil(total / pageSize)),
        },
      });
    } catch (error) {
      next(error);
    }
  },
);

router.get(
  "/trust-center/activity",
  authorizeTrustPermission(TRUST_PERMISSIONS.auditView),
  async (req, res, next) => {
    try {
      ensurePrisma();
      const clientId = resolveClientId(req, req.query?.clientId, { required: true });
      const payload = await buildActivityRows({ clientId, query: req.query, includePagination: true });
      res.json({
        rows: payload.rows,
        pagination: payload.pagination,
      });
    } catch (error) {
      next(error);
    }
  },
);

router.get(
  "/trust-center/audit",
  authorizeTrustPermission(TRUST_PERMISSIONS.auditView),
  async (req, res, next) => {
    try {
      ensurePrisma();
      const clientId = resolveClientId(req, req.query?.clientId, { required: true });
      const payload = await buildActivityRows({ clientId, query: req.query, includePagination: true });
      res.json({
        rows: payload.rows,
        pagination: payload.pagination,
      });
    } catch (error) {
      next(error);
    }
  },
);

router.get(
  "/trust-center/activity/export",
  authorizeTrustPermission(TRUST_PERMISSIONS.auditView),
  async (req, res, next) => {
    try {
      ensurePrisma();
      const clientId = resolveClientId(req, req.query?.clientId, { required: true });
      const payload = await buildActivityRows({
        clientId,
        query: { ...req.query, pageSize: 5000, page: 1 },
        includePagination: false,
      });

      const headers = [
        "data",
        "usuario",
        "perfil",
        "cliente",
        "veiculo",
        "dispositivo",
        "metodo",
        "acao",
        "resultado",
        "created_by",
        "used_by",
      ];
      const esp32Headers = new Set();
      payload.rows.forEach((row) => {
        const columns = parseJsonObject(row.esp32Columns);
        Object.keys(columns).forEach((key) => {
          if (String(key || "").toLowerCase().startsWith("esp32_")) {
            esp32Headers.add(key);
          }
        });
      });
      const sortedEsp32Headers = Array.from(esp32Headers).sort((a, b) => a.localeCompare(b));

      const lines = [[...headers, ...sortedEsp32Headers].join(",")];
      payload.rows.forEach((row) => {
        const esp32Columns = parseJsonObject(row.esp32Columns);
        lines.push(
          [
            row.createdAt,
            row.userName,
            row.userRole,
            row.clientName,
            row.vehiclePlate || row.vehicleName,
            row.esp32DeviceId,
            row.method,
            row.action,
            row.result,
            row.createdBy,
            row.usedBy,
            ...sortedEsp32Headers.map((columnKey) => esp32Columns[columnKey] ?? ""),
          ]
            .map(escapeCsvCell)
            .join(","),
        );
      });

      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename=trust-center-activity-${Date.now()}.csv`);
      res.send(lines.join("\n"));
    } catch (error) {
      next(error);
    }
  },
);

router.get(
  "/trust-center/counter-keys",
  authorizeTrustPermission(TRUST_PERMISSIONS.manageCounterKey),
  async (req, res, next) => {
    try {
      ensurePrisma();
      const clientId = resolveClientId(req, req.query?.clientId, { required: true });
      const where = [`k."client_id" = $1`];
      const params = [String(clientId)];

      const userFilter = String(req.query.user || "").trim();
      if (userFilter) {
        params.push(`%${userFilter}%`);
        const p1 = `$${params.length}`;
        params.push(`%${userFilter}%`);
        const p2 = `$${params.length}`;
        where.push(`(COALESCE(u."name", '') ILIKE ${p1} OR COALESCE(k."user_id", '') ILIKE ${p2})`);
      }
      const vehicleFilter = String(req.query.vehicle || "").trim();
      if (vehicleFilter) {
        params.push(`%${vehicleFilter}%`);
        const v1 = `$${params.length}`;
        params.push(`%${vehicleFilter}%`);
        const v2 = `$${params.length}`;
        where.push(`(COALESCE(v."name", '') ILIKE ${v1} OR COALESCE(v."plate", '') ILIKE ${v2})`);
      }
      addFilter(where, params, `COALESCE(k."esp32_device_id", '') ILIKE ?`, req.query.device, (v) => `%${v}%`);
      addFilter(where, params, `COALESCE(k."status", '') ILIKE ?`, req.query.status, (v) => `%${v}%`);

      const whereSql = where.join(" AND ");
      const { page, pageSize, offset } = resolvePagination(req.query, { defaultPageSize: 20, maxPageSize: 200 });
      const orderBy = resolveCounterKeySort(req.query.sortBy, req.query.sortDir);

      const countRows = await prisma.$queryRawUnsafe(
        `SELECT COUNT(*)::int AS total
         FROM "trust_center_counter_key" k
         LEFT JOIN "User" u ON u."id" = k."user_id"
         LEFT JOIN "Vehicle" v ON v."id" = k."vehicle_id"
         WHERE ${whereSql}`,
        ...params,
      );

      const total = Number(countRows?.[0]?.total || 0);

      const rows = await prisma.$queryRawUnsafe(
        `SELECT
          k."id",
          k."client_id" AS "clientId",
          k."user_id" AS "userId",
          k."vehicle_id" AS "vehicleId",
          k."esp32_device_id" AS "esp32DeviceId",
          k."counter_key" AS "counterKey",
          k."status",
          k."uses_count" AS "usesCount",
          k."max_uses" AS "maxUses",
          k."expires_at" AS "expiresAt",
          k."first_used_at" AS "firstUsedAt",
          k."last_used_at" AS "lastUsedAt",
          k."created_by" AS "createdBy",
          k."used_by" AS "usedBy",
          k."created_at" AS "createdAt",
          k."updated_at" AS "updatedAt",
          u."name" AS "userName",
          v."name" AS "vehicleName",
          v."plate" AS "vehiclePlate",
          c."name" AS "clientName"
        FROM "trust_center_counter_key" k
        LEFT JOIN "User" u ON u."id" = k."user_id"
        LEFT JOIN "Vehicle" v ON v."id" = k."vehicle_id"
        LEFT JOIN "Client" c ON c."id" = k."client_id"
        WHERE ${whereSql}
        ORDER BY ${orderBy}
        LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        ...params,
        pageSize,
        offset,
      );

      const output = (Array.isArray(rows) ? rows : []).map((row) => ({
        ...row,
        basePasswordMasked: "******",
      }));

      res.json({
        rows: output,
        pagination: {
          page,
          pageSize,
          total,
          totalPages: Math.max(1, Math.ceil(total / pageSize)),
        },
      });
    } catch (error) {
      next(error);
    }
  },
);

router.post(
  "/trust-center/counter-keys",
  authorizeTrustPermission(TRUST_PERMISSIONS.manageCounterKey),
  async (req, res, next) => {
    try {
      ensurePrisma();
      const clientId = resolveClientId(req, req.body?.clientId, { required: true });
      const userId = String(req.body?.userId || "").trim();
      const vehicleIdRaw = String(req.body?.vehicleId || "").trim();
      const vehicleId = vehicleIdRaw || null;
      const esp32DeviceId = String(req.body?.esp32DeviceId || "").trim();
      const password = normalizeSixDigitPassword(req.body?.password);

      if (!userId) throw createError(400, "userId é obrigatório");
      if (!esp32DeviceId) throw createError(400, "dispositivo ESP32 é obrigatório");
      if (!password) throw createError(422, "senha base deve ter 6 dígitos");

      const user = await resolveClientUser({ clientId, userId });
      if (!user) throw createError(404, "Usuário não encontrado para o cliente");

      if (vehicleId) {
        const vehicle = await resolveClientVehicle({ clientId, vehicleId });
        if (!vehicle) throw createError(404, "Veículo não encontrado para o cliente");
      }

      const config = resolveTrustCenterConfig();
      const stateRows = await prisma.$queryRawUnsafe(
        `SELECT "challenge" FROM "trust_center_user_state"
         WHERE "client_id" = $1 AND "user_id" = $2 AND "esp32_device_id" = $3
         LIMIT 1`,
        String(clientId),
        userId,
        esp32DeviceId,
      );
      const challenge = String(stateRows?.[0]?.challenge || "").trim() || generateChallenge(config.challengeSize);

      const counterKey = generateCounterKey({
        clientId,
        userId,
        vehicleId,
        esp32DeviceId,
        challenge,
        basePassword: password,
        secret: config.secret,
        digits: config.counterDigits,
      });

      const hashBundle = hashBasePassword(password);
      if (!hashBundle) throw createError(422, "senha base inválida");

      const createdAt = new Date();
      const expiresAt = computeExpiresAt(createdAt, config.counterKeyTtlMinutes);

      const createdRows = await prisma.$queryRawUnsafe(
        `INSERT INTO "trust_center_counter_key" (
          "id", "client_id", "user_id", "vehicle_id", "esp32_device_id", "base_password_hash", "base_password_salt", "counter_key", "status", "uses_count", "max_uses", "expires_at", "created_by", "metadata", "created_at", "updated_at"
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,0,$10,$11,$12,$13::jsonb,$14,$14
        )
        RETURNING
          "id",
          "client_id" AS "clientId",
          "user_id" AS "userId",
          "vehicle_id" AS "vehicleId",
          "esp32_device_id" AS "esp32DeviceId",
          "counter_key" AS "counterKey",
          "status",
          "uses_count" AS "usesCount",
          "max_uses" AS "maxUses",
          "expires_at" AS "expiresAt",
          "created_by" AS "createdBy",
          "created_at" AS "createdAt"`,
        randomUUID(),
        String(clientId),
        userId,
        vehicleId,
        esp32DeviceId,
        hashBundle.hash,
        hashBundle.salt,
        counterKey,
        TRUST_CENTER_COUNTER_STATUS.ACTIVE,
        config.counterKeyMaxUses,
        expiresAt.toISOString(),
        String(req.user?.id || ""),
        JSON.stringify({
          challenge,
          generatedByRole: req.user?.role || null,
        }),
        createdAt.toISOString(),
      );

      await upsertTrustUserState({
        clientId,
        userId,
        vehicleId,
        esp32DeviceId,
        statusState: TRUST_CENTER_STATES.TRYING,
        challenge,
        validationMethod: "COUNTER_KEY",
        lastResult: "GENERATED",
        lastActionType: "COUNTER_KEY_GENERATED",
        lastPasswordLast6: maskPasswordLast6(password),
        markAttempt: true,
      });

      await recordTrustEvent({
        clientId,
        userId,
        vehicleId,
        esp32DeviceId,
        state: TRUST_CENTER_STATES.TRYING,
        method: "COUNTER_KEY",
        action: "COUNTER_KEY_GENERATED",
        result: "SUCCESS",
        createdBy: String(req.user?.id || ""),
        ipAddress: req.ip,
        metadata: {
          maxUses: config.counterKeyMaxUses,
          expiresAt: expiresAt.toISOString(),
          challenge,
        },
      });

      const created = Array.isArray(createdRows) && createdRows.length ? createdRows[0] : null;
      res.status(201).json({
        item: {
          ...created,
          basePasswordMasked: "******",
          challenge,
        },
      });
    } catch (error) {
      next(error);
    }
  },
);

router.post(
  "/trust-center/counter-keys/use",
  authorizeTrustPermission(TRUST_PERMISSIONS.manageCounterKey),
  async (req, res, next) => {
    try {
      ensurePrisma();
      const clientId = resolveClientId(req, req.body?.clientId, { required: true });
      const counterKey = String(req.body?.counterKey || "").trim();
      if (!counterKey) throw createError(400, "counterKey é obrigatório");

      const rows = await prisma.$queryRawUnsafe(
        `SELECT *
         FROM "trust_center_counter_key"
         WHERE "client_id" = $1 AND "counter_key" = $2
         ORDER BY "created_at" DESC
         LIMIT 1`,
        String(clientId),
        counterKey,
      );
      const record = Array.isArray(rows) && rows.length ? rows[0] : null;
      if (!record) throw createError(404, "Contra-senha não encontrada");

      if (String(record.status || "").toUpperCase() === TRUST_CENTER_COUNTER_STATUS.CANCELED) {
        throw createError(409, "Contra-senha cancelada");
      }

      const expired = isCounterKeyExpired(record, new Date());
      if (expired) {
        await prisma.$executeRawUnsafe(
          `UPDATE "trust_center_counter_key"
           SET "status" = $2, "updated_at" = NOW()
           WHERE "id" = $1`,
          String(record.id),
          TRUST_CENTER_COUNTER_STATUS.EXPIRED,
        );
        throw createError(409, "Contra-senha expirada");
      }

      const nextUses = Number(record.uses_count || 0) + 1;
      const maxUses = Number(record.max_uses || 1);
      const newStatus = nextUses >= maxUses ? TRUST_CENTER_COUNTER_STATUS.EXPIRED : TRUST_CENTER_COUNTER_STATUS.ACTIVE;
      const usedBy = String(req.body?.usedBy || req.user?.id || "").trim() || null;

      const updatedRows = await prisma.$queryRawUnsafe(
        `UPDATE "trust_center_counter_key"
         SET
           "uses_count" = $2,
           "status" = $3,
           "first_used_at" = COALESCE("first_used_at", NOW()),
           "last_used_at" = NOW(),
           "used_by" = $4,
           "updated_at" = NOW()
         WHERE "id" = $1
         RETURNING
           "id",
           "client_id" AS "clientId",
           "user_id" AS "userId",
           "vehicle_id" AS "vehicleId",
           "esp32_device_id" AS "esp32DeviceId",
           "counter_key" AS "counterKey",
           "status",
           "uses_count" AS "usesCount",
           "max_uses" AS "maxUses",
           "first_used_at" AS "firstUsedAt",
           "last_used_at" AS "lastUsedAt",
           "used_by" AS "usedBy",
           "expires_at" AS "expiresAt",
           "created_at" AS "createdAt"`,
        String(record.id),
        nextUses,
        newStatus,
        usedBy,
      );

      await upsertTrustUserState({
        clientId,
        userId: String(record.user_id),
        vehicleId: record.vehicle_id ? String(record.vehicle_id) : null,
        esp32DeviceId: String(record.esp32_device_id || ""),
        statusState: TRUST_CENTER_STATES.ACCESS_REGISTERED,
        validationMethod: "COUNTER_KEY",
        lastResult: "USED",
        lastActionType: "COUNTER_KEY_USED",
        markAccess: true,
      });

      await recordTrustEvent({
        clientId,
        userId: String(record.user_id),
        vehicleId: record.vehicle_id ? String(record.vehicle_id) : null,
        esp32DeviceId: String(record.esp32_device_id || ""),
        state: TRUST_CENTER_STATES.ACCESS_REGISTERED,
        method: "COUNTER_KEY",
        action: "COUNTER_KEY_USED",
        result: "SUCCESS",
        createdBy: String(req.user?.id || ""),
        usedBy,
        ipAddress: req.ip,
        metadata: {
          counterKeyId: String(record.id),
          nextUses,
          maxUses,
          status: newStatus,
        },
      });

      res.json({
        item: {
          ...(Array.isArray(updatedRows) && updatedRows.length ? updatedRows[0] : null),
          basePasswordMasked: "******",
        },
      });
    } catch (error) {
      next(error);
    }
  },
);

router.post(
  "/trust-center/counter-keys/:id/cancel",
  authorizeTrustPermission(TRUST_PERMISSIONS.manageCounterKey),
  async (req, res, next) => {
    try {
      ensurePrisma();
      const clientId = resolveClientId(req, req.body?.clientId || req.query?.clientId, { required: true });
      const id = String(req.params.id || "").trim();
      if (!id) throw createError(400, "id é obrigatório");

      const rows = await prisma.$queryRawUnsafe(
        `UPDATE "trust_center_counter_key"
         SET "status" = $2, "updated_at" = NOW(), "used_by" = COALESCE("used_by", $3)
         WHERE "id" = $1 AND "client_id" = $4
         RETURNING "id", "user_id", "vehicle_id", "esp32_device_id"`,
        id,
        TRUST_CENTER_COUNTER_STATUS.CANCELED,
        String(req.user?.id || ""),
        String(clientId),
      );

      const updated = Array.isArray(rows) && rows.length ? rows[0] : null;
      if (!updated) throw createError(404, "Contra-senha não encontrada");

      await recordTrustEvent({
        clientId,
        userId: updated.user_id ? String(updated.user_id) : null,
        vehicleId: updated.vehicle_id ? String(updated.vehicle_id) : null,
        esp32DeviceId: updated.esp32_device_id ? String(updated.esp32_device_id) : null,
        state: null,
        method: "COUNTER_KEY",
        action: "COUNTER_KEY_CANCELED",
        result: "SUCCESS",
        createdBy: String(req.user?.id || ""),
        ipAddress: req.ip,
        metadata: {
          counterKeyId: id,
        },
      });

      res.json({ ok: true, id });
    } catch (error) {
      next(error);
    }
  },
);

router.post(
  "/trust-center/challenge/rotate",
  authorizeTrustPermission(TRUST_PERMISSIONS.manageCounterKey),
  async (req, res, next) => {
    try {
      ensurePrisma();
      const clientId = resolveClientId(req, req.body?.clientId, { required: true });
      const userId = String(req.body?.userId || "").trim();
      const vehicleIdRaw = String(req.body?.vehicleId || "").trim();
      const vehicleId = vehicleIdRaw || null;
      const esp32DeviceId = String(req.body?.esp32DeviceId || "").trim();

      if (!userId) throw createError(400, "userId é obrigatório");
      if (!esp32DeviceId) throw createError(400, "dispositivo ESP32 é obrigatório");

      const user = await resolveClientUser({ clientId, userId });
      if (!user) throw createError(404, "Usuário não encontrado para o cliente");

      if (vehicleId) {
        const vehicle = await resolveClientVehicle({ clientId, vehicleId });
        if (!vehicle) throw createError(404, "Veículo não encontrado para o cliente");
      }

      const config = resolveTrustCenterConfig();
      const challenge = generateChallenge(config.challengeSize);

      await upsertTrustUserState({
        clientId,
        userId,
        vehicleId,
        esp32DeviceId,
        statusState: TRUST_CENTER_STATES.TRYING,
        challenge,
        validationMethod: "CHALLENGE",
        lastResult: "ROTATED",
        lastActionType: "CHALLENGE_ROTATED",
        markAttempt: true,
      });

      await recordTrustEvent({
        clientId,
        userId,
        vehicleId,
        esp32DeviceId,
        state: TRUST_CENTER_STATES.TRYING,
        method: "CHALLENGE",
        action: "CHALLENGE_ROTATED",
        result: "SUCCESS",
        createdBy: String(req.user?.id || ""),
        ipAddress: req.ip,
        metadata: {
          challenge,
        },
      });

      res.json({ challenge, userId, esp32DeviceId });
    } catch (error) {
      next(error);
    }
  },
);

router.post(
  "/trust-center/counter-keys/simulate",
  authorizeTrustPermission(TRUST_PERMISSIONS.manageCounterKey),
  async (req, res, next) => {
    try {
      ensurePrisma();
      const clientId = resolveClientId(req, req.body?.clientId, { required: true });
      const userId = String(req.body?.userId || "").trim();
      const vehicleIdRaw = String(req.body?.vehicleId || "").trim();
      const vehicleId = vehicleIdRaw || null;
      const esp32DeviceId = String(req.body?.esp32DeviceId || "").trim();
      const password = normalizeSixDigitPassword(req.body?.password);

      if (!userId) throw createError(400, "userId é obrigatório");
      if (!esp32DeviceId) throw createError(400, "dispositivo ESP32 é obrigatório");
      if (!password) throw createError(422, "senha base deve ter 6 dígitos");

      const config = resolveTrustCenterConfig();
      const challenge = String(req.body?.challenge || "").trim() || generateChallenge(config.challengeSize);
      const counterKey = generateCounterKey({
        clientId,
        userId,
        vehicleId,
        esp32DeviceId,
        challenge,
        basePassword: password,
        secret: config.secret,
        digits: config.counterDigits,
      });

      await recordTrustEvent({
        clientId,
        userId,
        vehicleId,
        esp32DeviceId,
        state: TRUST_CENTER_STATES.TRYING,
        method: "SIMULATION",
        action: "COUNTER_KEY_SIMULATED",
        result: "SUCCESS",
        createdBy: String(req.user?.id || ""),
        ipAddress: req.ip,
        metadata: {
          challenge,
        },
      });

      res.json({
        challenge,
        counterKey,
      });
    } catch (error) {
      next(error);
    }
  },
);

export default router;
