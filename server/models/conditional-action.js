import { randomUUID } from "node:crypto";

import { loadCollection, saveCollection } from "../services/storage.js";

const RULES_STORAGE_KEY = "conditional-action-rules";
const HISTORY_STORAGE_KEY = "conditional-action-history";
const EVENTS_STORAGE_KEY = "conditional-action-events";

const MAX_HISTORY = Number(process.env.CONDITIONAL_ACTION_MAX_HISTORY) || 20000;
const MAX_EVENTS = Number(process.env.CONDITIONAL_ACTION_MAX_EVENTS) || 5000;

let rules = Array.isArray(loadCollection(RULES_STORAGE_KEY, []))
  ? loadCollection(RULES_STORAGE_KEY, [])
  : [];
let historyEntries = Array.isArray(loadCollection(HISTORY_STORAGE_KEY, []))
  ? loadCollection(HISTORY_STORAGE_KEY, [])
  : [];
let syntheticEvents = Array.isArray(loadCollection(EVENTS_STORAGE_KEY, []))
  ? loadCollection(EVENTS_STORAGE_KEY, [])
  : [];

function clone(value) {
  if (value === null || value === undefined) return value;
  return JSON.parse(JSON.stringify(value));
}

function normalizeId(value) {
  if (value === null || value === undefined) return null;
  const normalized = String(value).trim();
  return normalized || null;
}

function normalizeText(value, fallback = "") {
  const text = String(value || "").trim();
  return text || fallback;
}

function normalizeBoolean(value, fallback = false) {
  if (typeof value === "boolean") return value;
  if (value === "true" || value === "1" || value === 1) return true;
  if (value === "false" || value === "0" || value === 0) return false;
  return fallback;
}

function parseDate(value) {
  if (!value) return null;
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return null;
  return new Date(parsed);
}

function normalizeNumber(value, fallback = null, { min = null, max = null } = {}) {
  if (value === null || value === undefined || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  if (min !== null && parsed < min) return min;
  if (max !== null && parsed > max) return max;
  return parsed;
}

function normalizeList(values = []) {
  return Array.from(
    new Set(
      (Array.isArray(values) ? values : [])
        .map((item) => normalizeId(item))
        .filter(Boolean),
    ),
  );
}

function persistRules() {
  saveCollection(RULES_STORAGE_KEY, rules);
}

function persistHistory() {
  saveCollection(HISTORY_STORAGE_KEY, historyEntries);
}

function persistEvents() {
  saveCollection(EVENTS_STORAGE_KEY, syntheticEvents);
}

function normalizeScope(scope = {}) {
  const mode = String(scope?.mode || "all").trim().toLowerCase();
  const resolvedMode = ["all", "vehicles", "devices", "groups"].includes(mode) ? mode : "all";
  return {
    mode: resolvedMode,
    vehicleIds: normalizeList(scope?.vehicleIds),
    deviceIds: normalizeList(scope?.deviceIds),
    groupIds: normalizeList(scope?.groupIds),
  };
}

function normalizeCondition(condition = {}, index = 0) {
  return {
    id: normalizeId(condition?.id) || `cond-${index + 1}-${randomUUID()}`,
    type: normalizeText(condition?.type || "event_equals"),
    enabled: normalizeBoolean(condition?.enabled, true),
    params: condition?.params && typeof condition.params === "object" ? clone(condition.params) : {},
  };
}

function normalizeConditions(payload = {}) {
  const operatorRaw = String(payload?.operator || "AND").trim().toUpperCase();
  const operator = operatorRaw === "OR" ? "OR" : "AND";
  const items = (Array.isArray(payload?.items) ? payload.items : [])
    .map((item, index) => normalizeCondition(item, index))
    .filter((item) => item?.type);
  return { operator, items };
}

function normalizeAction(action = {}, index = 0) {
  return {
    id: normalizeId(action?.id) || `action-${index + 1}-${randomUUID()}`,
    type: normalizeText(action?.type || "audit_log"),
    enabled: normalizeBoolean(action?.enabled, true),
    params: action?.params && typeof action.params === "object" ? clone(action.params) : {},
  };
}

function normalizeActions(payload = []) {
  return (Array.isArray(payload) ? payload : [])
    .map((action, index) => normalizeAction(action, index))
    .filter((action) => action?.type);
}

function normalizeSettings(settings = {}) {
  return {
    cooldownMinutes: normalizeNumber(settings?.cooldownMinutes, 5, { min: 0, max: 24 * 60 }),
    priority: normalizeNumber(settings?.priority, 5, { min: 1, max: 100 }),
    maxExecutionsPerHour: normalizeNumber(settings?.maxExecutionsPerHour, 0, { min: 0, max: 10000 }),
  };
}

function normalizeRulePayload(payload = {}) {
  return {
    name: normalizeText(payload?.name),
    description: normalizeText(payload?.description),
    active: normalizeBoolean(payload?.active, true),
    scope: normalizeScope(payload?.scope),
    conditions: normalizeConditions(payload?.conditions),
    actions: normalizeActions(payload?.actions),
    settings: normalizeSettings(payload?.settings),
  };
}

function updateRuleExecutionMetadata(rule, { scopeKey, triggeredAt }) {
  const execution = rule?.execution && typeof rule.execution === "object" ? { ...rule.execution } : {};
  const previousScopeExecutions =
    execution?.lastScopeExecutions && typeof execution.lastScopeExecutions === "object"
      ? { ...execution.lastScopeExecutions }
      : {};
  if (scopeKey) {
    previousScopeExecutions[scopeKey] = triggeredAt;
  }
  return {
    ...rule,
    lastExecutedAt: triggeredAt,
    executionCount: Number(rule?.executionCount || 0) + 1,
    execution: {
      ...execution,
      lastExecutedAt: triggeredAt,
      lastScopeExecutions: previousScopeExecutions,
    },
  };
}

export function listConditionalActionRules({ clientId, search = "", status = "" } = {}) {
  const normalizedClientId = normalizeId(clientId);
  const searchTerm = String(search || "").trim().toLowerCase();
  const statusTerm = String(status || "").trim().toLowerCase();
  return rules
    .filter((rule) => (!normalizedClientId ? true : String(rule.clientId) === normalizedClientId))
    .filter((rule) => {
      if (!searchTerm) return true;
      const text = [rule.name, rule.description].filter(Boolean).join(" ").toLowerCase();
      return text.includes(searchTerm);
    })
    .filter((rule) => {
      if (!statusTerm) return true;
      if (statusTerm === "active" || statusTerm === "ativa" || statusTerm === "ativo") return rule.active === true;
      if (statusTerm === "inactive" || statusTerm === "inativa" || statusTerm === "inativo") return rule.active === false;
      return true;
    })
    .sort((a, b) => Date.parse(b?.updatedAt || 0) - Date.parse(a?.updatedAt || 0))
    .map(clone);
}

export function getConditionalActionRuleById(id, { clientId } = {}) {
  const normalizedId = normalizeId(id);
  if (!normalizedId) return null;
  const normalizedClientId = normalizeId(clientId);
  const found = rules.find((rule) => {
    if (String(rule.id) !== normalizedId) return false;
    if (!normalizedClientId) return true;
    return String(rule.clientId) === normalizedClientId;
  });
  return found ? clone(found) : null;
}

export function createConditionalActionRule({
  clientId,
  payload = {},
  createdBy = null,
  createdByName = null,
} = {}) {
  const normalizedClientId = normalizeId(clientId);
  if (!normalizedClientId) {
    throw new Error("clientId é obrigatório para criar regra condicional.");
  }
  const normalized = normalizeRulePayload(payload);
  if (!normalized.name) {
    throw new Error("Nome da regra é obrigatório.");
  }
  if (!normalized.conditions.items.length) {
    throw new Error("A regra precisa de ao menos uma condição.");
  }
  if (!normalized.actions.length) {
    throw new Error("A regra precisa de ao menos uma ação.");
  }

  const now = new Date().toISOString();
  const record = {
    id: randomUUID(),
    clientId: normalizedClientId,
    ...normalized,
    createdAt: now,
    updatedAt: now,
    createdBy: normalizeId(createdBy),
    createdByName: normalizeText(createdByName),
    updatedBy: normalizeId(createdBy),
    updatedByName: normalizeText(createdByName),
    lastExecutedAt: null,
    executionCount: 0,
    execution: {
      lastExecutedAt: null,
      lastScopeExecutions: {},
    },
  };

  rules = [record, ...rules];
  persistRules();
  return clone(record);
}

export function updateConditionalActionRule(id, {
  clientId,
  payload = {},
  updatedBy = null,
  updatedByName = null,
} = {}) {
  const normalizedId = normalizeId(id);
  const normalizedClientId = normalizeId(clientId);
  const index = rules.findIndex((rule) => {
    if (String(rule.id) !== normalizedId) return false;
    if (!normalizedClientId) return true;
    return String(rule.clientId) === normalizedClientId;
  });
  if (index < 0) return null;

  const current = rules[index];
  const normalized = normalizeRulePayload({
    ...current,
    ...payload,
    scope: payload?.scope ?? current.scope,
    conditions: payload?.conditions ?? current.conditions,
    actions: payload?.actions ?? current.actions,
    settings: payload?.settings ?? current.settings,
    active: Object.prototype.hasOwnProperty.call(payload || {}, "active") ? payload.active : current.active,
  });

  if (!normalized.name) {
    throw new Error("Nome da regra é obrigatório.");
  }
  if (!normalized.conditions.items.length) {
    throw new Error("A regra precisa de ao menos uma condição.");
  }
  if (!normalized.actions.length) {
    throw new Error("A regra precisa de ao menos uma ação.");
  }

  const next = {
    ...current,
    ...normalized,
    updatedAt: new Date().toISOString(),
    updatedBy: normalizeId(updatedBy),
    updatedByName: normalizeText(updatedByName),
  };
  rules[index] = next;
  persistRules();
  return clone(next);
}

export function deleteConditionalActionRule(id, { clientId } = {}) {
  const normalizedId = normalizeId(id);
  const normalizedClientId = normalizeId(clientId);
  const previousLength = rules.length;
  rules = rules.filter((rule) => {
    if (String(rule.id) !== normalizedId) return true;
    if (!normalizedClientId) return false;
    return String(rule.clientId) !== normalizedClientId;
  });
  if (rules.length === previousLength) return false;
  persistRules();
  return true;
}

export function toggleConditionalActionRule(id, { clientId, active = null, updatedBy = null, updatedByName = null } = {}) {
  const normalizedId = normalizeId(id);
  const normalizedClientId = normalizeId(clientId);
  const index = rules.findIndex((rule) => {
    if (String(rule.id) !== normalizedId) return false;
    if (!normalizedClientId) return true;
    return String(rule.clientId) === normalizedClientId;
  });
  if (index < 0) return null;
  const current = rules[index];
  const nextActive = active === null ? !current.active : normalizeBoolean(active, current.active);
  const next = {
    ...current,
    active: nextActive,
    updatedAt: new Date().toISOString(),
    updatedBy: normalizeId(updatedBy),
    updatedByName: normalizeText(updatedByName),
  };
  rules[index] = next;
  persistRules();
  return clone(next);
}

export function duplicateConditionalActionRule(id, { clientId, createdBy = null, createdByName = null } = {}) {
  const original = getConditionalActionRuleById(id, { clientId });
  if (!original) return null;
  const now = new Date().toISOString();
  const duplicated = {
    ...original,
    id: randomUUID(),
    name: `${original.name} (cópia)`,
    active: false,
    createdAt: now,
    updatedAt: now,
    createdBy: normalizeId(createdBy),
    createdByName: normalizeText(createdByName),
    updatedBy: normalizeId(createdBy),
    updatedByName: normalizeText(createdByName),
    lastExecutedAt: null,
    executionCount: 0,
    execution: {
      lastExecutedAt: null,
      lastScopeExecutions: {},
    },
  };
  rules = [duplicated, ...rules];
  persistRules();
  return clone(duplicated);
}

export function appendConditionalActionHistory(entry = {}) {
  const now = new Date().toISOString();
  const record = {
    id: randomUUID(),
    clientId: normalizeId(entry.clientId),
    ruleId: normalizeId(entry.ruleId),
    ruleName: normalizeText(entry.ruleName, "Regra condicional"),
    trigger: normalizeText(entry.trigger, "telemetry"),
    status: normalizeText(entry.status, "executed"),
    triggeredAt: normalizeText(entry.triggeredAt, now),
    vehicleId: normalizeId(entry.vehicleId),
    deviceId: normalizeId(entry.deviceId),
    scopeKey: normalizeText(entry.scopeKey),
    conditionSummary: entry.conditionSummary ? clone(entry.conditionSummary) : null,
    actionResults: Array.isArray(entry.actionResults) ? clone(entry.actionResults) : [],
    contextSnapshot: entry.contextSnapshot && typeof entry.contextSnapshot === "object" ? clone(entry.contextSnapshot) : {},
    createdBy: normalizeId(entry.createdBy),
    createdByName: normalizeText(entry.createdByName),
    ipAddress: normalizeText(entry.ipAddress),
  };

  historyEntries = [record, ...historyEntries].slice(0, MAX_HISTORY);
  persistHistory();

  const ruleIndex = rules.findIndex((rule) => String(rule.id) === String(record.ruleId));
  if (ruleIndex >= 0) {
    rules[ruleIndex] = updateRuleExecutionMetadata(rules[ruleIndex], {
      scopeKey: record.scopeKey || null,
      triggeredAt: record.triggeredAt,
    });
    persistRules();
  }

  return clone(record);
}

export function listConditionalActionHistory({
  clientId,
  ruleId,
  vehicleId,
  deviceId,
  from,
  to,
  trigger,
  status,
  search = "",
  page = 1,
  limit = 100,
} = {}) {
  const normalizedClientId = normalizeId(clientId);
  const normalizedRuleId = normalizeId(ruleId);
  const normalizedVehicleId = normalizeId(vehicleId);
  const normalizedDeviceId = normalizeId(deviceId);
  const normalizedTrigger = normalizeText(trigger).toLowerCase();
  const normalizedStatus = normalizeText(status).toLowerCase();
  const searchTerm = normalizeText(search).toLowerCase();
  const fromDate = parseDate(from);
  const toDate = parseDate(to);
  const safePage = Math.max(1, Number(page) || 1);
  const safeLimit = Math.min(1000, Math.max(1, Number(limit) || 100));

  const filtered = historyEntries
    .filter((entry) => (!normalizedClientId ? true : String(entry.clientId) === normalizedClientId))
    .filter((entry) => (!normalizedRuleId ? true : String(entry.ruleId) === normalizedRuleId))
    .filter((entry) => (!normalizedVehicleId ? true : String(entry.vehicleId || "") === normalizedVehicleId))
    .filter((entry) => (!normalizedDeviceId ? true : String(entry.deviceId || "") === normalizedDeviceId))
    .filter((entry) => (!normalizedTrigger ? true : String(entry.trigger || "").toLowerCase() === normalizedTrigger))
    .filter((entry) => (!normalizedStatus ? true : String(entry.status || "").toLowerCase() === normalizedStatus))
    .filter((entry) => {
      if (!searchTerm) return true;
      const haystack = [
        entry.ruleName,
        entry.trigger,
        entry.status,
        entry.vehicleId,
        entry.deviceId,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(searchTerm);
    })
    .filter((entry) => {
      if (!fromDate && !toDate) return true;
      const at = parseDate(entry.triggeredAt);
      if (!at) return false;
      if (fromDate && at < fromDate) return false;
      if (toDate && at > toDate) return false;
      return true;
    })
    .sort((a, b) => Date.parse(b?.triggeredAt || 0) - Date.parse(a?.triggeredAt || 0));

  const total = filtered.length;
  const start = (safePage - 1) * safeLimit;
  return {
    data: filtered.slice(start, start + safeLimit).map(clone),
    total,
    page: safePage,
    pageSize: safeLimit,
    totalPages: Math.max(1, Math.ceil(total / safeLimit)),
  };
}

export function appendConditionalActionEvent(event = {}) {
  if (!event?.id) return null;
  syntheticEvents = [clone(event), ...syntheticEvents].slice(0, MAX_EVENTS);
  persistEvents();
  return clone(event);
}

export function listConditionalActionEvents({ clientId, deviceIds = [], from, to } = {}) {
  const normalizedClientId = normalizeId(clientId);
  const deviceSet = new Set((Array.isArray(deviceIds) ? deviceIds : []).map((item) => String(item)));
  const fromDate = parseDate(from);
  const toDate = parseDate(to);

  return syntheticEvents
    .filter((event) => (!normalizedClientId ? true : String(event?.clientId || "") === normalizedClientId))
    .filter((event) => (!deviceSet.size ? true : deviceSet.has(String(event?.deviceId || ""))))
    .filter((event) => {
      if (!fromDate && !toDate) return true;
      const eventDate = parseDate(event?.eventTime || event?.serverTime);
      if (!eventDate) return false;
      if (fromDate && eventDate < fromDate) return false;
      if (toDate && eventDate > toDate) return false;
      return true;
    })
    .map(clone);
}

export function getConditionalActionScopeLastExecution(rule, scopeKey) {
  const raw = rule?.execution?.lastScopeExecutions?.[scopeKey];
  return raw || null;
}

export function __resetConditionalActionsForTests() {
  rules = [];
  historyEntries = [];
  syntheticEvents = [];
  saveCollection(RULES_STORAGE_KEY, []);
  saveCollection(HISTORY_STORAGE_KEY, []);
  saveCollection(EVENTS_STORAGE_KEY, []);
}

