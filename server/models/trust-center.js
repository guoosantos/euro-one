import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";

import { listDevices } from "./device.js";
import { listUsers } from "./user.js";
import { listVehicles } from "./vehicle.js";
import { loadCollection, saveCollection } from "../services/storage.js";
import { recordAuditEvent } from "../services/audit-log.js";

const USER_ACCESS_STORAGE_KEY = "trust-center-user-access";
const ACTIVITY_STORAGE_KEY = "trust-center-activity";
const COUNTER_KEY_STORAGE_KEY = "trust-center-counter-keys";
const AUDIT_STORAGE_KEY = "trust-center-audit";

const USER_STATE_PRIORITY = {
  ONLINE: 0,
  TENTANDO: 1,
  ACESSO_REGISTRADO: 2,
};

const USER_STATE_VALUES = new Set(Object.keys(USER_STATE_PRIORITY));
const COUNTER_KEY_STATUS = new Set(["ATIVA", "USADA", "CANCELADA", "EXPIRADA"]);
const MAX_ACTIVITY_ROWS = Number(process.env.TRUST_CENTER_MAX_ACTIVITY_ROWS) || 50_000;
const MAX_AUDIT_ROWS = Number(process.env.TRUST_CENTER_MAX_AUDIT_ROWS) || 20_000;
const COUNTER_KEY_TTL_MINUTES = Number(process.env.TRUST_CENTER_COUNTER_KEY_TTL_MINUTES) || 60;
const COUNTER_KEY_MAX_USES = Number(process.env.TRUST_CENTER_COUNTER_KEY_MAX_USES) || 1;

const TRUST_CENTER_SECRET =
  process.env.TRUST_CENTER_SECRET ||
  process.env.JWT_SECRET ||
  "trust-center-local-secret";

let userAccessRows = Array.isArray(loadCollection(USER_ACCESS_STORAGE_KEY, []))
  ? loadCollection(USER_ACCESS_STORAGE_KEY, [])
  : [];
let activityRows = Array.isArray(loadCollection(ACTIVITY_STORAGE_KEY, []))
  ? loadCollection(ACTIVITY_STORAGE_KEY, [])
  : [];
let counterKeyRows = Array.isArray(loadCollection(COUNTER_KEY_STORAGE_KEY, []))
  ? loadCollection(COUNTER_KEY_STORAGE_KEY, [])
  : [];
let auditRows = Array.isArray(loadCollection(AUDIT_STORAGE_KEY, []))
  ? loadCollection(AUDIT_STORAGE_KEY, [])
  : [];

function clone(value) {
  if (value === null || value === undefined) return value;
  return JSON.parse(JSON.stringify(value));
}

function nowIso() {
  return new Date().toISOString();
}

function normalizeId(value) {
  if (value === null || value === undefined) return null;
  const normalized = String(value).trim();
  return normalized || null;
}

function normalizeText(value, fallback = "") {
  const normalized = String(value || "").trim();
  return normalized || fallback;
}

function normalizeState(value, fallback = "TENTANDO") {
  const normalized = String(value || "").trim().toUpperCase();
  if (USER_STATE_VALUES.has(normalized)) return normalized;
  return fallback;
}

function normalizeStatus(value, fallback = "ATIVA") {
  const normalized = String(value || "").trim().toUpperCase();
  if (COUNTER_KEY_STATUS.has(normalized)) return normalized;
  return fallback;
}

function normalizeSortDir(value, fallback = "desc") {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized === "asc" ? "asc" : fallback;
}

function toTimeMs(value) {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseList(value) {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeId(item)).filter(Boolean);
  }
  if (value === null || value === undefined || value === "") return [];
  return String(value)
    .split(",")
    .map((entry) => normalizeId(entry))
    .filter(Boolean);
}

function hashSecret(secret, salt) {
  return createHash("sha256").update(`${salt}:${secret}`).digest("hex");
}

function buildSecretHash(secret) {
  const salt = randomBytes(12).toString("hex");
  const hash = hashSecret(secret, salt);
  return { salt, hash };
}

function verifySecret(secret, salt, expectedHash) {
  if (!secret || !salt || !expectedHash) return false;
  return hashSecret(secret, salt) === expectedHash;
}

function randomChallenge() {
  return randomBytes(4).toString("hex").toUpperCase();
}

function randomPassword6() {
  return String(Math.floor(Math.random() * 1_000_000)).padStart(6, "0");
}

function maskPassword(password) {
  const normalized = String(password || "");
  if (normalized.length < 2) return "******";
  return `****${normalized.slice(-2)}`;
}

function resolveCounterKey(basePassword, challenge, context = "") {
  const hmac = createHmac("sha256", TRUST_CENTER_SECRET)
    .update(`${String(basePassword)}:${String(challenge)}:${String(context)}`)
    .digest("hex");
  const numeric = Number.parseInt(hmac.slice(0, 12), 16) % 1_000_000;
  return String(numeric).padStart(6, "0");
}

function persistUserAccess() {
  saveCollection(USER_ACCESS_STORAGE_KEY, userAccessRows);
}

function persistActivity() {
  saveCollection(ACTIVITY_STORAGE_KEY, activityRows);
}

function persistCounterKeys() {
  saveCollection(COUNTER_KEY_STORAGE_KEY, counterKeyRows);
}

function persistAudit() {
  saveCollection(AUDIT_STORAGE_KEY, auditRows);
}

function trimCollection(list, maxRows) {
  if (!Array.isArray(list)) return [];
  if (list.length <= maxRows) return list;
  return list.slice(0, maxRows);
}

function resolveActor(actor = {}) {
  return {
    id: normalizeId(actor.id),
    name: normalizeText(actor.name || actor.username || actor.email || "Sistema", "Sistema"),
  };
}

function findUserNameById(userId) {
  if (!userId) return "";
  const normalizedId = String(userId);
  const match = userAccessRows.find((row) => String(row.userId || "") === normalizedId);
  return match?.userName || "";
}

function findVehicleInfoById(clientId, vehicleId) {
  if (!vehicleId) return { vehicleId: null, vehicleLabel: null };
  const vehicle = listVehicles({ clientId }).find((entry) => String(entry.id) === String(vehicleId));
  return {
    vehicleId: vehicle?.id ? String(vehicle.id) : String(vehicleId),
    vehicleLabel: vehicle?.plate || vehicle?.model || vehicle?.name || null,
  };
}

function findDeviceInfoById(clientId, deviceId) {
  if (!deviceId) return { deviceId: null, deviceLabel: null };
  const device = listDevices({ clientId }).find((entry) => String(entry.id) === String(deviceId));
  return {
    deviceId: device?.id ? String(device.id) : String(deviceId),
    deviceLabel: device?.name || device?.uniqueId || null,
  };
}

function decorateResultLabel(value) {
  const normalized = String(value || "").trim().toUpperCase();
  if (!normalized) return "SEM_RESULTADO";
  return normalized;
}

function registerActivity({
  clientId,
  userId = null,
  userName = null,
  profile = null,
  vehicleId = null,
  vehicleLabel = null,
  deviceId = null,
  deviceLabel = null,
  method = null,
  action = null,
  result = null,
  actionType = null,
  esp32 = null,
  createdBy = null,
  usedBy = null,
  details = null,
} = {}) {
  const timestamp = nowIso();
  const payload = {
    id: randomUUID(),
    clientId: normalizeId(clientId),
    date: timestamp,
    userId: normalizeId(userId),
    userName: normalizeText(userName),
    profile: normalizeText(profile),
    client: normalizeText(clientId),
    vehicleId: normalizeId(vehicleId),
    vehicle: normalizeText(vehicleLabel),
    deviceId: normalizeId(deviceId),
    device: normalizeText(deviceLabel),
    method: normalizeText(method, "ESP32"),
    action: normalizeText(action, "AÇÃO_DESCONHECIDA"),
    result: decorateResultLabel(result),
    actionType: normalizeText(actionType),
    esp32: esp32 && typeof esp32 === "object" ? clone(esp32) : null,
    created_by: normalizeId(createdBy?.id),
    created_by_name: normalizeText(createdBy?.name),
    used_by: normalizeId(usedBy?.id),
    used_by_name: normalizeText(usedBy?.name),
    details: details && typeof details === "object" ? clone(details) : null,
  };

  activityRows = [payload, ...activityRows];
  activityRows = trimCollection(activityRows, MAX_ACTIVITY_ROWS);
  persistActivity();

  return payload;
}

function registerTrustCenterAudit({
  clientId,
  action,
  result,
  actor,
  userId,
  vehicleId,
  deviceId,
  details,
} = {}) {
  const audit = {
    id: randomUUID(),
    timestamp: nowIso(),
    clientId: normalizeId(clientId),
    action: normalizeText(action, "TRUST_CENTER_EVENT"),
    result: decorateResultLabel(result),
    actorId: normalizeId(actor?.id),
    actorName: normalizeText(actor?.name || "Sistema", "Sistema"),
    userId: normalizeId(userId),
    vehicleId: normalizeId(vehicleId),
    deviceId: normalizeId(deviceId),
    details: details && typeof details === "object" ? clone(details) : null,
  };

  auditRows = [audit, ...auditRows];
  auditRows = trimCollection(auditRows, MAX_AUDIT_ROWS);
  persistAudit();

  recordAuditEvent({
    clientId,
    vehicleId,
    deviceId,
    category: "trust_center",
    action: audit.action,
    status: audit.result,
    user: {
      id: audit.actorId,
      name: audit.actorName,
    },
    details: audit.details,
  });

  return audit;
}

function defaultSortForState(entry) {
  const state = normalizeState(entry?.state, "TENTANDO");
  if (state === "ONLINE") return toTimeMs(entry?.lastHeartbeatAt);
  if (state === "TENTANDO") return toTimeMs(entry?.lastAttemptAt);
  return toTimeMs(entry?.lastAccessAt);
}

function userRowSorter(left, right) {
  const leftState = normalizeState(left?.state, "TENTANDO");
  const rightState = normalizeState(right?.state, "TENTANDO");
  const stateDiff = (USER_STATE_PRIORITY[leftState] ?? 99) - (USER_STATE_PRIORITY[rightState] ?? 99);
  if (stateDiff !== 0) return stateDiff;

  const timeDiff = defaultSortForState(right) - defaultSortForState(left);
  if (timeDiff !== 0) return timeDiff;
  return String(left?.userName || "").localeCompare(String(right?.userName || ""), "pt-BR");
}

function sortRows(rows, sortBy, sortDir = "desc") {
  const direction = normalizeSortDir(sortDir, "desc") === "asc" ? 1 : -1;
  const key = normalizeText(sortBy).toLowerCase();

  if (!key) {
    return [...rows].sort(userRowSorter);
  }

  const accessor = (row) => {
    if (key === "state") return USER_STATE_PRIORITY[normalizeState(row?.state, "TENTANDO")] ?? 99;
    if (key === "heartbeat") return toTimeMs(row?.lastHeartbeatAt);
    if (key === "attempt") return toTimeMs(row?.lastAttemptAt);
    if (key === "access") return toTimeMs(row?.lastAccessAt);
    if (key === "updatedat") return toTimeMs(row?.updatedAt);
    return String(row?.[sortBy] || row?.[key] || "").toLowerCase();
  };

  return [...rows].sort((left, right) => {
    const leftValue = accessor(left);
    const rightValue = accessor(right);
    if (typeof leftValue === "number" && typeof rightValue === "number") {
      return (leftValue - rightValue) * direction;
    }
    return String(leftValue).localeCompare(String(rightValue), "pt-BR") * direction;
  });
}

function paginate(rows, page = 1, pageSize = 20) {
  const currentPage = Math.max(1, Number(page) || 1);
  const normalizedPageSize = Math.max(1, Number(pageSize) || 20);
  const start = (currentPage - 1) * normalizedPageSize;
  const end = start + normalizedPageSize;
  const sliced = rows.slice(start, end);
  const total = rows.length;
  return {
    data: sliced.map(clone),
    page: currentPage,
    pageSize: normalizedPageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / normalizedPageSize)),
  };
}

function ensureCounterKeyStatus(entry) {
  if (!entry) return null;
  const now = Date.now();
  const expiresAtMs = toTimeMs(entry.expiresAt);
  const maxUses = Number(entry.maxUses || COUNTER_KEY_MAX_USES);
  const usesCount = Number(entry.usesCount || 0);

  if (entry.status === "CANCELADA") return entry;

  if (expiresAtMs > 0 && now > expiresAtMs) {
    entry.status = "EXPIRADA";
    return entry;
  }

  if (maxUses > 0 && usesCount >= maxUses) {
    entry.status = "USADA";
    return entry;
  }

  entry.status = "ATIVA";
  return entry;
}

function applyActivityFilters(rows, filters = {}) {
  const fromMs = toTimeMs(filters?.from || filters?.dateFrom);
  const toMs = toTimeMs(filters?.to || filters?.dateTo);
  const userFilter = normalizeText(filters?.user).toLowerCase();
  const clientFilter = normalizeText(filters?.client).toLowerCase();
  const vehicleFilter = normalizeText(filters?.vehicle).toLowerCase();
  const deviceFilter = normalizeText(filters?.device).toLowerCase();
  const methodFilter = normalizeText(filters?.method).toLowerCase();
  const resultFilter = normalizeText(filters?.result).toLowerCase();

  return rows.filter((row) => {
    const rowMs = toTimeMs(row?.date);
    if (fromMs && rowMs < fromMs) return false;
    if (toMs && rowMs > toMs) return false;
    if (userFilter && !String(row?.userName || "").toLowerCase().includes(userFilter)) return false;
    if (clientFilter && !String(row?.client || "").toLowerCase().includes(clientFilter)) return false;
    if (vehicleFilter && !String(row?.vehicle || "").toLowerCase().includes(vehicleFilter)) return false;
    if (deviceFilter && !String(row?.device || "").toLowerCase().includes(deviceFilter)) return false;
    if (methodFilter && !String(row?.method || "").toLowerCase().includes(methodFilter)) return false;
    if (resultFilter && !String(row?.result || "").toLowerCase().includes(resultFilter)) return false;
    return true;
  });
}

function ensureEsp32Columns(rows) {
  const dynamicColumns = new Set();
  rows.forEach((row) => {
    if (!row?.esp32 || typeof row.esp32 !== "object") return;
    Object.keys(row.esp32).forEach((key) => dynamicColumns.add(key));
  });
  return Array.from(dynamicColumns.values());
}

async function ensureClientSeed(clientId) {
  const normalizedClientId = normalizeId(clientId);
  if (!normalizedClientId) return;

  const hasRows = userAccessRows.some((row) => String(row.clientId) === normalizedClientId);
  if (hasRows) return;

  const users = await listUsers({ clientId: normalizedClientId }).catch(() => []);
  const devices = listDevices({ clientId: normalizedClientId });
  const vehicles = listVehicles({ clientId: normalizedClientId });

  const sourceUsers = Array.isArray(users) ? users.slice(0, 8) : [];
  const sourceDevices = Array.isArray(devices) ? devices : [];
  const sourceVehicles = Array.isArray(vehicles) ? vehicles : [];

  if (!sourceUsers.length && !sourceDevices.length) {
    return;
  }

  const generated = sourceUsers.map((user, index) => {
    const state = ["ONLINE", "TENTANDO", "ACESSO_REGISTRADO"][index % 3];
    const device = sourceDevices[index % (sourceDevices.length || 1)] || null;
    const vehicle = sourceVehicles[index % (sourceVehicles.length || 1)] || null;
    const accessPassword = randomPassword6();
    const passwordHash = buildSecretHash(accessPassword);
    const timestamp = new Date(Date.now() - index * 10 * 60 * 1000).toISOString();

    return {
      id: randomUUID(),
      clientId: normalizedClientId,
      userId: normalizeId(user?.id),
      userName: normalizeText(user?.name || user?.username || user?.email || `Usuário ${index + 1}`),
      profile: normalizeText(user?.role || "user"),
      clientName: normalizeText(user?.attributes?.companyName || normalizedClientId),
      deviceId: normalizeId(device?.id),
      esp32Device: normalizeText(device?.name || device?.uniqueId || `ESP32-${index + 1}`),
      vehicleId: normalizeId(vehicle?.id),
      vehicleLabel: normalizeText(vehicle?.plate || vehicle?.model || ""),
      state,
      challenge: randomChallenge(),
      validationMethod: "ESP32_LOCAL",
      result: state === "ONLINE" ? "SUCESSO" : "PENDENTE",
      actionType: state === "TENTANDO" ? "AUTENTICACAO" : "SESSAO",
      accessPasswordSalt: passwordHash.salt,
      accessPasswordHash: passwordHash.hash,
      accessPasswordMasked: maskPassword(accessPassword),
      lastHeartbeatAt: state === "ONLINE" ? timestamp : null,
      lastAttemptAt: state === "TENTANDO" ? timestamp : null,
      lastAccessAt: state === "ACESSO_REGISTRADO" ? timestamp : null,
      createdAt: timestamp,
      updatedAt: timestamp,
      createdBy: normalizeId(user?.id),
      usedBy: null,
    };
  });

  userAccessRows = [...generated, ...userAccessRows];
  persistUserAccess();

  generated.forEach((entry) => {
    registerActivity({
      clientId: entry.clientId,
      userId: entry.userId,
      userName: entry.userName,
      profile: entry.profile,
      vehicleId: entry.vehicleId,
      vehicleLabel: entry.vehicleLabel,
      deviceId: entry.deviceId,
      deviceLabel: entry.esp32Device,
      method: "ESP32_LOCAL",
      action: "SEED_ACCESS",
      result: entry.result,
      actionType: entry.actionType,
      esp32: {
        firmware: "v1.0.0",
        signal: "OK",
      },
      details: {
        generated: true,
      },
    });
  });
}

function filterUserRows(rows, filters = {}) {
  const userFilter = normalizeText(filters?.user).toLowerCase();
  const deviceFilter = normalizeText(filters?.device).toLowerCase();
  const actionFilter = normalizeText(filters?.actionType).toLowerCase();
  const resultFilter = normalizeText(filters?.result).toLowerCase();
  const passwordFilter = normalizeText(filters?.password);

  return rows.filter((row) => {
    if (userFilter && !String(row?.userName || "").toLowerCase().includes(userFilter)) return false;
    if (deviceFilter && !String(row?.esp32Device || "").toLowerCase().includes(deviceFilter)) return false;
    if (actionFilter && !String(row?.actionType || "").toLowerCase().includes(actionFilter)) return false;
    if (resultFilter && !String(row?.result || "").toLowerCase().includes(resultFilter)) return false;
    if (passwordFilter) {
      const valid = verifySecret(passwordFilter, row?.accessPasswordSalt, row?.accessPasswordHash);
      if (!valid) return false;
    }
    return true;
  });
}

function findUserAccessRow(id, clientId) {
  const normalizedId = normalizeId(id);
  const normalizedClientId = normalizeId(clientId);
  if (!normalizedId || !normalizedClientId) return null;
  return userAccessRows.find((row) => String(row.id) === normalizedId && String(row.clientId) === normalizedClientId) || null;
}

export async function listTrustCenterUsers({
  clientId,
  filters = {},
  page = 1,
  pageSize = 20,
  sortBy = null,
  sortDir = "desc",
} = {}) {
  const normalizedClientId = normalizeId(clientId);
  await ensureClientSeed(normalizedClientId);

  const scopedRows = userAccessRows.filter((row) => String(row.clientId) === normalizedClientId);
  const filteredRows = filterUserRows(scopedRows, filters);
  const sortedRows = sortRows(filteredRows, sortBy, sortDir);
  return paginate(sortedRows, page, pageSize);
}

export async function getTrustCenterUserSummary({ id, clientId } = {}) {
  const normalizedClientId = normalizeId(clientId);
  await ensureClientSeed(normalizedClientId);
  const row = findUserAccessRow(id, normalizedClientId);
  if (!row) return null;

  const history = activityRows
    .filter((entry) => String(entry.clientId) === normalizedClientId)
    .filter((entry) => {
      if (row.userId && entry.userId) {
        return String(entry.userId) === String(row.userId);
      }
      return String(entry.userName || "") === String(row.userName || "");
    })
    .sort((left, right) => toTimeMs(right.date) - toTimeMs(left.date))
    .slice(0, 100)
    .map(clone);

  return {
    id: row.id,
    summary: {
      name: row.userName,
      profile: row.profile,
      client: row.clientName || row.clientId,
      linkedDevice: row.esp32Device,
      status: row.state,
    },
    status: {
      challenge: row.challenge,
      method: row.validationMethod,
      result: row.result,
      device: row.esp32Device,
    },
    history,
  };
}

export function listTrustCenterActivity({
  clientId,
  filters = {},
  page = 1,
  pageSize = 50,
  sortBy = "date",
  sortDir = "desc",
} = {}) {
  const normalizedClientId = normalizeId(clientId);

  const scopedRows = activityRows.filter((row) => String(row.clientId) === normalizedClientId);
  const filteredRows = applyActivityFilters(scopedRows, filters);
  const normalizedSortBy = normalizeText(sortBy, "date").toLowerCase();
  const direction = normalizeSortDir(sortDir, "desc") === "asc" ? 1 : -1;

  const sortedRows = [...filteredRows].sort((left, right) => {
    if (normalizedSortBy === "date") {
      return (toTimeMs(left.date) - toTimeMs(right.date)) * direction;
    }
    const leftValue = String(left?.[normalizedSortBy] || left?.[sortBy] || "").toLowerCase();
    const rightValue = String(right?.[normalizedSortBy] || right?.[sortBy] || "").toLowerCase();
    return leftValue.localeCompare(rightValue, "pt-BR") * direction;
  });

  const paginated = paginate(sortedRows, page, pageSize);
  return {
    ...paginated,
    extraEsp32Columns: ensureEsp32Columns(sortedRows),
  };
}

export function listTrustCenterAudit({
  clientId,
  page = 1,
  pageSize = 50,
  action = "",
  actor = "",
} = {}) {
  const normalizedClientId = normalizeId(clientId);
  const actionFilter = normalizeText(action).toLowerCase();
  const actorFilter = normalizeText(actor).toLowerCase();

  const rows = auditRows
    .filter((row) => String(row.clientId) === normalizedClientId)
    .filter((row) => {
      if (actionFilter && !String(row.action || "").toLowerCase().includes(actionFilter)) return false;
      if (actorFilter && !String(row.actorName || "").toLowerCase().includes(actorFilter)) return false;
      return true;
    })
    .sort((left, right) => toTimeMs(right.timestamp) - toTimeMs(left.timestamp));

  return paginate(rows, page, pageSize);
}

export function simulateCounterKey({ basePassword, challenge, context = "" } = {}) {
  const normalizedPassword = normalizeText(basePassword);
  const normalizedChallenge = normalizeText(challenge, randomChallenge());

  if (!/^\d{6}$/.test(normalizedPassword)) {
    throw new Error("A senha base deve conter 6 dígitos");
  }

  return {
    challenge: normalizedChallenge,
    counterKey: resolveCounterKey(normalizedPassword, normalizedChallenge, context),
  };
}

export function rotateTrustCenterChallenge({
  clientId,
  actor,
  userIds = [],
  deviceIds = [],
} = {}) {
  const normalizedClientId = normalizeId(clientId);
  const actorInfo = resolveActor(actor);
  const userFilter = new Set(parseList(userIds));
  const deviceFilter = new Set(parseList(deviceIds));

  let affected = 0;
  userAccessRows = userAccessRows.map((row) => {
    if (String(row.clientId) !== normalizedClientId) return row;
    if (userFilter.size > 0 && !userFilter.has(String(row.userId || row.id))) return row;
    if (deviceFilter.size > 0 && !deviceFilter.has(String(row.deviceId || ""))) return row;

    const next = {
      ...row,
      challenge: randomChallenge(),
      actionType: "ROTATE_CHALLENGE",
      result: "ROTACIONADO",
      updatedAt: nowIso(),
      createdBy: actorInfo.id,
    };
    affected += 1;

    registerActivity({
      clientId: normalizedClientId,
      userId: next.userId,
      userName: next.userName,
      profile: next.profile,
      vehicleId: next.vehicleId,
      vehicleLabel: next.vehicleLabel,
      deviceId: next.deviceId,
      deviceLabel: next.esp32Device,
      method: next.validationMethod,
      action: "ROTATE_CHALLENGE",
      result: "ROTACIONADO",
      actionType: "ROTATE_CHALLENGE",
      createdBy: actorInfo,
      details: { challenge: next.challenge },
    });

    return next;
  });

  persistUserAccess();

  registerTrustCenterAudit({
    clientId: normalizedClientId,
    action: "ROTATE_CHALLENGE",
    result: affected > 0 ? "SUCESSO" : "SEM_ALVO",
    actor: actorInfo,
    details: {
      affected,
      users: userFilter.size,
      devices: deviceFilter.size,
    },
  });

  return { affected };
}

export function createTrustCenterCounterKey({
  clientId,
  targetUserId,
  vehicleId,
  deviceId,
  basePassword,
  actor,
  expiresInMinutes,
  maxUses,
} = {}) {
  const normalizedClientId = normalizeId(clientId);
  const normalizedTargetUserId = normalizeId(targetUserId);
  const normalizedVehicleId = normalizeId(vehicleId);
  const normalizedDeviceId = normalizeId(deviceId);
  const normalizedPassword = normalizeText(basePassword);
  const actorInfo = resolveActor(actor);

  if (!/^\d{6}$/.test(normalizedPassword)) {
    throw new Error("Senha base inválida. Use 6 dígitos.");
  }

  const challenge = randomChallenge();
  const context = `${normalizedClientId}:${normalizedTargetUserId || "anon"}:${normalizedDeviceId || "na"}`;
  const counterKey = resolveCounterKey(normalizedPassword, challenge, context);

  const secretHash = buildSecretHash(normalizedPassword);
  const ttlMinutes = Math.max(1, Number(expiresInMinutes) || COUNTER_KEY_TTL_MINUTES);
  const resolvedMaxUses = Math.max(1, Number(maxUses) || COUNTER_KEY_MAX_USES);
  const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000).toISOString();

  const vehicleInfo = findVehicleInfoById(normalizedClientId, normalizedVehicleId);
  const deviceInfo = findDeviceInfoById(normalizedClientId, normalizedDeviceId);

  const payload = {
    id: randomUUID(),
    clientId: normalizedClientId,
    createdAt: nowIso(),
    targetUserId: normalizedTargetUserId,
    targetUserName: findUserNameById(normalizedTargetUserId),
    vehicleId: vehicleInfo.vehicleId,
    vehicleLabel: vehicleInfo.vehicleLabel,
    deviceId: deviceInfo.deviceId,
    deviceLabel: deviceInfo.deviceLabel,
    challenge,
    counterKey,
    basePasswordHash: secretHash.hash,
    basePasswordSalt: secretHash.salt,
    basePasswordMasked: maskPassword(normalizedPassword),
    status: "ATIVA",
    usesCount: 0,
    maxUses: resolvedMaxUses,
    firstUsedAt: null,
    lastUsedAt: null,
    usedBy: null,
    usedByName: null,
    createdBy: actorInfo.id,
    createdByName: actorInfo.name,
    expiresAt,
  };

  counterKeyRows = [payload, ...counterKeyRows];
  persistCounterKeys();

  registerActivity({
    clientId: normalizedClientId,
    userId: normalizedTargetUserId,
    userName: payload.targetUserName,
    vehicleId: payload.vehicleId,
    vehicleLabel: payload.vehicleLabel,
    deviceId: payload.deviceId,
    deviceLabel: payload.deviceLabel,
    method: "COUNTER_KEY",
    action: "COUNTER_KEY_CREATED",
    result: "ATIVA",
    actionType: "GERAR_CONTRA_SENHA",
    createdBy: actorInfo,
    details: {
      counterKeyId: payload.id,
      expiresAt,
      maxUses: resolvedMaxUses,
    },
  });

  registerTrustCenterAudit({
    clientId: normalizedClientId,
    action: "COUNTER_KEY_CREATED",
    result: "SUCESSO",
    actor: actorInfo,
    userId: normalizedTargetUserId,
    vehicleId: payload.vehicleId,
    deviceId: payload.deviceId,
    details: {
      counterKeyId: payload.id,
      maxUses: resolvedMaxUses,
      expiresAt,
    },
  });

  return clone(payload);
}

export function listTrustCenterCounterKeys({
  clientId,
  filters = {},
  page = 1,
  pageSize = 20,
  sortBy = "createdAt",
  sortDir = "desc",
} = {}) {
  const normalizedClientId = normalizeId(clientId);
  const userFilter = normalizeText(filters?.user).toLowerCase();
  const vehicleFilter = normalizeText(filters?.vehicle).toLowerCase();
  const deviceFilter = normalizeText(filters?.device).toLowerCase();
  const statusFilter = normalizeText(filters?.status).toLowerCase();

  counterKeyRows = counterKeyRows.map((entry) => ensureCounterKeyStatus({ ...entry }));
  persistCounterKeys();

  const scopedRows = counterKeyRows
    .filter((entry) => String(entry.clientId) === normalizedClientId)
    .filter((entry) => {
      if (userFilter) {
        const text = `${entry.targetUserName || ""} ${entry.usedByName || ""}`.toLowerCase();
        if (!text.includes(userFilter)) return false;
      }
      if (vehicleFilter && !String(entry.vehicleLabel || "").toLowerCase().includes(vehicleFilter)) return false;
      if (deviceFilter && !String(entry.deviceLabel || "").toLowerCase().includes(deviceFilter)) return false;
      if (statusFilter && !String(entry.status || "").toLowerCase().includes(statusFilter)) return false;
      return true;
    });

  const direction = normalizeSortDir(sortDir, "desc") === "asc" ? 1 : -1;
  const sortKey = normalizeText(sortBy, "createdAt").toLowerCase();

  const sortedRows = [...scopedRows].sort((left, right) => {
    if (["createdat", "expiresat", "firstusedat", "lastusedat"].includes(sortKey)) {
      const leftTime = toTimeMs(left?.[sortBy] || left?.[sortKey]);
      const rightTime = toTimeMs(right?.[sortBy] || right?.[sortKey]);
      return (leftTime - rightTime) * direction;
    }
    if (["usescount", "maxuses"].includes(sortKey)) {
      const leftNum = Number(left?.[sortBy] || left?.[sortKey] || 0);
      const rightNum = Number(right?.[sortBy] || right?.[sortKey] || 0);
      return (leftNum - rightNum) * direction;
    }

    const leftText = String(left?.[sortBy] || left?.[sortKey] || "").toLowerCase();
    const rightText = String(right?.[sortBy] || right?.[sortKey] || "").toLowerCase();
    return leftText.localeCompare(rightText, "pt-BR") * direction;
  });

  return paginate(sortedRows, page, pageSize);
}

export function useTrustCenterCounterKey({
  clientId,
  counterKeyId,
  actor,
  providedCounterKey,
} = {}) {
  const normalizedClientId = normalizeId(clientId);
  const normalizedCounterKeyId = normalizeId(counterKeyId);
  const normalizedProvidedCounterKey = normalizeText(providedCounterKey);
  const actorInfo = resolveActor(actor);

  const index = counterKeyRows.findIndex((entry) =>
    String(entry.id) === normalizedCounterKeyId && String(entry.clientId) === normalizedClientId,
  );

  if (index < 0) {
    throw new Error("Contra-senha não encontrada");
  }

  const current = ensureCounterKeyStatus({ ...counterKeyRows[index] });

  if (current.status === "CANCELADA") {
    throw new Error("Contra-senha cancelada");
  }
  if (current.status === "EXPIRADA") {
    throw new Error("Contra-senha expirada");
  }

  if (normalizedProvidedCounterKey && normalizedProvidedCounterKey !== String(current.counterKey)) {
    registerActivity({
      clientId: normalizedClientId,
      userId: current.targetUserId,
      userName: current.targetUserName,
      vehicleId: current.vehicleId,
      vehicleLabel: current.vehicleLabel,
      deviceId: current.deviceId,
      deviceLabel: current.deviceLabel,
      method: "COUNTER_KEY",
      action: "COUNTER_KEY_USE_DENIED",
      result: "CHAVE_INVALIDA",
      actionType: "USO_CONTRA_SENHA",
      usedBy: actorInfo,
      details: { counterKeyId: current.id },
    });

    registerTrustCenterAudit({
      clientId: normalizedClientId,
      action: "COUNTER_KEY_USE_DENIED",
      result: "CHAVE_INVALIDA",
      actor: actorInfo,
      userId: current.targetUserId,
      vehicleId: current.vehicleId,
      deviceId: current.deviceId,
      details: { counterKeyId: current.id },
    });

    throw new Error("Contra-senha inválida");
  }

  const usedAt = nowIso();
  const nextUses = Number(current.usesCount || 0) + 1;
  const resolvedMaxUses = Number(current.maxUses || COUNTER_KEY_MAX_USES);

  const next = {
    ...current,
    usesCount: nextUses,
    firstUsedAt: current.firstUsedAt || usedAt,
    lastUsedAt: usedAt,
    usedBy: actorInfo.id,
    usedByName: actorInfo.name,
    status: nextUses >= resolvedMaxUses ? "USADA" : "ATIVA",
  };

  counterKeyRows[index] = next;
  persistCounterKeys();

  registerActivity({
    clientId: normalizedClientId,
    userId: current.targetUserId,
    userName: current.targetUserName,
    vehicleId: current.vehicleId,
    vehicleLabel: current.vehicleLabel,
    deviceId: current.deviceId,
    deviceLabel: current.deviceLabel,
    method: "COUNTER_KEY",
    action: "COUNTER_KEY_USED",
    result: next.status,
    actionType: "USO_CONTRA_SENHA",
    usedBy: actorInfo,
    details: {
      counterKeyId: next.id,
      usesCount: next.usesCount,
      maxUses: resolvedMaxUses,
    },
  });

  registerTrustCenterAudit({
    clientId: normalizedClientId,
    action: "COUNTER_KEY_USED",
    result: next.status,
    actor: actorInfo,
    userId: next.targetUserId,
    vehicleId: next.vehicleId,
    deviceId: next.deviceId,
    details: {
      counterKeyId: next.id,
      usesCount: next.usesCount,
      maxUses: resolvedMaxUses,
    },
  });

  return clone(next);
}

export function cancelTrustCenterCounterKey({ clientId, counterKeyId, actor } = {}) {
  const normalizedClientId = normalizeId(clientId);
  const normalizedCounterKeyId = normalizeId(counterKeyId);
  const actorInfo = resolveActor(actor);

  const index = counterKeyRows.findIndex((entry) =>
    String(entry.id) === normalizedCounterKeyId && String(entry.clientId) === normalizedClientId,
  );

  if (index < 0) {
    throw new Error("Contra-senha não encontrada");
  }

  const next = {
    ...counterKeyRows[index],
    status: "CANCELADA",
    updatedAt: nowIso(),
  };

  counterKeyRows[index] = next;
  persistCounterKeys();

  registerActivity({
    clientId: normalizedClientId,
    userId: next.targetUserId,
    userName: next.targetUserName,
    vehicleId: next.vehicleId,
    vehicleLabel: next.vehicleLabel,
    deviceId: next.deviceId,
    deviceLabel: next.deviceLabel,
    method: "COUNTER_KEY",
    action: "COUNTER_KEY_CANCELLED",
    result: "CANCELADA",
    actionType: "CANCELAR_CONTRA_SENHA",
    createdBy: actorInfo,
    details: { counterKeyId: next.id },
  });

  registerTrustCenterAudit({
    clientId: normalizedClientId,
    action: "COUNTER_KEY_CANCELLED",
    result: "CANCELADA",
    actor: actorInfo,
    userId: next.targetUserId,
    vehicleId: next.vehicleId,
    deviceId: next.deviceId,
    details: { counterKeyId: next.id },
  });

  return clone(next);
}

export function getTrustCenterCounterKeyById({ clientId, counterKeyId } = {}) {
  const normalizedClientId = normalizeId(clientId);
  const normalizedCounterKeyId = normalizeId(counterKeyId);
  const row = counterKeyRows.find((entry) =>
    String(entry.id) === normalizedCounterKeyId && String(entry.clientId) === normalizedClientId,
  );
  if (!row) return null;
  return clone(ensureCounterKeyStatus({ ...row }));
}

export function upsertTrustCenterUserState({
  clientId,
  userId,
  userName,
  profile,
  deviceId,
  esp32Device,
  vehicleId,
  vehicleLabel,
  state,
  result,
  actionType,
  method,
  challenge,
  actor,
  usedBy,
} = {}) {
  const normalizedClientId = normalizeId(clientId);
  const normalizedUserId = normalizeId(userId) || randomUUID();
  const normalizedState = normalizeState(state, "TENTANDO");
  const actorInfo = resolveActor(actor);
  const usedByInfo = resolveActor(usedBy);

  const index = userAccessRows.findIndex((row) =>
    String(row.clientId) === normalizedClientId && String(row.userId || "") === String(normalizedUserId),
  );

  const timestamp = nowIso();
  const existing = index >= 0 ? userAccessRows[index] : null;
  const accessPassword = randomPassword6();
  const passwordHash = existing
    ? { salt: existing.accessPasswordSalt, hash: existing.accessPasswordHash }
    : buildSecretHash(accessPassword);

  const next = {
    id: existing?.id || randomUUID(),
    clientId: normalizedClientId,
    userId: normalizedUserId,
    userName: normalizeText(userName || existing?.userName || "Usuário"),
    profile: normalizeText(profile || existing?.profile || "user"),
    clientName: normalizeText(existing?.clientName || normalizedClientId),
    deviceId: normalizeId(deviceId || existing?.deviceId),
    esp32Device: normalizeText(esp32Device || existing?.esp32Device),
    vehicleId: normalizeId(vehicleId || existing?.vehicleId),
    vehicleLabel: normalizeText(vehicleLabel || existing?.vehicleLabel),
    state: normalizedState,
    challenge: normalizeText(challenge || existing?.challenge || randomChallenge()),
    validationMethod: normalizeText(method || existing?.validationMethod || "ESP32_LOCAL"),
    result: decorateResultLabel(result || existing?.result || "PENDENTE"),
    actionType: normalizeText(actionType || existing?.actionType || "AUTENTICACAO"),
    accessPasswordSalt: passwordHash.salt,
    accessPasswordHash: passwordHash.hash,
    accessPasswordMasked: existing?.accessPasswordMasked || maskPassword(accessPassword),
    lastHeartbeatAt: normalizedState === "ONLINE" ? timestamp : existing?.lastHeartbeatAt,
    lastAttemptAt: normalizedState === "TENTANDO" ? timestamp : existing?.lastAttemptAt,
    lastAccessAt: normalizedState === "ACESSO_REGISTRADO" ? timestamp : existing?.lastAccessAt,
    createdAt: existing?.createdAt || timestamp,
    updatedAt: timestamp,
    createdBy: actorInfo.id || existing?.createdBy,
    usedBy: usedByInfo.id || existing?.usedBy,
  };

  if (index >= 0) {
    userAccessRows[index] = next;
  } else {
    userAccessRows = [next, ...userAccessRows];
  }
  persistUserAccess();

  registerActivity({
    clientId: normalizedClientId,
    userId: next.userId,
    userName: next.userName,
    profile: next.profile,
    vehicleId: next.vehicleId,
    vehicleLabel: next.vehicleLabel,
    deviceId: next.deviceId,
    deviceLabel: next.esp32Device,
    method: next.validationMethod,
    action: "USER_STATE_UPDATED",
    result: next.result,
    actionType: next.actionType,
    createdBy: actorInfo,
    usedBy: usedByInfo,
    details: {
      state: normalizedState,
      challenge: next.challenge,
    },
  });

  return clone(next);
}

export default {
  listTrustCenterUsers,
  getTrustCenterUserSummary,
  listTrustCenterActivity,
  listTrustCenterAudit,
  simulateCounterKey,
  rotateTrustCenterChallenge,
  createTrustCenterCounterKey,
  listTrustCenterCounterKeys,
  useTrustCenterCounterKey,
  cancelTrustCenterCounterKey,
  getTrustCenterCounterKeyById,
  upsertTrustCenterUserState,
};
