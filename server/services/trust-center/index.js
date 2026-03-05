import { createHmac, randomInt, randomUUID } from "crypto";

import createError from "http-errors";

import { listClients } from "../../models/client.js";
import { listDevices } from "../../models/device.js";
import { listUsers } from "../../models/user.js";
import { listVehicles } from "../../models/vehicle.js";
import { loadCollection, saveCollection } from "../storage.js";
import { hashPassword } from "../../utils/password.js";

const STORAGE_KEYS = {
  states: "trust-center.user-states",
  activity: "trust-center.activity-events",
  counterKeys: "trust-center.counter-keys",
};

const ALLOWED_STATES = new Set(["ONLINE", "TENTANDO", "ACESSO_REGISTRADO"]);
const STATE_PRIORITY = {
  ONLINE: 0,
  TENTANDO: 1,
  ACESSO_REGISTRADO: 2,
};

const SENSITIVE_AUDIT_ACTIONS = new Set([
  "challenge.rotate",
  "counter-key.create",
  "counter-key.use",
  "counter-key.cancel",
  "counter-key.simulate",
]);

const stateStore = new Map();
const activityStore = new Map();
const counterKeyStore = new Map();

function toIso(value, fallback = new Date().toISOString()) {
  if (!value) return fallback;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? fallback : date.toISOString();
}

function toNullableIso(value) {
  if (!value) return null;
  return toIso(value, null);
}

function clampNumber(value, fallback, { min = null, max = null } = {}) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  if (min !== null && parsed < min) return min;
  if (max !== null && parsed > max) return max;
  return parsed;
}

function normalizeText(value) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function normalizeSearchText(value) {
  return normalizeText(value).toLowerCase();
}

function normalizeState(value, fallback = "TENTANDO") {
  const normalized = normalizeText(value).toUpperCase();
  return ALLOWED_STATES.has(normalized) ? normalized : fallback;
}

function normalizeUserStateRecord(record = {}) {
  const now = new Date().toISOString();
  return {
    id: normalizeText(record.id) || randomUUID(),
    clientId: normalizeText(record.clientId) || "",
    userId: normalizeText(record.userId) || null,
    userName: normalizeText(record.userName) || null,
    profile: normalizeText(record.profile) || null,
    clientName: normalizeText(record.clientName) || null,
    vehicleId: normalizeText(record.vehicleId) || null,
    vehicleLabel: normalizeText(record.vehicleLabel) || null,
    esp32Device: normalizeText(record.esp32Device) || null,
    actionType: normalizeText(record.actionType) || null,
    result: normalizeText(record.result) || null,
    state: normalizeState(record.state),
    challenge: normalizeText(record.challenge) || null,
    validationMethod: normalizeText(record.validationMethod) || null,
    lastHeartbeatAt: toNullableIso(record.lastHeartbeatAt),
    lastAttemptAt: toNullableIso(record.lastAttemptAt),
    lastAccessAt: toNullableIso(record.lastAccessAt),
    createdAt: toIso(record.createdAt, now),
    updatedAt: toIso(record.updatedAt, now),
  };
}

function normalizeActivityRecord(record = {}) {
  const now = new Date().toISOString();
  return {
    id: normalizeText(record.id) || randomUUID(),
    clientId: normalizeText(record.clientId) || "",
    userId: normalizeText(record.userId) || null,
    userName: normalizeText(record.userName) || null,
    profile: normalizeText(record.profile) || null,
    clientName: normalizeText(record.clientName) || null,
    vehicleId: normalizeText(record.vehicleId) || null,
    vehicleLabel: normalizeText(record.vehicleLabel) || null,
    esp32Device: normalizeText(record.esp32Device) || null,
    method: normalizeText(record.method) || null,
    action: normalizeText(record.action) || "activity",
    result: normalizeText(record.result) || null,
    state: normalizeText(record.state) || null,
    eventType: normalizeText(record.eventType) || "activity",
    payload: record.payload && typeof record.payload === "object" ? { ...record.payload } : null,
    createdBy: normalizeText(record.createdBy) || null,
    usedBy: normalizeText(record.usedBy) || null,
    createdAt: toIso(record.createdAt, now),
  };
}

function normalizeCounterKeyRecord(record = {}) {
  const now = new Date().toISOString();
  return {
    id: normalizeText(record.id) || randomUUID(),
    clientId: normalizeText(record.clientId) || "",
    userId: normalizeText(record.userId) || null,
    userName: normalizeText(record.userName) || null,
    targetUserId: normalizeText(record.targetUserId) || null,
    targetUserName: normalizeText(record.targetUserName) || null,
    clientName: normalizeText(record.clientName) || null,
    vehicleId: normalizeText(record.vehicleId) || null,
    vehicleLabel: normalizeText(record.vehicleLabel) || null,
    esp32Device: normalizeText(record.esp32Device) || null,
    basePinHash: normalizeText(record.basePinHash) || "",
    challenge: normalizeText(record.challenge) || null,
    counterKey: normalizeText(record.counterKey) || "",
    status: normalizeText(record.status) || "ATIVA",
    usesCount: clampNumber(record.usesCount, 0, { min: 0 }),
    maxUses: record.maxUses == null ? null : clampNumber(record.maxUses, 1, { min: 1 }),
    expiresAt: toNullableIso(record.expiresAt),
    firstUsedAt: toNullableIso(record.firstUsedAt),
    lastUsedAt: toNullableIso(record.lastUsedAt),
    createdBy: normalizeText(record.createdBy) || null,
    usedBy: normalizeText(record.usedBy) || null,
    createdAt: toIso(record.createdAt, now),
    updatedAt: toIso(record.updatedAt, now),
  };
}

function hydrateStore(storageKey, normalizer, targetStore) {
  const persisted = loadCollection(storageKey, []);
  persisted.forEach((entry) => {
    const normalized = normalizer(entry);
    if (!normalized?.id) return;
    targetStore.set(String(normalized.id), normalized);
  });
}

hydrateStore(STORAGE_KEYS.states, normalizeUserStateRecord, stateStore);
hydrateStore(STORAGE_KEYS.activity, normalizeActivityRecord, activityStore);
hydrateStore(STORAGE_KEYS.counterKeys, normalizeCounterKeyRecord, counterKeyStore);

function persistAll() {
  saveCollection(STORAGE_KEYS.states, Array.from(stateStore.values()));
  saveCollection(STORAGE_KEYS.activity, Array.from(activityStore.values()));
  saveCollection(STORAGE_KEYS.counterKeys, Array.from(counterKeyStore.values()));
}

function parseScopeClientIds(clientIds) {
  if (clientIds === null) return null;
  if (!Array.isArray(clientIds)) return new Set();
  return new Set(clientIds.map((clientId) => String(clientId)).filter(Boolean));
}

function isInClientScope(clientId, scopeSet) {
  if (scopeSet === null) return true;
  const normalized = normalizeText(clientId);
  if (!normalized) return false;
  return scopeSet.has(normalized);
}

function parsePagination(params = {}) {
  const page = clampNumber(params.page, 1, { min: 1 });
  const pageSize = clampNumber(params.pageSize, 20, { min: 1, max: 200 });
  return { page, pageSize };
}

function paginate(list, { page, pageSize }) {
  const total = list.length;
  const totalPages = total > 0 ? Math.ceil(total / pageSize) : 1;
  const currentPage = Math.min(page, totalPages);
  const start = (currentPage - 1) * pageSize;
  const end = start + pageSize;
  return {
    data: list.slice(start, end),
    page: currentPage,
    pageSize,
    total,
    totalPages,
  };
}

function compareNullableDate(left, right) {
  const leftMs = left ? new Date(left).getTime() : 0;
  const rightMs = right ? new Date(right).getTime() : 0;
  if (leftMs === rightMs) return 0;
  return leftMs > rightMs ? 1 : -1;
}

function buildStateSorter(sortBy = null, sortDir = "desc") {
  const direction = String(sortDir).toLowerCase() === "asc" ? 1 : -1;
  const normalizedSortBy = normalizeText(sortBy);

  return (left, right) => {
    if (normalizedSortBy) {
      if (["updatedAt", "createdAt", "lastHeartbeatAt", "lastAttemptAt", "lastAccessAt"].includes(normalizedSortBy)) {
        return compareNullableDate(left[normalizedSortBy], right[normalizedSortBy]) * direction;
      }
      const leftText = normalizeSearchText(left[normalizedSortBy]);
      const rightText = normalizeSearchText(right[normalizedSortBy]);
      if (leftText !== rightText) {
        return leftText > rightText ? direction : -direction;
      }
      return compareNullableDate(left.updatedAt, right.updatedAt) * -1;
    }

    const leftPriority = STATE_PRIORITY[left.state] ?? 99;
    const rightPriority = STATE_PRIORITY[right.state] ?? 99;
    if (leftPriority !== rightPriority) {
      return leftPriority < rightPriority ? -1 : 1;
    }

    const dateFieldByState = {
      ONLINE: "lastHeartbeatAt",
      TENTANDO: "lastAttemptAt",
      ACESSO_REGISTRADO: "lastAccessAt",
    };

    const field = dateFieldByState[left.state] || "updatedAt";
    const dateDiff = compareNullableDate(left[field], right[field]);
    if (dateDiff !== 0) return dateDiff * -1;
    return compareNullableDate(left.updatedAt, right.updatedAt) * -1;
  };
}

function resolveCounterConfig() {
  const ttlMinutes = clampNumber(process.env.TRUST_CENTER_COUNTER_KEY_TTL_MINUTES, 15, { min: 1, max: 60 * 24 * 30 });
  const maxUses = clampNumber(process.env.TRUST_CENTER_COUNTER_KEY_MAX_USES, 1, { min: 1, max: 9999 });
  const challengeLength = clampNumber(process.env.TRUST_CENTER_CHALLENGE_LENGTH, 6, { min: 4, max: 12 });
  const keyLength = clampNumber(process.env.TRUST_CENTER_COUNTER_KEY_LENGTH, 8, { min: 6, max: 12 });
  const secret =
    normalizeText(process.env.TRUST_CENTER_COUNTER_KEY_SECRET) ||
    normalizeText(process.env.JWT_SECRET) ||
    "trust-center-local-secret";
  return { ttlMinutes, maxUses, challengeLength, keyLength, secret };
}

function randomDigits(length = 6) {
  let value = "";
  while (value.length < length) {
    value += String(randomInt(0, 10));
  }
  return value.slice(0, length);
}

function hmacToDigits(input, keyLength, secret) {
  const hex = createHmac("sha256", secret).update(input).digest("hex");
  let digits = "";
  for (let index = 0; index < hex.length && digits.length < keyLength; index += 2) {
    const chunk = hex.slice(index, index + 2);
    const number = parseInt(chunk, 16);
    digits += String(number % 10);
  }
  while (digits.length < keyLength) {
    digits += String(randomInt(0, 10));
  }
  return digits.slice(0, keyLength);
}

function computeCounterKey({ basePin, challenge, userId, vehicleId }) {
  const config = resolveCounterConfig();
  const seed = [normalizeText(basePin), normalizeText(challenge), normalizeText(userId), normalizeText(vehicleId)].join("|");
  return hmacToDigits(seed, config.keyLength, config.secret);
}

function maskSecret(value) {
  const text = normalizeText(value);
  if (!text) return "";
  if (text.length <= 2) return "*".repeat(text.length);
  return `${"*".repeat(Math.max(0, text.length - 2))}${text.slice(-2)}`;
}

function sanitizeCounterKeyRecord(record) {
  if (!record) return null;
  return {
    id: record.id,
    clientId: record.clientId,
    clientName: record.clientName,
    userId: record.userId,
    userName: record.userName,
    targetUserId: record.targetUserId,
    targetUserName: record.targetUserName,
    vehicleId: record.vehicleId,
    vehicleLabel: record.vehicleLabel,
    esp32Device: record.esp32Device,
    challenge: record.challenge,
    counterKey: record.counterKey,
    basePinMasked: "******",
    status: record.status,
    usesCount: record.usesCount,
    maxUses: record.maxUses,
    expiresAt: record.expiresAt,
    firstUsedAt: record.firstUsedAt,
    lastUsedAt: record.lastUsedAt,
    createdBy: record.createdBy,
    usedBy: record.usedBy,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

function normalizeBasePin(pin) {
  const normalized = normalizeText(pin);
  if (!/^\d{6}$/.test(normalized)) {
    throw createError(400, "A senha base deve conter exatamente 6 dígitos");
  }
  return normalized;
}

function recordActivity(payload = {}) {
  const record = normalizeActivityRecord(payload);
  activityStore.set(record.id, record);
  saveCollection(STORAGE_KEYS.activity, Array.from(activityStore.values()));
  return record;
}

function findOrCreateState({
  clientId,
  userId,
  userName = null,
  profile = null,
  clientName = null,
  vehicleId = null,
  vehicleLabel = null,
  esp32Device = null,
}) {
  const normalizedClientId = normalizeText(clientId);
  const normalizedUserId = normalizeText(userId) || null;
  const normalizedDevice = normalizeText(esp32Device) || null;

  const found = Array.from(stateStore.values()).find(
    (record) =>
      String(record.clientId) === String(normalizedClientId) &&
      String(record.userId || "") === String(normalizedUserId || "") &&
      String(record.esp32Device || "") === String(normalizedDevice || ""),
  );

  if (found) return found;

  const created = normalizeUserStateRecord({
    clientId: normalizedClientId,
    userId: normalizedUserId,
    userName,
    profile,
    clientName,
    vehicleId,
    vehicleLabel,
    esp32Device,
    state: "TENTANDO",
    result: "PENDENTE",
  });
  stateStore.set(created.id, created);
  saveCollection(STORAGE_KEYS.states, Array.from(stateStore.values()));
  return created;
}

function updateState(stateId, updates = {}) {
  const current = stateStore.get(String(stateId));
  if (!current) return null;
  const next = normalizeUserStateRecord({
    ...current,
    ...updates,
    id: current.id,
    createdAt: current.createdAt,
    updatedAt: new Date().toISOString(),
  });
  stateStore.set(next.id, next);
  saveCollection(STORAGE_KEYS.states, Array.from(stateStore.values()));
  return next;
}

function enrichStatesWithLatestCounterKey(states) {
  const latestByKey = new Map();
  Array.from(counterKeyStore.values()).forEach((record) => {
    const key = `${record.clientId}::${record.userId || ""}::${record.esp32Device || ""}`;
    const existing = latestByKey.get(key);
    if (!existing || new Date(record.createdAt).getTime() > new Date(existing.createdAt).getTime()) {
      latestByKey.set(key, record);
    }
  });

  return states.map((state) => {
    const key = `${state.clientId}::${state.userId || ""}::${state.esp32Device || ""}`;
    const latest = latestByKey.get(key);
    return {
      ...state,
      latestCounterKey: latest ? maskSecret(latest.counterKey) : null,
    };
  });
}

function filterStateList(records = [], filters = {}) {
  const searchUser = normalizeSearchText(filters.user);
  const searchDevice = normalizeSearchText(filters.device);
  const searchPassword = normalizeSearchText(filters.password);
  const searchAction = normalizeSearchText(filters.actionType);
  const searchResult = normalizeSearchText(filters.result);
  const searchState = normalizeSearchText(filters.state);

  return records.filter((record) => {
    if (searchUser) {
      const hasUserMatch = [record.userName, record.profile, record.clientName].some((value) =>
        normalizeSearchText(value).includes(searchUser),
      );
      if (!hasUserMatch) return false;
    }

    if (searchDevice && !normalizeSearchText(record.esp32Device).includes(searchDevice)) {
      return false;
    }

    if (searchPassword && !normalizeSearchText(record.latestCounterKey).includes(searchPassword)) {
      return false;
    }

    if (searchAction && !normalizeSearchText(record.actionType).includes(searchAction)) {
      return false;
    }

    if (searchResult && !normalizeSearchText(record.result).includes(searchResult)) {
      return false;
    }

    if (searchState && normalizeSearchText(record.state) !== searchState) {
      return false;
    }

    return true;
  });
}

function filterActivityList(records = [], filters = {}) {
  const searchUser = normalizeSearchText(filters.user);
  const searchClient = normalizeSearchText(filters.client);
  const searchVehicle = normalizeSearchText(filters.vehicle);
  const searchDevice = normalizeSearchText(filters.device);
  const searchMethod = normalizeSearchText(filters.method);
  const searchResult = normalizeSearchText(filters.result);
  const from = filters.from ? new Date(filters.from).getTime() : null;
  const to = filters.to ? new Date(filters.to).getTime() : null;

  return records.filter((record) => {
    const createdAtMs = new Date(record.createdAt).getTime();
    if (Number.isFinite(from) && createdAtMs < from) return false;
    if (Number.isFinite(to) && createdAtMs > to) return false;

    if (searchUser) {
      const hasUserMatch = [record.userName, record.profile, record.createdBy, record.usedBy].some((value) =>
        normalizeSearchText(value).includes(searchUser),
      );
      if (!hasUserMatch) return false;
    }
    if (searchClient && !normalizeSearchText(record.clientName).includes(searchClient)) return false;
    if (searchVehicle && !normalizeSearchText(record.vehicleLabel).includes(searchVehicle)) return false;
    if (searchDevice && !normalizeSearchText(record.esp32Device).includes(searchDevice)) return false;
    if (searchMethod && !normalizeSearchText(record.method).includes(searchMethod)) return false;
    if (searchResult && !normalizeSearchText(record.result).includes(searchResult)) return false;

    return true;
  });
}

function filterCounterKeys(records = [], filters = {}) {
  const searchUser = normalizeSearchText(filters.user);
  const searchVehicle = normalizeSearchText(filters.vehicle);
  const searchDevice = normalizeSearchText(filters.device);
  const searchStatus = normalizeSearchText(filters.status);

  return records.filter((record) => {
    if (searchUser) {
      const hasMatch = [record.userName, record.targetUserName, record.createdBy, record.usedBy].some((value) =>
        normalizeSearchText(value).includes(searchUser),
      );
      if (!hasMatch) return false;
    }

    if (searchVehicle && !normalizeSearchText(record.vehicleLabel).includes(searchVehicle)) return false;
    if (searchDevice && !normalizeSearchText(record.esp32Device).includes(searchDevice)) return false;
    if (searchStatus && normalizeSearchText(record.status) !== searchStatus) return false;
    return true;
  });
}

function sortCounterKeys(records = [], sortBy = "createdAt", sortDir = "desc") {
  const direction = String(sortDir).toLowerCase() === "asc" ? 1 : -1;
  const field = normalizeText(sortBy) || "createdAt";

  return [...records].sort((left, right) => {
    if (["createdAt", "updatedAt", "firstUsedAt", "lastUsedAt", "expiresAt"].includes(field)) {
      return compareNullableDate(left[field], right[field]) * direction;
    }
    if (["usesCount"].includes(field)) {
      const leftNumber = clampNumber(left[field], 0);
      const rightNumber = clampNumber(right[field], 0);
      if (leftNumber !== rightNumber) return (leftNumber - rightNumber) * direction;
    }
    const leftText = normalizeSearchText(left[field]);
    const rightText = normalizeSearchText(right[field]);
    if (leftText !== rightText) return leftText > rightText ? direction : -direction;
    return compareNullableDate(left.createdAt, right.createdAt) * -1;
  });
}

export function listUserStates({ clientIds = null, filters = {}, page = 1, pageSize = 20, sortBy = null, sortDir = "desc" } = {}) {
  const scopeSet = parseScopeClientIds(clientIds);
  const list = Array.from(stateStore.values())
    .filter((record) => isInClientScope(record.clientId, scopeSet))
    .map((record) => ({ ...record }));

  const withCounter = enrichStatesWithLatestCounterKey(list);
  const filtered = filterStateList(withCounter, filters);
  const sorted = [...filtered].sort(buildStateSorter(sortBy, sortDir));
  return paginate(sorted, { page, pageSize });
}

export function getUserSummary(stateId, { clientIds = null } = {}) {
  const scopeSet = parseScopeClientIds(clientIds);
  const state = stateStore.get(String(stateId));
  if (!state || !isInClientScope(state.clientId, scopeSet)) {
    throw createError(404, "Registro do Trust Center não encontrado");
  }

  const history = Array.from(activityStore.values())
    .filter((event) => {
      if (!isInClientScope(event.clientId, scopeSet)) return false;
      if (state.userId && String(event.userId || "") === String(state.userId)) return true;
      if (state.esp32Device && String(event.esp32Device || "") === String(state.esp32Device)) return true;
      return false;
    })
    .sort((left, right) => compareNullableDate(left.createdAt, right.createdAt) * -1)
    .slice(0, 200)
    .map((record) => ({ ...record }));

  return {
    summary: { ...state },
    status: {
      challenge: state.challenge,
      validationMethod: state.validationMethod,
      result: state.result,
      device: state.esp32Device,
      state: state.state,
      lastHeartbeatAt: state.lastHeartbeatAt,
      lastAttemptAt: state.lastAttemptAt,
      lastAccessAt: state.lastAccessAt,
    },
    history,
  };
}

export async function rotateChallenge({ clientIds = null, filters = {}, userId = null, actor = null } = {}) {
  const scopeSet = parseScopeClientIds(clientIds);
  const config = resolveCounterConfig();
  const stateCandidates = Array.from(stateStore.values())
    .filter((record) => isInClientScope(record.clientId, scopeSet))
    .filter((record) => {
      if (!userId) return true;
      return String(record.userId || "") === String(userId);
    });

  const filteredCandidates = filterStateList(stateCandidates, filters);

  const affected = [];
  filteredCandidates.forEach((entry) => {
    const next = updateState(entry.id, {
      challenge: randomDigits(config.challengeLength),
      state: "TENTANDO",
      actionType: "ROTATE_CHALLENGE",
      result: "PENDENTE",
      validationMethod: entry.validationMethod || "ESP32_CHALLENGE",
      lastAttemptAt: new Date().toISOString(),
    });
    if (!next) return;
    affected.push(next);
    recordActivity({
      clientId: next.clientId,
      clientName: next.clientName,
      userId: next.userId,
      userName: next.userName,
      profile: next.profile,
      vehicleId: next.vehicleId,
      vehicleLabel: next.vehicleLabel,
      esp32Device: next.esp32Device,
      method: "challenge",
      action: "challenge.rotate",
      result: "OK",
      state: next.state,
      eventType: "audit",
      createdBy: actor,
      payload: {
        challenge: next.challenge,
      },
    });
  });

  return {
    rotated: affected.length,
    items: affected,
  };
}

export async function simulateCounterKey({ basePin, challenge, userId = null, vehicleId = null, actor = null, clientId = null } = {}) {
  const normalizedBasePin = normalizeBasePin(basePin);
  const normalizedChallenge = normalizeText(challenge) || randomDigits(resolveCounterConfig().challengeLength);
  const counterKey = computeCounterKey({
    basePin: normalizedBasePin,
    challenge: normalizedChallenge,
    userId,
    vehicleId,
  });

  recordActivity({
    clientId: normalizeText(clientId) || "",
    userId: normalizeText(userId) || null,
    vehicleId: normalizeText(vehicleId) || null,
    action: "counter-key.simulate",
    result: "OK",
    eventType: "audit",
    createdBy: actor,
    payload: {
      challenge: normalizedChallenge,
    },
  });

  return {
    challenge: normalizedChallenge,
    counterKey,
  };
}

export async function createCounterKey({
  clientId,
  userId,
  targetUserId = null,
  vehicleId = null,
  esp32Device = null,
  basePin,
  challenge = null,
  actor = null,
} = {}) {
  const normalizedClientId = normalizeText(clientId);
  if (!normalizedClientId) {
    throw createError(400, "clientId é obrigatório");
  }
  const normalizedUserId = normalizeText(userId);
  if (!normalizedUserId) {
    throw createError(400, "userId é obrigatório");
  }

  const users = await listUsers();
  const vehicles = listVehicles();
  const clients = await listClients();
  const devices = listDevices({ clientId: normalizedClientId });

  const user = users.find((entry) => String(entry.id) === String(normalizedUserId));
  if (!user) {
    throw createError(404, "Usuário não encontrado");
  }

  const targetUser = targetUserId ? users.find((entry) => String(entry.id) === String(targetUserId)) : null;
  const vehicle = vehicleId ? vehicles.find((entry) => String(entry.id) === String(vehicleId)) : null;
  const client = clients.find((entry) => String(entry.id) === String(normalizedClientId));

  const normalizedBasePin = normalizeBasePin(basePin);
  const config = resolveCounterConfig();
  const resolvedChallenge = normalizeText(challenge) || randomDigits(config.challengeLength);
  const counterKey = computeCounterKey({
    basePin: normalizedBasePin,
    challenge: resolvedChallenge,
    userId: targetUser?.id || user.id,
    vehicleId: vehicle?.id,
  });

  const counterRecord = normalizeCounterKeyRecord({
    clientId: normalizedClientId,
    clientName: client?.name || null,
    userId: user.id,
    userName: user.name || user.username || user.email || null,
    targetUserId: targetUser?.id || null,
    targetUserName: targetUser?.name || targetUser?.username || targetUser?.email || null,
    vehicleId: vehicle?.id || null,
    vehicleLabel: vehicle?.model || vehicle?.name || vehicle?.plate || null,
    esp32Device: normalizeText(esp32Device) || vehicle?.deviceImei || devices[0]?.uniqueId || null,
    basePinHash: await hashPassword(normalizedBasePin),
    challenge: resolvedChallenge,
    counterKey,
    status: "ATIVA",
    usesCount: 0,
    maxUses: config.maxUses,
    expiresAt: new Date(Date.now() + config.ttlMinutes * 60 * 1000).toISOString(),
    createdBy: actor,
    usedBy: null,
  });

  counterKeyStore.set(counterRecord.id, counterRecord);
  saveCollection(STORAGE_KEYS.counterKeys, Array.from(counterKeyStore.values()));

  const userState = findOrCreateState({
    clientId: normalizedClientId,
    userId: user.id,
    userName: user.name || user.username || user.email || null,
    profile: user.role || null,
    clientName: client?.name || null,
    vehicleId: vehicle?.id || null,
    vehicleLabel: vehicle?.model || vehicle?.name || vehicle?.plate || null,
    esp32Device: counterRecord.esp32Device,
  });

  updateState(userState.id, {
    challenge: counterRecord.challenge,
    validationMethod: "COUNTER_KEY",
    actionType: "GERAR_CONTRA_SENHA",
    result: "ATIVA",
    state: "TENTANDO",
    lastAttemptAt: new Date().toISOString(),
  });

  recordActivity({
    clientId: normalizedClientId,
    clientName: client?.name || null,
    userId: user.id,
    userName: user.name || user.username || user.email || null,
    profile: user.role || null,
    vehicleId: vehicle?.id || null,
    vehicleLabel: vehicle?.model || vehicle?.name || vehicle?.plate || null,
    esp32Device: counterRecord.esp32Device,
    method: "counter-key",
    action: "counter-key.create",
    result: "ATIVA",
    state: "TENTANDO",
    eventType: "audit",
    createdBy: actor,
    payload: {
      counterKeyId: counterRecord.id,
      challenge: counterRecord.challenge,
      maxUses: counterRecord.maxUses,
      expiresAt: counterRecord.expiresAt,
    },
  });

  return sanitizeCounterKeyRecord(counterRecord);
}

function refreshCounterStatus(record) {
  const nowMs = Date.now();
  const expiresAtMs = record.expiresAt ? new Date(record.expiresAt).getTime() : null;
  const maxUses = record.maxUses == null ? null : Number(record.maxUses);
  const exhausted = Number.isFinite(maxUses) ? record.usesCount >= maxUses : false;
  const expiredByTime = Number.isFinite(expiresAtMs) ? expiresAtMs < nowMs : false;

  if (record.status === "CANCELADA") return record.status;
  if (expiredByTime || exhausted) return "EXPIRADA";
  if (record.status === "USADA" && !exhausted && !expiredByTime) return "ATIVA";
  return record.status;
}

function touchCounterRecord(record) {
  const normalized = normalizeCounterKeyRecord({
    ...record,
    status: refreshCounterStatus(record),
    updatedAt: new Date().toISOString(),
  });
  counterKeyStore.set(normalized.id, normalized);
  return normalized;
}

export function listCounterKeys({ clientIds = null, filters = {}, page = 1, pageSize = 20, sortBy = "createdAt", sortDir = "desc" } = {}) {
  const scopeSet = parseScopeClientIds(clientIds);
  const refreshed = Array.from(counterKeyStore.values())
    .filter((record) => isInClientScope(record.clientId, scopeSet))
    .map((record) => touchCounterRecord(record));

  saveCollection(STORAGE_KEYS.counterKeys, Array.from(counterKeyStore.values()));

  const filtered = filterCounterKeys(refreshed, filters);
  const sorted = sortCounterKeys(filtered, sortBy, sortDir);
  const pagePayload = paginate(sorted, { page, pageSize });
  return {
    ...pagePayload,
    data: pagePayload.data.map((record) => sanitizeCounterKeyRecord(record)),
  };
}

export function useCounterKey({ id, actor = null, counterKey = null } = {}) {
  const record = counterKeyStore.get(String(id));
  if (!record) {
    throw createError(404, "Contra-senha não encontrada");
  }

  const refreshed = touchCounterRecord(record);

  if (refreshed.status !== "ATIVA") {
    throw createError(409, "Contra-senha não está ativa");
  }

  const provided = normalizeText(counterKey);
  if (provided && provided !== refreshed.counterKey) {
    throw createError(400, "Contra-senha inválida");
  }

  const nextUses = Number(refreshed.usesCount || 0) + 1;
  const reachedLimit = refreshed.maxUses != null && nextUses >= Number(refreshed.maxUses);
  const next = normalizeCounterKeyRecord({
    ...refreshed,
    usesCount: nextUses,
    firstUsedAt: refreshed.firstUsedAt || new Date().toISOString(),
    lastUsedAt: new Date().toISOString(),
    usedBy: actor,
    status: reachedLimit ? "USADA" : "ATIVA",
    updatedAt: new Date().toISOString(),
  });
  counterKeyStore.set(next.id, next);
  saveCollection(STORAGE_KEYS.counterKeys, Array.from(counterKeyStore.values()));

  const state = findOrCreateState({
    clientId: next.clientId,
    userId: next.userId,
    userName: next.userName,
    profile: null,
    clientName: next.clientName,
    vehicleId: next.vehicleId,
    vehicleLabel: next.vehicleLabel,
    esp32Device: next.esp32Device,
  });

  updateState(state.id, {
    state: "ACESSO_REGISTRADO",
    actionType: "USAR_CONTRA_SENHA",
    result: "SUCESSO",
    validationMethod: "COUNTER_KEY",
    challenge: next.challenge,
    lastAccessAt: new Date().toISOString(),
  });

  recordActivity({
    clientId: next.clientId,
    clientName: next.clientName,
    userId: next.userId,
    userName: next.userName,
    vehicleId: next.vehicleId,
    vehicleLabel: next.vehicleLabel,
    esp32Device: next.esp32Device,
    method: "counter-key",
    action: "counter-key.use",
    result: "SUCESSO",
    state: "ACESSO_REGISTRADO",
    eventType: "audit",
    createdBy: next.createdBy,
    usedBy: actor,
    payload: {
      counterKeyId: next.id,
      usesCount: next.usesCount,
      maxUses: next.maxUses,
    },
  });

  return sanitizeCounterKeyRecord(next);
}

export function cancelCounterKey({ id, actor = null } = {}) {
  const record = counterKeyStore.get(String(id));
  if (!record) {
    throw createError(404, "Contra-senha não encontrada");
  }

  const next = normalizeCounterKeyRecord({
    ...record,
    status: "CANCELADA",
    updatedAt: new Date().toISOString(),
    usedBy: actor,
  });
  counterKeyStore.set(next.id, next);
  saveCollection(STORAGE_KEYS.counterKeys, Array.from(counterKeyStore.values()));

  recordActivity({
    clientId: next.clientId,
    clientName: next.clientName,
    userId: next.userId,
    userName: next.userName,
    vehicleId: next.vehicleId,
    vehicleLabel: next.vehicleLabel,
    esp32Device: next.esp32Device,
    method: "counter-key",
    action: "counter-key.cancel",
    result: "CANCELADA",
    state: null,
    eventType: "audit",
    createdBy: next.createdBy,
    usedBy: actor,
    payload: {
      counterKeyId: next.id,
    },
  });

  return sanitizeCounterKeyRecord(next);
}

export function listActivity({ clientIds = null, filters = {}, page = 1, pageSize = 20, sortBy = "createdAt", sortDir = "desc" } = {}) {
  const scopeSet = parseScopeClientIds(clientIds);
  const list = Array.from(activityStore.values())
    .filter((record) => isInClientScope(record.clientId, scopeSet))
    .map((record) => ({ ...record }));

  const filtered = filterActivityList(list, filters);

  const direction = String(sortDir).toLowerCase() === "asc" ? 1 : -1;
  const field = normalizeText(sortBy) || "createdAt";
  const sorted = [...filtered].sort((left, right) => {
    if (["createdAt"].includes(field)) {
      return compareNullableDate(left[field], right[field]) * direction;
    }
    const leftText = normalizeSearchText(left[field]);
    const rightText = normalizeSearchText(right[field]);
    if (leftText !== rightText) return leftText > rightText ? direction : -direction;
    return compareNullableDate(left.createdAt, right.createdAt) * -1;
  });

  return paginate(sorted, { page, pageSize });
}

export function listAudit({ clientIds = null, filters = {}, page = 1, pageSize = 20 } = {}) {
  const scopeSet = parseScopeClientIds(clientIds);
  const baseList = Array.from(activityStore.values())
    .filter((record) => isInClientScope(record.clientId, scopeSet))
    .filter((record) => record.eventType === "audit" || SENSITIVE_AUDIT_ACTIONS.has(record.action));
  const filtered = filterActivityList(baseList, filters).sort(
    (left, right) => compareNullableDate(left.createdAt, right.createdAt) * -1,
  );
  return paginate(filtered, { page, pageSize });
}

function toCsvCell(value) {
  if (value === null || value === undefined) return "";
  const text = String(value);
  if (!/[",\n]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

export function exportActivityCsv({ clientIds = null, filters = {} } = {}) {
  const data = listActivity({
    clientIds,
    filters,
    page: 1,
    pageSize: 100000,
    sortBy: "createdAt",
    sortDir: "desc",
  }).data;

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
    "estado",
    "created_by",
    "used_by",
  ];

  const rows = data.map((record) => [
    record.createdAt,
    record.userName || "",
    record.profile || "",
    record.clientName || "",
    record.vehicleLabel || "",
    record.esp32Device || "",
    record.method || "",
    record.action || "",
    record.result || "",
    record.state || "",
    record.createdBy || "",
    record.usedBy || "",
  ]);

  return [headers, ...rows].map((line) => line.map(toCsvCell).join(",")).join("\n");
}

export async function listOptions({ clientIds = null } = {}) {
  const scopeSet = parseScopeClientIds(clientIds);
  const [users, clients] = await Promise.all([listUsers(), listClients()]);
  const vehicles = listVehicles();
  const devices = listDevices();

  const usersPayload = users
    .filter((user) => isInClientScope(user.clientId, scopeSet))
    .map((user) => ({
      id: user.id,
      name: user.name || user.username || user.email,
      role: user.role || null,
      clientId: user.clientId || null,
    }));

  const clientsPayload = clients
    .filter((client) => isInClientScope(client.id, scopeSet))
    .map((client) => ({ id: client.id, name: client.name }));

  const vehiclesPayload = vehicles
    .filter((vehicle) => isInClientScope(vehicle.clientId, scopeSet))
    .map((vehicle) => ({
      id: vehicle.id,
      clientId: vehicle.clientId,
      label: vehicle.model || vehicle.name || vehicle.plate || vehicle.id,
      plate: vehicle.plate || null,
      deviceImei: vehicle.deviceImei || null,
    }));

  const devicesPayload = devices
    .filter((device) => isInClientScope(device.clientId, scopeSet))
    .map((device) => ({
      id: device.id,
      clientId: device.clientId,
      uniqueId: device.uniqueId || null,
      name: device.name || null,
    }));

  return {
    users: usersPayload,
    clients: clientsPayload,
    vehicles: vehiclesPayload,
    devices: devicesPayload,
  };
}

export function auditActionNames() {
  return Array.from(SENSITIVE_AUDIT_ACTIONS.values());
}

export function isSensitiveAction(action) {
  return SENSITIVE_AUDIT_ACTIONS.has(normalizeText(action));
}

export function resetTrustCenterData() {
  stateStore.clear();
  activityStore.clear();
  counterKeyStore.clear();
  persistAll();
}

export default {
  listUserStates,
  getUserSummary,
  rotateChallenge,
  simulateCounterKey,
  createCounterKey,
  useCounterKey,
  cancelCounterKey,
  listCounterKeys,
  listActivity,
  listAudit,
  exportActivityCsv,
  listOptions,
  auditActionNames,
  isSensitiveAction,
  resetTrustCenterData,
};
