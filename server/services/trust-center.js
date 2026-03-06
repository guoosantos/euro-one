import { randomInt, randomUUID, createHash, createHmac } from "node:crypto";

import { loadCollection, saveCollection } from "./storage.js";

const STORAGE_KEYS = {
  users: "trustCenter.users",
  activity: "trustCenter.activity",
  counterKeys: "trustCenter.counterKeys",
};

const TRUST_STATES = ["ONLINE", "TENTANDO", "ACESSO_REGISTRADO"];
const STATE_PRIORITY = {
  ONLINE: 0,
  TENTANDO: 1,
  ACESSO_REGISTRADO: 2,
};

const DEFAULT_COUNTER_KEY_TTL_MINUTES = Number(process.env.TRUST_CENTER_COUNTER_KEY_TTL_MINUTES) || 30;
const DEFAULT_COUNTER_KEY_MAX_USES = Number(process.env.TRUST_CENTER_COUNTER_KEY_MAX_USES) || 1;
const COUNTER_KEY_SECRET = process.env.TRUST_CENTER_COUNTER_KEY_SECRET || "trust-center-secret";

function toIso(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function nowIso() {
  return new Date().toISOString();
}

function parsePositiveInteger(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.floor(parsed));
}

function normalizeText(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function matchesFilter(value, query) {
  if (!query) return true;
  return normalizeText(value).includes(normalizeText(query));
}

function clampPage(page, totalPages) {
  return Math.max(1, Math.min(page, totalPages));
}

function paginate(list, page = 1, pageSize = 20) {
  const wantsAll = String(pageSize || "").trim().toLowerCase() === "all";
  const safePageSize = wantsAll
    ? Math.max(1, list.length || 1)
    : Math.min(200, parsePositiveInteger(pageSize, 20));
  const totalItems = list.length;
  const totalPages = wantsAll ? 1 : Math.max(1, Math.ceil(totalItems / safePageSize));
  const safePage = wantsAll ? 1 : clampPage(parsePositiveInteger(page, 1), totalPages);
  const start = wantsAll ? 0 : (safePage - 1) * safePageSize;
  const items = wantsAll ? [...list] : list.slice(start, start + safePageSize);

  return {
    items,
    meta: {
      page: safePage,
      pageSize: wantsAll ? "all" : safePageSize,
      totalItems,
      totalPages,
    },
  };
}

function readCollection(key, fallback = []) {
  const data = loadCollection(key, fallback);
  return Array.isArray(data) ? data : [...fallback];
}

function writeCollection(key, data) {
  saveCollection(key, Array.isArray(data) ? data : []);
}

function makeChallenge() {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

function hashBasePassword(basePassword) {
  return createHash("sha256")
    .update(`${COUNTER_KEY_SECRET}:${String(basePassword || "")}`)
    .digest("hex");
}

function makeCounterKey({ userId, basePassword, challenge }) {
  const digest = createHmac("sha256", COUNTER_KEY_SECRET)
    .update(`${userId}:${basePassword}:${challenge}`)
    .digest("hex");
  const asNumber = BigInt(`0x${digest.slice(0, 12)}`);
  return String(Number(asNumber % 100000000n)).padStart(8, "0");
}

function toMaskedPassword() {
  return "••••••";
}

function toEventDate(value) {
  const iso = toIso(value);
  return iso || nowIso();
}

function toTimestamp(value) {
  const date = new Date(value || 0).getTime();
  return Number.isFinite(date) ? date : 0;
}

function toFilterTimestamp(value, { endOfDay = false } = {}) {
  if (!value) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const suffix = endOfDay ? "T23:59:59.999Z" : "T00:00:00.000Z";
    return toTimestamp(`${raw}${suffix}`);
  }
  return toTimestamp(raw);
}

function getStateTimestamp(record) {
  if (!record) return 0;
  if (record.state === "ONLINE") return toTimestamp(record.lastHeartbeatAt || record.updatedAt);
  if (record.state === "TENTANDO") return toTimestamp(record.lastAttemptAt || record.updatedAt);
  return toTimestamp(record.lastAccessAt || record.updatedAt);
}

function resolveSortValue(record, sortBy) {
  if (!record || !sortBy) return null;
  const value = record[sortBy];
  if (["lastHeartbeatAt", "lastAttemptAt", "lastAccessAt", "updatedAt", "createdAt", "date"].includes(sortBy)) {
    return toTimestamp(value);
  }
  return normalizeText(value);
}

function compareValues(left, right, direction = "asc") {
  if (left === right) return 0;
  if (left == null) return 1;
  if (right == null) return -1;
  const factor = direction === "desc" ? -1 : 1;
  return left > right ? factor : -factor;
}

function asPublicUserRecord(record) {
  return {
    id: record.id,
    userId: record.userId,
    userName: record.userName,
    profile: record.profile,
    clientId: record.clientId,
    clientName: record.clientName,
    vehicle: record.vehicle,
    deviceName: record.deviceName,
    deviceId: record.deviceId,
    state: record.state,
    challenge: record.challenge,
    validationMethod: record.validationMethod,
    actionType: record.actionType,
    result: record.result,
    lastHeartbeatAt: record.lastHeartbeatAt,
    lastAttemptAt: record.lastAttemptAt,
    lastAccessAt: record.lastAccessAt,
    updatedAt: record.updatedAt,
  };
}

function asPublicCounterKey(record) {
  return {
    id: record.id,
    createdAt: record.createdAt,
    createdBy: record.createdBy,
    targetUserId: record.targetUserId,
    targetUserName: record.targetUserName,
    clientId: record.clientId,
    clientName: record.clientName,
    vehicle: record.vehicle,
    deviceName: record.deviceName,
    basePasswordMasked: toMaskedPassword(),
    counterKey: record.counterKey,
    status: record.status,
    usesCount: record.usesCount,
    maxUses: record.maxUses,
    firstUsedAt: record.firstUsedAt,
    lastUsedAt: record.lastUsedAt,
    usedBy: record.usedBy,
    expiresAt: record.expiresAt,
  };
}

function buildCsvLine(values) {
  return values
    .map((value) => {
      const raw = value == null ? "" : String(value);
      if (/[",\n]/.test(raw)) {
        return `"${raw.replace(/"/g, '""')}"`;
      }
      return raw;
    })
    .join(",");
}

function ensureSeededUsers() {
  const existing = readCollection(STORAGE_KEYS.users, []);
  if (existing.length > 0) return existing;

  const users = readCollection("users", []);
  const vehicles = readCollection("vehicles", []);
  const devices = readCollection("devices", []);
  const clients = readCollection("clients", []);
  const now = Date.now();

  const records = (Array.isArray(users) ? users : [])
    .slice(0, 24)
    .map((user, index) => {
      const vehicle = vehicles[index % Math.max(1, vehicles.length)] || null;
      const device = devices[index % Math.max(1, devices.length)] || null;
      const client = clients.find((item) => String(item?.id || "") === String(user?.clientId || "")) || null;
      const state = TRUST_STATES[index % TRUST_STATES.length];
      const lastHeartbeatAt = new Date(now - index * 90_000).toISOString();
      const lastAttemptAt = new Date(now - index * 120_000).toISOString();
      const lastAccessAt = new Date(now - index * 180_000).toISOString();
      const updatedAt = new Date(now - index * 60_000).toISOString();
      const samplePassword = String((index % 1_000_000) + 100_000).slice(0, 6);

      return {
        id: randomUUID(),
        userId: String(user?.id || randomUUID()),
        userName: user?.name || user?.username || user?.email || `Usuário ${index + 1}`,
        profile: user?.role || "user",
        clientId: user?.clientId || vehicle?.clientId || device?.clientId || null,
        clientName: client?.name || user?.client?.name || "Cliente padrão",
        vehicle: vehicle?.plate || vehicle?.name || `VEIC-${index + 1}`,
        deviceName: device?.name || device?.uniqueId || `ESP32-${index + 1}`,
        deviceId: device?.id || null,
        state,
        challenge: makeChallenge(),
        validationMethod: "COUNTER_KEY",
        actionType: state === "TENTANDO" ? "TENTATIVA_ACESSO" : "VALIDACAO",
        result: state === "ACESSO_REGISTRADO" ? "SUCESSO" : "PENDENTE",
        lastHeartbeatAt,
        lastAttemptAt,
        lastAccessAt,
        lastPasswordHash: hashBasePassword(samplePassword),
        updatedAt,
      };
    });

  if (!records.length) {
    const fallback = Array.from({ length: 6 }).map((_, index) => {
      const state = TRUST_STATES[index % TRUST_STATES.length];
      const nowIsoValue = new Date(now - index * 120_000).toISOString();
      return {
        id: randomUUID(),
        userId: randomUUID(),
        userName: `Operador ${index + 1}`,
        profile: "user",
        clientId: null,
        clientName: "Cliente padrão",
        vehicle: `VEIC-${index + 1}`,
        deviceName: `ESP32-${index + 1}`,
        deviceId: null,
        state,
        challenge: makeChallenge(),
        validationMethod: "COUNTER_KEY",
        actionType: state === "TENTANDO" ? "TENTATIVA_ACESSO" : "VALIDACAO",
        result: state === "ACESSO_REGISTRADO" ? "SUCESSO" : "PENDENTE",
        lastHeartbeatAt: nowIsoValue,
        lastAttemptAt: nowIsoValue,
        lastAccessAt: nowIsoValue,
        lastPasswordHash: hashBasePassword(String(100000 + index)),
        updatedAt: nowIsoValue,
      };
    });
    writeCollection(STORAGE_KEYS.users, fallback);
    return fallback;
  }

  writeCollection(STORAGE_KEYS.users, records);
  return records;
}

function ensureSeededActivity(users) {
  const existing = readCollection(STORAGE_KEYS.activity, []);
  if (existing.length > 0) return existing;

  const now = Date.now();
  const events = users.slice(0, 30).map((record, index) => ({
    id: randomUUID(),
    date: new Date(now - index * 180_000).toISOString(),
    clientId: record.clientId,
    userId: record.userId,
    userName: record.userName,
    profile: record.profile,
    clientName: record.clientName,
    vehicle: record.vehicle,
    deviceName: record.deviceName,
    method: record.validationMethod,
    action: record.actionType,
    result: record.result,
    created_by: record.userName,
    used_by: null,
    extra: { state: record.state },
  }));

  writeCollection(STORAGE_KEYS.activity, events);
  return events;
}

function ensureSeededState() {
  const users = ensureSeededUsers();
  ensureSeededActivity(users);
  const counterKeys = readCollection(STORAGE_KEYS.counterKeys, []);
  if (!Array.isArray(counterKeys)) {
    writeCollection(STORAGE_KEYS.counterKeys, []);
  }
}

function readUsers() {
  ensureSeededState();
  return readCollection(STORAGE_KEYS.users, []);
}

function saveUsers(list) {
  writeCollection(STORAGE_KEYS.users, list);
}

function readActivity() {
  ensureSeededState();
  return readCollection(STORAGE_KEYS.activity, []);
}

function saveActivity(list) {
  writeCollection(STORAGE_KEYS.activity, list);
}

function readCounterKeys() {
  ensureSeededState();
  return readCollection(STORAGE_KEYS.counterKeys, []);
}

function saveCounterKeys(list) {
  writeCollection(STORAGE_KEYS.counterKeys, list);
}

function appendActivityEvent(payload = {}) {
  const events = readActivity();
  const event = {
    id: randomUUID(),
    date: toEventDate(payload.date),
    clientId: payload.clientId ? String(payload.clientId) : null,
    userId: payload.userId ? String(payload.userId) : null,
    userName: payload.userName || null,
    profile: payload.profile || null,
    clientName: payload.clientName || null,
    vehicle: payload.vehicle || null,
    deviceName: payload.deviceName || null,
    method: payload.method || "COUNTER_KEY",
    action: payload.action || "ACAO",
    result: payload.result || "SUCESSO",
    created_by: payload.created_by || null,
    used_by: payload.used_by || null,
    extra: payload.extra && typeof payload.extra === "object" ? { ...payload.extra } : {},
  };
  events.unshift(event);
  saveActivity(events);
  return event;
}

function refreshCounterKeyStatuses(counterKeys) {
  const now = Date.now();
  let changed = false;

  const updated = counterKeys.map((record) => {
    let status = record.status || "ATIVA";
    const expiresAtMs = toTimestamp(record.expiresAt);
    const maxUses = Number(record.maxUses) || DEFAULT_COUNTER_KEY_MAX_USES;
    const usesCount = Number(record.usesCount) || 0;

    if (status === "ATIVA" && expiresAtMs > 0 && expiresAtMs < now) {
      status = "EXPIRADA";
    }
    if (status === "ATIVA" && usesCount >= maxUses) {
      status = "USADA";
    }

    if (status !== record.status) {
      changed = true;
      return { ...record, status };
    }
    return record;
  });

  if (changed) {
    saveCounterKeys(updated);
  }

  return updated;
}

function filterByClient(items, clientId) {
  if (!clientId) return items;
  return items.filter((item) => String(item?.clientId || "") === String(clientId));
}

export function listTrustUsers({
  clientId,
  page = 1,
  pageSize = 20,
  sortBy = null,
  sortDir = "desc",
  filters = {},
} = {}) {
  const users = filterByClient(readUsers(), clientId).filter((record) => {
    if (!matchesFilter(record.userName, filters.user)) return false;
    if (!matchesFilter(record.deviceName, filters.device)) return false;
    if (!matchesFilter(record.actionType, filters.actionType)) return false;
    if (!matchesFilter(record.result, filters.result)) return false;
    if (filters.password) {
      const candidate = hashBasePassword(String(filters.password).trim());
      if (candidate !== record.lastPasswordHash) return false;
    }
    return true;
  });

  const direction = normalizeText(sortDir) === "asc" ? "asc" : "desc";
  users.sort((left, right) => {
    const stateOrder = (STATE_PRIORITY[left.state] ?? 999) - (STATE_PRIORITY[right.state] ?? 999);
    if (stateOrder !== 0) return stateOrder;

    if (sortBy) {
      const leftValue = resolveSortValue(left, sortBy);
      const rightValue = resolveSortValue(right, sortBy);
      const bySortField = compareValues(leftValue, rightValue, direction);
      if (bySortField !== 0) return bySortField;
    }

    const leftTs = getStateTimestamp(left);
    const rightTs = getStateTimestamp(right);
    return rightTs - leftTs;
  });

  const payload = paginate(users, page, pageSize);
  return {
    ...payload,
    items: payload.items.map(asPublicUserRecord),
  };
}

export function listTrustUserOptions({ clientId } = {}) {
  const users = filterByClient(readUsers(), clientId);
  const userOptions = users.map((record) => ({
    id: record.id,
    userId: record.userId,
    label: record.userName,
    profile: record.profile,
    clientName: record.clientName,
    vehicle: record.vehicle,
    deviceName: record.deviceName,
  }));

  const vehicles = Array.from(new Set(users.map((record) => String(record.vehicle || "").trim()).filter(Boolean))).map((item) => ({
    id: item,
    label: item,
  }));

  return { users: userOptions, vehicles };
}

function resolveTrustUserRecord({ userId, clientId } = {}) {
  if (!userId) return null;
  const users = filterByClient(readUsers(), clientId);
  return users.find((item) => String(item.id) === String(userId) || String(item.userId) === String(userId)) || null;
}

export function listTrustUserHistory({
  userId,
  clientId,
  page = 1,
  pageSize = 20,
  sortBy = "date",
  sortDir = "desc",
} = {}) {
  const record = resolveTrustUserRecord({ userId, clientId });
  if (!record) return null;

  const direction = normalizeText(sortDir) === "asc" ? "asc" : "desc";
  const history = readActivity()
    .filter((item) => String(item.userId || "") === String(record.userId || ""))
    .sort((left, right) => {
      const leftValue = resolveSortValue(left, sortBy || "date");
      const rightValue = resolveSortValue(right, sortBy || "date");
      const byField = compareValues(leftValue, rightValue, direction);
      if (byField !== 0) return byField;
      return toTimestamp(right.date) - toTimestamp(left.date);
    });

  const payload = paginate(history, page, pageSize);
  return {
    ...payload,
    items: payload.items.map((item) => ({
      id: item.id,
      date: item.date,
      action: item.action,
      result: item.result,
      method: item.method,
      created_by: item.created_by,
      used_by: item.used_by,
      extra: item.extra || {},
    })),
  };
}

export function getTrustUserSummary({ userId, clientId } = {}) {
  const record = resolveTrustUserRecord({ userId, clientId });
  if (!record) return null;

  const historyPayload = listTrustUserHistory({
    userId: record.id,
    clientId,
    page: 1,
    pageSize: "all",
    sortBy: "date",
    sortDir: "desc",
  });
  const history = Array.isArray(historyPayload?.items) ? historyPayload.items : [];

  return {
    summary: {
      id: record.id,
      userId: record.userId,
      userName: record.userName,
      profile: record.profile,
      clientName: record.clientName,
      vehicle: record.vehicle,
      deviceName: record.deviceName,
      state: record.state,
    },
    status: {
      challenge: record.challenge,
      method: record.validationMethod,
      result: record.result,
      device: record.deviceName,
      actionType: record.actionType,
      lastHeartbeatAt: record.lastHeartbeatAt,
      lastAttemptAt: record.lastAttemptAt,
      lastAccessAt: record.lastAccessAt,
    },
    history,
  };
}

export function rotateTrustChallenge({ userId = null, actor = null, clientId = null } = {}) {
  const users = readUsers();
  const targetList = users.filter((record) => {
    if (clientId && String(record.clientId || "") !== String(clientId)) return false;
    if (!userId) return true;
    return String(record.id) === String(userId) || String(record.userId) === String(userId);
  });

  if (!targetList.length) {
    return { rotated: 0, challenge: null };
  }

  const now = nowIso();
  const ids = new Set(targetList.map((record) => record.id));
  const updatedUsers = users.map((record) => {
    if (!ids.has(record.id)) return record;
    return {
      ...record,
      challenge: makeChallenge(),
      actionType: "ROTATE_CHALLENGE",
      result: "ROTACIONADO",
      lastAttemptAt: now,
      updatedAt: now,
    };
  });
  saveUsers(updatedUsers);

  const first = updatedUsers.find((record) => ids.has(record.id));
  appendActivityEvent({
    date: now,
    clientId: first?.clientId,
    userId: first?.userId,
    userName: first?.userName,
    profile: first?.profile,
    clientName: first?.clientName,
    vehicle: first?.vehicle,
    deviceName: first?.deviceName,
    method: "CHALLENGE",
    action: "ROTATE_CHALLENGE",
    result: "SUCESSO",
    created_by: actor?.name || actor?.id || null,
    extra: { rotatedCount: targetList.length },
  });

  return {
    rotated: targetList.length,
    challenge: first?.challenge || null,
  };
}

export function simulateTrustCounterKey({ userId, basePassword, actor = null, clientId = null } = {}) {
  const users = filterByClient(readUsers(), clientId);
  const target = users.find((record) => String(record.id) === String(userId) || String(record.userId) === String(userId));
  if (!target) {
    return null;
  }

  const counterKey = makeCounterKey({
    userId: target.userId,
    basePassword: String(basePassword || ""),
    challenge: target.challenge,
  });

  appendActivityEvent({
    clientId: target.clientId,
    userId: target.userId,
    userName: target.userName,
    profile: target.profile,
    clientName: target.clientName,
    vehicle: target.vehicle,
    deviceName: target.deviceName,
    method: "COUNTER_KEY",
    action: "SIMULATE_COUNTER_KEY",
    result: "SUCESSO",
    created_by: actor?.name || actor?.id || null,
    extra: {
      challenge: target.challenge,
      simulated: true,
    },
  });

  return {
    userId: target.userId,
    challenge: target.challenge,
    counterKey,
    simulatedAt: nowIso(),
  };
}

export function listTrustActivity({
  clientId,
  page = 1,
  pageSize = 20,
  sortBy = "date",
  sortDir = "desc",
  filters = {},
} = {}) {
  const fromTs = toFilterTimestamp(filters.from, { endOfDay: false });
  const toTs = toFilterTimestamp(filters.to, { endOfDay: true });

  const list = filterByClient(readActivity(), clientId).filter((event) => {
    const eventTs = toTimestamp(event.date);
    if (fromTs && eventTs < fromTs) return false;
    if (toTs && eventTs > toTs) return false;
    if (!matchesFilter(event.userName, filters.user)) return false;
    if (!matchesFilter(event.clientName, filters.client)) return false;
    if (!matchesFilter(event.vehicle, filters.vehicle)) return false;
    if (!matchesFilter(event.deviceName, filters.device)) return false;
    if (!matchesFilter(event.method, filters.method)) return false;
    if (!matchesFilter(event.result, filters.result)) return false;
    return true;
  });

  const direction = normalizeText(sortDir) === "asc" ? "asc" : "desc";
  list.sort((left, right) => {
    const leftValue = resolveSortValue(left, sortBy || "date");
    const rightValue = resolveSortValue(right, sortBy || "date");
    const byField = compareValues(leftValue, rightValue, direction);
    if (byField !== 0) return byField;
    return toTimestamp(right.date) - toTimestamp(left.date);
  });

  const extraColumns = new Set();
  list.forEach((event) => {
    if (!event.extra || typeof event.extra !== "object") return;
    Object.keys(event.extra).forEach((key) => {
      if (!["state"].includes(key)) {
        extraColumns.add(key);
      }
    });
  });

  const payload = paginate(list, page, pageSize);
  return {
    ...payload,
    items: payload.items.map((event) => ({
      id: event.id,
      date: event.date,
      user: event.userName,
      profile: event.profile,
      client: event.clientName,
      vehicle: event.vehicle,
      device: event.deviceName,
      method: event.method,
      action: event.action,
      result: event.result,
      created_by: event.created_by,
      used_by: event.used_by,
      extra: event.extra || {},
    })),
    extraColumns: Array.from(extraColumns),
  };
}

export function exportTrustActivityCsv(params = {}) {
  const payload = listTrustActivity({ ...params, page: 1, pageSize: 50_000 });
  const baseHeaders = [
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
  const headers = [...baseHeaders, ...payload.extraColumns];
  const lines = [buildCsvLine(headers)];

  payload.items.forEach((item) => {
    const values = [
      item.date,
      item.user,
      item.profile,
      item.client,
      item.vehicle,
      item.device,
      item.method,
      item.action,
      item.result,
      item.created_by,
      item.used_by,
      ...payload.extraColumns.map((column) => item.extra?.[column] ?? ""),
    ];
    lines.push(buildCsvLine(values));
  });

  return lines.join("\n");
}

export function listTrustCounterKeys({
  clientId,
  page = 1,
  pageSize = 20,
  sortBy = "createdAt",
  sortDir = "desc",
  filters = {},
} = {}) {
  const list = refreshCounterKeyStatuses(readCounterKeys())
    .filter((record) => {
      if (clientId && String(record.clientId || "") !== String(clientId)) return false;
      if (!matchesFilter(record.targetUserName, filters.user)) return false;
      if (!matchesFilter(record.clientName, filters.client)) return false;
      if (!matchesFilter(record.vehicle, filters.vehicle)) return false;
      if (!matchesFilter(record.deviceName, filters.device)) return false;
      if (!matchesFilter(record.status, filters.status)) return false;
      return true;
    });

  const direction = normalizeText(sortDir) === "asc" ? "asc" : "desc";
  list.sort((left, right) => {
    const leftValue = resolveSortValue(left, sortBy || "createdAt");
    const rightValue = resolveSortValue(right, sortBy || "createdAt");
    const byField = compareValues(leftValue, rightValue, direction);
    if (byField !== 0) return byField;
    return toTimestamp(right.createdAt) - toTimestamp(left.createdAt);
  });

  const payload = paginate(list, page, pageSize);
  return {
    ...payload,
    items: payload.items.map(asPublicCounterKey),
  };
}

export function createTrustCounterKey({
  clientId,
  userId,
  vehicle,
  basePassword,
  actor = null,
} = {}) {
  const normalizedPassword = String(basePassword || "").trim();
  if (!/^\d{6}$/.test(normalizedPassword)) {
    const error = new Error("A senha base deve conter 6 dígitos.");
    error.status = 400;
    throw error;
  }

  const users = filterByClient(readUsers(), clientId);
  const targetUser = users.find((record) => String(record.id) === String(userId) || String(record.userId) === String(userId));
  if (!targetUser) {
    const error = new Error("Usuário alvo não encontrado.");
    error.status = 404;
    throw error;
  }

  const ttlMinutes = Math.max(1, Number(process.env.TRUST_CENTER_COUNTER_KEY_TTL_MINUTES) || DEFAULT_COUNTER_KEY_TTL_MINUTES);
  const maxUses = Math.max(1, Number(process.env.TRUST_CENTER_COUNTER_KEY_MAX_USES) || DEFAULT_COUNTER_KEY_MAX_USES);
  const createdAt = nowIso();
  const expiresAt = new Date(Date.now() + ttlMinutes * 60_000).toISOString();

  const record = {
    id: randomUUID(),
    createdAt,
    createdBy: {
      id: actor?.id ? String(actor.id) : null,
      name: actor?.name || actor?.email || actor?.username || null,
    },
    targetUserId: targetUser.userId,
    targetUserName: targetUser.userName,
    clientId: targetUser.clientId,
    clientName: targetUser.clientName,
    vehicle: vehicle || targetUser.vehicle,
    deviceName: targetUser.deviceName,
    basePasswordHash: hashBasePassword(normalizedPassword),
    counterKey: makeCounterKey({
      userId: targetUser.userId,
      basePassword: normalizedPassword,
      challenge: targetUser.challenge,
    }),
    status: "ATIVA",
    usesCount: 0,
    maxUses,
    firstUsedAt: null,
    lastUsedAt: null,
    usedBy: null,
    expiresAt,
  };

  const list = readCounterKeys();
  list.unshift(record);
  saveCounterKeys(list);

  appendActivityEvent({
    clientId: record.clientId,
    userId: record.targetUserId,
    userName: record.targetUserName,
    profile: targetUser.profile,
    clientName: record.clientName,
    vehicle: record.vehicle,
    deviceName: record.deviceName,
    method: "COUNTER_KEY",
    action: "COUNTER_KEY_CREATE",
    result: "ATIVA",
    created_by: actor?.name || actor?.id || null,
    extra: {
      status: record.status,
      expiresAt: record.expiresAt,
      maxUses: record.maxUses,
    },
  });

  return asPublicCounterKey(record);
}

export function useTrustCounterKey({ id, usedBy = null, clientId = null } = {}) {
  const list = refreshCounterKeyStatuses(readCounterKeys());
  const index = list.findIndex((record) => String(record.id) === String(id));
  if (index < 0) {
    const error = new Error("Contra-senha não encontrada.");
    error.status = 404;
    throw error;
  }

  const target = list[index];
  if (clientId && String(target.clientId || "") !== String(clientId)) {
    const error = new Error("Contra-senha não pertence ao cliente selecionado.");
    error.status = 403;
    throw error;
  }

  if (target.status !== "ATIVA") {
    const error = new Error("Somente contra-senhas ativas podem ser utilizadas.");
    error.status = 400;
    throw error;
  }

  const now = nowIso();
  const nextUses = Number(target.usesCount || 0) + 1;
  const maxUses = Number(target.maxUses || DEFAULT_COUNTER_KEY_MAX_USES);
  const nextStatus = nextUses >= maxUses ? "USADA" : "ATIVA";
  const actor = {
    id: usedBy?.id ? String(usedBy.id) : null,
    name: usedBy?.name || usedBy?.email || usedBy?.username || null,
  };

  const updated = {
    ...target,
    status: nextStatus,
    usesCount: nextUses,
    firstUsedAt: target.firstUsedAt || now,
    lastUsedAt: now,
    usedBy: actor,
  };

  list[index] = updated;
  saveCounterKeys(list);

  const users = readUsers();
  const userIndex = users.findIndex((record) => String(record.userId) === String(updated.targetUserId));
  if (userIndex >= 0) {
    users[userIndex] = {
      ...users[userIndex],
      state: "ACESSO_REGISTRADO",
      actionType: "COUNTER_KEY_USE",
      result: "SUCESSO",
      lastAccessAt: now,
      updatedAt: now,
    };
    saveUsers(users);
  }

  appendActivityEvent({
    clientId: updated.clientId,
    userId: updated.targetUserId,
    userName: updated.targetUserName,
    clientName: updated.clientName,
    vehicle: updated.vehicle,
    deviceName: updated.deviceName,
    method: "COUNTER_KEY",
    action: "COUNTER_KEY_USE",
    result: updated.status,
    created_by: updated.createdBy?.name || null,
    used_by: actor.name || actor.id || null,
    extra: {
      usesCount: updated.usesCount,
      maxUses: updated.maxUses,
      status: updated.status,
    },
  });

  return asPublicCounterKey(updated);
}

export function cancelTrustCounterKey({ id, actor = null, clientId = null } = {}) {
  const list = refreshCounterKeyStatuses(readCounterKeys());
  const index = list.findIndex((record) => String(record.id) === String(id));
  if (index < 0) {
    const error = new Error("Contra-senha não encontrada.");
    error.status = 404;
    throw error;
  }

  const target = list[index];
  if (clientId && String(target.clientId || "") !== String(clientId)) {
    const error = new Error("Contra-senha não pertence ao cliente selecionado.");
    error.status = 403;
    throw error;
  }

  const updated = {
    ...target,
    status: "CANCELADA",
    lastUsedAt: target.lastUsedAt || nowIso(),
  };
  list[index] = updated;
  saveCounterKeys(list);

  appendActivityEvent({
    clientId: updated.clientId,
    userId: updated.targetUserId,
    userName: updated.targetUserName,
    clientName: updated.clientName,
    vehicle: updated.vehicle,
    deviceName: updated.deviceName,
    method: "COUNTER_KEY",
    action: "COUNTER_KEY_CANCEL",
    result: "CANCELADA",
    created_by: actor?.name || actor?.id || null,
    extra: {
      status: updated.status,
    },
  });

  return asPublicCounterKey(updated);
}

export default {
  listTrustUsers,
  listTrustUserOptions,
  listTrustUserHistory,
  getTrustUserSummary,
  rotateTrustChallenge,
  simulateTrustCounterKey,
  listTrustActivity,
  exportTrustActivityCsv,
  listTrustCounterKeys,
  createTrustCounterKey,
  useTrustCounterKey,
  cancelTrustCounterKey,
};
