import { randomUUID } from "node:crypto";

import { listGeofences } from "../models/geofence.js";
import { getRouteById } from "../models/route.js";
import {
  appendConditionalActionEvent,
  appendConditionalActionHistory,
  getConditionalActionScopeLastExecution,
  listConditionalActionRules,
} from "../models/conditional-action.js";
import { upsertAlertFromEvent } from "./alerts.js";
import { traccarProxy } from "./traccar.js";

const RULE_CACHE_TTL_MS = Number(process.env.CONDITIONAL_ACTION_RULE_CACHE_MS) || 15_000;
const GEOFENCE_CACHE_TTL_MS = Number(process.env.CONDITIONAL_ACTION_GEOFENCE_CACHE_MS) || 45_000;
const RUNTIME_STATE_TTL_MS = Number(process.env.CONDITIONAL_ACTION_RUNTIME_TTL_MS) || 12 * 60 * 60 * 1000;
const HOUR_WINDOW_MS = 60 * 60 * 1000;
const SPEED_KNOT_TO_KMH = 1.852;
const LAT_METERS = 111_320;

const rulesCache = new Map();
const geofenceCache = new Map();
const runtimeState = new Map();

const TRUE_VALUES = new Set(["true", "1", "on", "yes", "sim", "ativo", "ligado"]);
const FALSE_VALUES = new Set(["false", "0", "off", "no", "nao", "não", "inativo", "desligado"]);
const CRITICAL_SEVERITIES = new Set(["critical", "critica", "crítica", "grave"]);
const WARNING_SEVERITIES = new Set(["warning", "high", "alta", "alerta", "alarme"]);

function normalizeId(value) {
  if (value === null || value === undefined) return null;
  const normalized = String(value).trim();
  return normalized || null;
}

function normalizeText(value, fallback = "") {
  const normalized = String(value || "").trim();
  return normalized || fallback;
}

function normalizeBoolean(value, fallback = null) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  const normalized = normalizeText(value).toLowerCase();
  if (!normalized) return fallback;
  if (TRUE_VALUES.has(normalized)) return true;
  if (FALSE_VALUES.has(normalized)) return false;
  return fallback;
}

function parseNumber(value, fallback = null) {
  if (value === null || value === undefined || value === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseDate(value) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return null;
  return new Date(parsed);
}

function normalizeSeverity(value, fallback = "warning") {
  const normalized = normalizeText(value).toLowerCase();
  if (!normalized) return fallback;
  if (CRITICAL_SEVERITIES.has(normalized)) return "critical";
  if (WARNING_SEVERITIES.has(normalized)) return "warning";
  if (["info", "informativa", "low", "baixa"].includes(normalized)) return "info";
  return normalized;
}

function computeMetersPerLon(referenceLat) {
  return LAT_METERS * Math.cos((referenceLat * Math.PI) / 180);
}

function toProjectedMeters(point, referenceLat) {
  const lat = parseNumber(point?.[0], null);
  const lng = parseNumber(point?.[1], null);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const metersPerLon = computeMetersPerLon(referenceLat);
  if (!Number.isFinite(metersPerLon) || metersPerLon === 0) return null;
  return { x: lng * metersPerLon, y: lat * LAT_METERS };
}

function distanceBetweenMeters(a, b) {
  const lat1 = parseNumber(a?.[0], null);
  const lon1 = parseNumber(a?.[1], null);
  const lat2 = parseNumber(b?.[0], null);
  const lon2 = parseNumber(b?.[1], null);
  if (!Number.isFinite(lat1) || !Number.isFinite(lon1) || !Number.isFinite(lat2) || !Number.isFinite(lon2)) {
    return Infinity;
  }
  const toRad = (value) => (value * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const sinLat = Math.sin(dLat / 2);
  const sinLon = Math.sin(dLon / 2);
  const h = sinLat * sinLat + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * sinLon * sinLon;
  const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  return 6_371_000 * c;
}

function distanceToPolylineMeters(point, points = []) {
  if (!Array.isArray(points) || points.length < 2) return Infinity;
  const referenceLat = parseNumber(point?.[0], null);
  if (!Number.isFinite(referenceLat)) return Infinity;
  const projectedPoint = toProjectedMeters(point, referenceLat);
  if (!projectedPoint) return Infinity;

  let best = Infinity;
  for (let index = 0; index < points.length - 1; index += 1) {
    const start = toProjectedMeters(points[index], referenceLat);
    const end = toProjectedMeters(points[index + 1], referenceLat);
    if (!start || !end) continue;
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const denom = dx * dx + dy * dy;
    const ratio = denom > 0
      ? Math.max(0, Math.min(1, ((projectedPoint.x - start.x) * dx + (projectedPoint.y - start.y) * dy) / denom))
      : 0;
    const closestX = start.x + dx * ratio;
    const closestY = start.y + dy * ratio;
    const distance = Math.hypot(projectedPoint.x - closestX, projectedPoint.y - closestY);
    if (distance < best) best = distance;
  }
  return best;
}

function isPointInPolygon(point, polygon = []) {
  const lat = parseNumber(point?.[0], null);
  const lng = parseNumber(point?.[1], null);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  if (!Array.isArray(polygon) || polygon.length < 3) return false;

  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const pi = polygon[i];
    const pj = polygon[j];
    const yi = parseNumber(pi?.[0], null);
    const xi = parseNumber(pi?.[1], null);
    const yj = parseNumber(pj?.[0], null);
    const xj = parseNumber(pj?.[1], null);
    if (!Number.isFinite(yi) || !Number.isFinite(xi) || !Number.isFinite(yj) || !Number.isFinite(xj)) continue;
    const intersects = (yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

function resolveScopeKey({ vehicleId, deviceId } = {}) {
  const normalizedVehicleId = normalizeId(vehicleId);
  if (normalizedVehicleId) return `vehicle:${normalizedVehicleId}`;
  const normalizedDeviceId = normalizeId(deviceId);
  if (normalizedDeviceId) return `device:${normalizedDeviceId}`;
  return "scope:unknown";
}

function resolveConditionRuntime(ruleId, scopeKey, conditionId) {
  const key = `${ruleId}:${scopeKey}`;
  const current = runtimeState.get(key) || {
    touchedAt: Date.now(),
    executions: [],
    conditions: {},
  };
  current.touchedAt = Date.now();
  runtimeState.set(key, current);
  if (!conditionId) return current.conditions;
  if (!current.conditions[conditionId]) {
    current.conditions[conditionId] = {};
  }
  return current.conditions[conditionId];
}

function trimRuntimeState(nowMs = Date.now()) {
  for (const [key, item] of runtimeState.entries()) {
    if (!item || nowMs - Number(item.touchedAt || 0) > RUNTIME_STATE_TTL_MS) {
      runtimeState.delete(key);
      continue;
    }
    item.executions = (Array.isArray(item.executions) ? item.executions : []).filter((at) => nowMs - at <= HOUR_WINDOW_MS);
  }
}

function isRuleInScope(rule, context) {
  const mode = String(rule?.scope?.mode || "all").toLowerCase();
  const vehicleId = normalizeId(context?.vehicleId);
  const deviceId = normalizeId(context?.deviceId);

  if (mode === "all") return true;
  if (mode === "vehicles") {
    const allowed = new Set((rule?.scope?.vehicleIds || []).map((item) => String(item)));
    return vehicleId ? allowed.has(vehicleId) : false;
  }
  if (mode === "devices") {
    const allowed = new Set((rule?.scope?.deviceIds || []).map((item) => String(item)));
    return deviceId ? allowed.has(deviceId) : false;
  }
  if (mode === "groups") {
    const allowed = new Set((rule?.scope?.groupIds || []).map((item) => String(item)));
    const vehicleGroup =
      normalizeId(context?.vehicle?.groupId) ||
      normalizeId(context?.vehicle?.group) ||
      normalizeId(context?.vehicle?.attributes?.groupId) ||
      normalizeId(context?.vehicle?.attributes?.group);
    return vehicleGroup ? allowed.has(vehicleGroup) : false;
  }
  return false;
}

async function getActiveRules(clientId) {
  const key = normalizeId(clientId) || "default";
  const now = Date.now();
  const cached = rulesCache.get(key);
  if (cached && cached.expiresAt > now) {
    return cached.rules;
  }
  const rules = listConditionalActionRules({ clientId: key }).filter((rule) => rule?.active);
  rulesCache.set(key, {
    rules,
    expiresAt: now + RULE_CACHE_TTL_MS,
  });
  return rules;
}

async function getGeofencesByClient(clientId) {
  const key = normalizeId(clientId) || "default";
  const now = Date.now();
  const cached = geofenceCache.get(key);
  if (cached && cached.expiresAt > now) {
    return cached.items;
  }
  let items = [];
  try {
    items = await listGeofences({ clientId: key });
  } catch (error) {
    console.warn("[conditional-actions] falha ao carregar geofences", {
      clientId: key,
      message: error?.message || error,
    });
  }
  geofenceCache.set(key, {
    items: Array.isArray(items) ? items : [],
    expiresAt: now + GEOFENCE_CACHE_TTL_MS,
  });
  return Array.isArray(items) ? items : [];
}

function resolvePositionPoint(position) {
  const lat = parseNumber(position?.latitude ?? position?.lat, null);
  const lng = parseNumber(position?.longitude ?? position?.lng ?? position?.lon, null);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return [lat, lng];
}

function resolvePositionTimestamp(position) {
  return (
    parseDate(position?.fixTime) ||
    parseDate(position?.deviceTime) ||
    parseDate(position?.serverTime) ||
    parseDate(position?.timestamp) ||
    new Date()
  );
}

function resolveSpeedKmh(position, attrs = {}) {
  const direct = parseNumber(position?.speed, null);
  if (!Number.isFinite(direct)) return null;
  const alreadyKmh = parseNumber(attrs?.speedKmh ?? attrs?.speed_kmh, null);
  if (Number.isFinite(alreadyKmh)) return alreadyKmh;
  // Traccar costuma enviar speed em nós.
  return Number((direct * SPEED_KNOT_TO_KMH).toFixed(2));
}

function resolveIgnition(position, attrs = {}) {
  const values = [
    attrs?.ignition,
    attrs?.ign,
    attrs?.acc,
    position?.ignition,
    position?.attributes?.ignition,
    position?.attributes?.ign,
    position?.attributes?.acc,
  ];
  for (const value of values) {
    const parsed = normalizeBoolean(value, null);
    if (parsed !== null) return parsed;
  }
  return null;
}

function resolveDigitalInput(attrs = {}, index = 1) {
  const normalizedIndex = Math.max(1, Math.floor(parseNumber(index, 1)));
  const keys = [
    `input${normalizedIndex}`,
    `in${normalizedIndex}`,
    `digitalInput${normalizedIndex}`,
    `digitalinput${normalizedIndex}`,
    `entrada${normalizedIndex}`,
  ];
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(attrs, key)) {
      return normalizeBoolean(attrs[key], null);
    }
  }
  return null;
}

function resolveNoSignalAgeMs(position, nowMs) {
  const lastFix = resolvePositionTimestamp(position);
  return Math.max(0, nowMs - lastFix.getTime());
}

function resolveGeofenceInside(point, geofence) {
  if (!point || !geofence) return false;
  const type = String(geofence?.type || "").toLowerCase();
  if (type === "circle") {
    const center = geofence?.center || [geofence?.latitude, geofence?.longitude];
    const radius = parseNumber(geofence?.radius, null);
    if (!center || !Number.isFinite(radius) || radius <= 0) return false;
    const distance = distanceBetweenMeters(point, center);
    return distance <= radius;
  }

  const points = Array.isArray(geofence?.points) ? geofence.points : [];
  return isPointInPolygon(point, points);
}

async function resolveGeofenceForCondition(condition, context) {
  const params = condition?.params || {};
  const geofenceId = normalizeId(params.geofenceId || params.targetId || params.id);
  const geofenceName = normalizeText(params.geofenceName || params.name);
  const geofences = await getGeofencesByClient(context.clientId);

  let target = geofenceId
    ? geofences.find((item) => String(item?.id) === geofenceId)
    : null;
  if (!target && geofenceName) {
    const lowerName = geofenceName.toLowerCase();
    target = geofences.find((item) => String(item?.name || "").trim().toLowerCase() === lowerName);
  }
  return target || null;
}

function resolveRouteDistanceMeters(route, point) {
  if (!route || !point) return Infinity;
  const routePoints = Array.isArray(route?.points) ? route.points : [];
  return distanceToPolylineMeters(point, routePoints);
}

function resolveScopeHourlyLimit(rule, scopeRuntime, nowMs) {
  const maxExecutionsPerHour = parseNumber(rule?.settings?.maxExecutionsPerHour, 0);
  if (!maxExecutionsPerHour || maxExecutionsPerHour <= 0) {
    return { limited: false, count: Array.isArray(scopeRuntime.executions) ? scopeRuntime.executions.length : 0 };
  }

  const executions = (Array.isArray(scopeRuntime.executions) ? scopeRuntime.executions : [])
    .filter((entry) => nowMs - entry <= HOUR_WINDOW_MS);
  scopeRuntime.executions = executions;
  return {
    limited: executions.length >= maxExecutionsPerHour,
    count: executions.length,
    max: maxExecutionsPerHour,
  };
}

async function evaluateCondition(condition, context, scopeKey) {
  const type = normalizeText(condition?.type).toLowerCase();
  const params = condition?.params && typeof condition.params === "object" ? condition.params : {};
  const attrs = context?.attributes || context?.position?.attributes || {};
  const point = resolvePositionPoint(context?.position);
  const nowMs = context?.nowMs || Date.now();
  const conditionRuntime = resolveConditionRuntime(context?.rule?.id, scopeKey, condition?.id);

  if (!type) {
    return { matched: false, reason: "empty_type", capture: {} };
  }

  if (type === "always") {
    return { matched: true, capture: { type } };
  }

  if (["speed_above", "speedgreater", "speed_above_kmh"].includes(type)) {
    const threshold = parseNumber(params?.threshold ?? params?.value ?? params?.speed, 0);
    const durationSeconds = Math.max(0, parseNumber(params?.durationSeconds ?? params?.seconds ?? params?.duration, 0));
    const speedKmh = resolveSpeedKmh(context?.position, attrs);
    const isAbove = Number.isFinite(speedKmh) && speedKmh > threshold;
    if (!isAbove) {
      conditionRuntime.aboveSinceAt = null;
      return { matched: false, capture: { speedKmh, threshold, durationSeconds } };
    }
    if (!conditionRuntime.aboveSinceAt) {
      conditionRuntime.aboveSinceAt = nowMs;
    }
    const elapsedMs = nowMs - Number(conditionRuntime.aboveSinceAt || nowMs);
    const requiredMs = durationSeconds * 1000;
    const matched = elapsedMs >= requiredMs;
    return { matched, capture: { speedKmh, threshold, durationSeconds, elapsedMs: Math.max(0, elapsedMs) } };
  }

  if (["ignition_state", "ignition", "ignition_is"].includes(type)) {
    const expected = normalizeBoolean(params?.state ?? params?.value ?? true, true);
    const current = resolveIgnition(context?.position, attrs);
    return { matched: current === expected, capture: { ignition: current, expected } };
  }

  if (["digital_input_active", "input_active", "digital_input"].includes(type)) {
    const index = Math.max(1, Math.floor(parseNumber(params?.input ?? params?.index ?? 1, 1)));
    const expected = normalizeBoolean(params?.active ?? params?.value ?? true, true);
    const current = resolveDigitalInput(attrs, index);
    return { matched: current === expected, capture: { input: index, current, expected } };
  }

  if (["no_signal_for", "no_signal", "without_signal"].includes(type)) {
    const minutes = Math.max(0, parseNumber(params?.minutes ?? params?.value ?? 0, 0));
    const thresholdMs = minutes * 60 * 1000;
    const ageMs = resolveNoSignalAgeMs(context?.position, nowMs);
    return { matched: ageMs >= thresholdMs, capture: { ageMs, thresholdMs } };
  }

  if (["event_equals", "event_occurred"].includes(type)) {
    const expected = normalizeText(params?.eventId ?? params?.eventType ?? params?.value).toLowerCase();
    const events = Array.isArray(context?.events) ? context.events : [];
    const matchedEvent = expected
      ? events.find((event) => {
          const candidates = [
            event?.eventId,
            event?.type,
            event?.eventType,
            event?.normalizedEvent?.eventId,
            event?.normalizedEvent?.typeKey,
          ]
            .map((value) => normalizeText(value).toLowerCase())
            .filter(Boolean);
          return candidates.includes(expected);
        })
      : null;
    return {
      matched: Boolean(matchedEvent),
      capture: {
        expected,
        eventId: matchedEvent?.eventId || matchedEvent?.id || null,
      },
    };
  }

  if (["outside_route", "route_deviation", "route_outside"].includes(type)) {
    const routeId = normalizeId(params?.routeId || params?.value);
    const toleranceMeters = Math.max(0, parseNumber(params?.toleranceMeters ?? params?.tolerance ?? 200, 200));
    const route = routeId ? getRouteById(routeId) : null;
    if (!route || !point) {
      return { matched: false, capture: { routeId, toleranceMeters, distanceMeters: null } };
    }
    const distanceMeters = resolveRouteDistanceMeters(route, point);
    return { matched: distanceMeters > toleranceMeters, capture: { routeId, toleranceMeters, distanceMeters } };
  }

  if (["geofence_enter", "geofence_exit", "geofence_inside", "geofence_outside", "target_near", "target_arrive"].includes(type)) {
    const geofence = await resolveGeofenceForCondition(condition, context);
    if (!geofence || !point) {
      return { matched: false, capture: { geofenceId: geofence?.id || null, inside: false } };
    }
    const inside = resolveGeofenceInside(point, geofence);
    const previousInside = normalizeBoolean(conditionRuntime.previousInside, false);
    conditionRuntime.previousInside = inside;

    if (type === "geofence_inside") {
      return { matched: inside, capture: { geofenceId: geofence.id, geofenceName: geofence.name, inside } };
    }
    if (type === "geofence_outside") {
      return { matched: !inside, capture: { geofenceId: geofence.id, geofenceName: geofence.name, inside } };
    }
    if (type === "geofence_enter" || type === "target_arrive" || type === "target_near") {
      return {
        matched: !previousInside && inside,
        capture: { geofenceId: geofence.id, geofenceName: geofence.name, inside, previousInside },
      };
    }
    return {
      matched: previousInside && !inside,
      capture: { geofenceId: geofence.id, geofenceName: geofence.name, inside, previousInside },
    };
  }

  return { matched: false, reason: "unsupported_type", capture: { type } };
}

async function evaluateRuleConditions(rule, context, scopeKey) {
  const operator = String(rule?.conditions?.operator || "AND").toUpperCase() === "OR" ? "OR" : "AND";
  const enabledConditions = (Array.isArray(rule?.conditions?.items) ? rule.conditions.items : [])
    .filter((condition) => condition?.enabled !== false);

  if (!enabledConditions.length) {
    return { matched: false, operator, results: [] };
  }

  const results = [];
  for (const condition of enabledConditions) {
    const result = await evaluateCondition(condition, { ...context, rule }, scopeKey);
    results.push({
      id: condition?.id || null,
      type: condition?.type || null,
      matched: Boolean(result?.matched),
      capture: result?.capture || {},
      reason: result?.reason || null,
    });
  }

  const matched = operator === "OR"
    ? results.some((item) => item.matched)
    : results.every((item) => item.matched);

  return { matched, operator, results };
}

function buildConditionalEvent({
  rule,
  action,
  context,
  nowIso,
  conditionResults,
  severity,
  requiresHandling,
}) {
  const titleFromAction = normalizeText(action?.params?.title || action?.params?.label);
  const title = titleFromAction || `Ação condicional: ${rule?.name || "Regra"}`;
  const vehicleLabel = context?.vehicleLabel || context?.plate || context?.vehicle?.name || null;
  const latitude = parseNumber(context?.position?.latitude ?? context?.position?.lat, null);
  const longitude = parseNumber(context?.position?.longitude ?? context?.position?.lng ?? context?.position?.lon, null);

  return {
    id: `conditional-action:${randomUUID()}`,
    eventId: normalizeText(action?.params?.eventId || "ACAO_CONDICIONAL"),
    type: normalizeText(action?.params?.eventType || "conditionalActionTrigger"),
    eventType: normalizeText(action?.params?.eventType || "conditionalActionTrigger"),
    eventLabel: title,
    eventSeverity: severity,
    eventCategory: normalizeText(action?.params?.category || "Automação"),
    eventRequiresHandling: Boolean(requiresHandling),
    eventActive: true,
    source: "conditional-action",
    synthetic: true,
    eventTime: nowIso,
    serverTime: new Date().toISOString(),
    clientId: normalizeId(context?.clientId),
    vehicleId: normalizeId(context?.vehicleId),
    deviceId: normalizeId(context?.deviceId),
    latitude,
    longitude,
    address: context?.position?.address || context?.position?.shortAddress || null,
    protocol: context?.position?.protocol || context?.attributes?.protocol || null,
    attributes: {
      ruleId: rule?.id || null,
      ruleName: rule?.name || null,
      scopeKey: context?.scopeKey || null,
      vehicleLabel,
      conditionResults,
      actionType: action?.type || null,
    },
    normalizedEvent: {
      title,
      label: title,
      severity: severity === "critical" ? "Crítica" : severity === "warning" ? "Alerta" : "Informativa",
      category: normalizeText(action?.params?.category || "Automação"),
      requiresHandling: Boolean(requiresHandling),
      typeKey: "conditionalActionTrigger",
      eventId: normalizeText(action?.params?.eventId || "ACAO_CONDICIONAL"),
    },
  };
}

function buildAlertConfigFromEvent(event) {
  return {
    label: event?.eventLabel || "Ação Condicional",
    severity: event?.eventSeverity || "warning",
    category: event?.eventCategory || "Automação",
    requiresHandling: true,
    active: true,
  };
}

function resolveCommandPayload(action, context) {
  const params = action?.params && typeof action.params === "object" ? action.params : {};
  const providedPayload = params?.payload && typeof params.payload === "object" ? { ...params.payload } : null;
  if (providedPayload) {
    const numericDeviceId = parseNumber(context?.deviceId, null);
    if (Number.isFinite(numericDeviceId)) {
      providedPayload.deviceId = numericDeviceId;
    }
    return providedPayload;
  }

  const type = normalizeText(params?.commandType || params?.type || "custom");
  const attributes = params?.attributes && typeof params.attributes === "object" ? { ...params.attributes } : {};
  if (!Object.keys(attributes).length && params?.data !== undefined) {
    attributes.data = params.data;
  }
  const numericDeviceId = parseNumber(context?.deviceId, null);
  if (!Number.isFinite(numericDeviceId)) {
    return null;
  }
  return {
    deviceId: numericDeviceId,
    type,
    attributes,
  };
}

async function executeAction(action, context) {
  const type = normalizeText(action?.type).toLowerCase();
  const severity = normalizeSeverity(action?.params?.severity, "warning");
  const requiresHandling = normalizeBoolean(action?.params?.requiresHandling, null);
  const nowIso = new Date().toISOString();

  if (!type || type === "audit_log") {
    return {
      type: type || "audit_log",
      status: "success",
      description: "Registro em auditoria",
      event: null,
    };
  }

  if (["create_alert", "create_event", "notify_popup", "notify_user", "notify_internal"].includes(type)) {
    const event = buildConditionalEvent({
      rule: context.rule,
      action,
      context,
      nowIso,
      conditionResults: context.conditionResults,
      severity,
      requiresHandling: requiresHandling ?? (type === "create_alert" || type === "notify_popup"),
    });
    appendConditionalActionEvent(event);

    if (event.eventRequiresHandling) {
      upsertAlertFromEvent({
        clientId: context.clientId,
        event,
        configuredEvent: buildAlertConfigFromEvent(event),
        deviceId: context.deviceId,
        vehicleId: context.vehicleId,
        vehicleLabel: context.vehicleLabel || context.plate || null,
        plate: context.plate || null,
        address: context.position?.address || null,
        protocol: context.position?.protocol || context.attributes?.protocol || null,
      });
    }

    return {
      type,
      status: "success",
      eventId: event.id,
      description: "Evento sintético gerado",
      event,
    };
  }

  if (["send_command", "block_vehicle", "output_1", "output_2", "activate_output"].includes(type)) {
    const payload = resolveCommandPayload(action, context);
    if (!payload) {
      return {
        type,
        status: "failed",
        description: "Dispositivo incompatível para envio de comando",
      };
    }
    try {
      const response = await traccarProxy("post", "/commands/send", {
        data: payload,
        asAdmin: true,
      });
      return {
        type,
        status: "success",
        description: "Comando enviado",
        commandId: response?.id || response?.commandId || null,
      };
    } catch (error) {
      return {
        type,
        status: "failed",
        description: error?.message || "Falha ao enviar comando",
      };
    }
  }

  return {
    type,
    status: "skipped",
    description: "Tipo de ação não suportado",
  };
}

function resolveHistoryStatus(actionResults = []) {
  if (!actionResults.length) return "executed";
  const hasFailure = actionResults.some((item) => item?.status === "failed");
  const hasSuccess = actionResults.some((item) => item?.status === "success");
  if (hasFailure && hasSuccess) return "partial";
  if (hasFailure) return "failed";
  if (hasSuccess) return "success";
  return "executed";
}

export function invalidateConditionalActionRulesCache(clientId = null) {
  if (!clientId) {
    rulesCache.clear();
    return;
  }
  rulesCache.delete(String(clientId));
}

export async function ingestConditionalActions({
  clientId,
  vehicleId,
  deviceId,
  vehicle = null,
  vehicleLabel = null,
  plate = null,
  position = null,
  attributes = {},
  events = [],
} = {}) {
  const normalizedClientId = normalizeId(clientId);
  const normalizedDeviceId = normalizeId(deviceId);
  if (!normalizedClientId || !normalizedDeviceId) return [];

  trimRuntimeState();
  const rules = await getActiveRules(normalizedClientId);
  if (!rules.length) return [];

  const now = new Date();
  const nowMs = now.getTime();
  const context = {
    clientId: normalizedClientId,
    vehicleId: normalizeId(vehicleId),
    deviceId: normalizedDeviceId,
    vehicle,
    vehicleLabel: vehicleLabel || vehicle?.name || vehicle?.plate || null,
    plate: plate || vehicle?.plate || null,
    position: position || {},
    attributes: attributes && typeof attributes === "object" ? attributes : {},
    events: Array.isArray(events) ? events : [],
    nowMs,
    nowIso: now.toISOString(),
  };

  const createdEvents = [];

  for (const rule of rules) {
    if (!isRuleInScope(rule, context)) continue;
    const scopeKey = resolveScopeKey(context);
    context.scopeKey = scopeKey;
    context.rule = rule;

    const scopeRuntime = resolveConditionRuntime(rule.id, scopeKey, null);
    const hourlyLimit = resolveScopeHourlyLimit(rule, scopeRuntime, nowMs);
    if (hourlyLimit.limited) {
      continue;
    }

    const conditionEvaluation = await evaluateRuleConditions(rule, context, scopeKey);
    if (!conditionEvaluation.matched) {
      continue;
    }

    const cooldownMinutes = Math.max(0, parseNumber(rule?.settings?.cooldownMinutes, 0));
    const lastExecutionAt =
      parseDate(scopeRuntime.lastTriggeredAt) ||
      parseDate(getConditionalActionScopeLastExecution(rule, scopeKey));
    if (cooldownMinutes > 0 && lastExecutionAt) {
      const diffMs = nowMs - lastExecutionAt.getTime();
      if (diffMs < cooldownMinutes * 60 * 1000) {
        continue;
      }
    }

    const enabledActions = (Array.isArray(rule?.actions) ? rule.actions : []).filter((action) => action?.enabled !== false);
    const actionResults = [];
    for (const action of enabledActions) {
      const result = await executeAction(action, {
        ...context,
        conditionResults: conditionEvaluation.results,
      });
      actionResults.push({
        type: result?.type || action?.type || null,
        status: result?.status || "executed",
        description: result?.description || null,
        eventId: result?.eventId || null,
        commandId: result?.commandId || null,
      });
      if (result?.event) {
        createdEvents.push(result.event);
      }
    }

    scopeRuntime.executions = [...(scopeRuntime.executions || []), nowMs].filter((entry) => nowMs - entry <= HOUR_WINDOW_MS);

    appendConditionalActionHistory({
      clientId: normalizedClientId,
      ruleId: rule.id,
      ruleName: rule.name,
      trigger: "telemetry",
      status: resolveHistoryStatus(actionResults),
      triggeredAt: context.nowIso,
      vehicleId: context.vehicleId,
      deviceId: context.deviceId,
      scopeKey,
      conditionSummary: {
        operator: conditionEvaluation.operator,
        items: conditionEvaluation.results,
      },
      actionResults,
      contextSnapshot: {
        latitude: parseNumber(context.position?.latitude, null),
        longitude: parseNumber(context.position?.longitude, null),
        speed: context.position?.speed ?? null,
        protocol: context.position?.protocol || context.attributes?.protocol || null,
      },
      createdBy: rule.createdBy || null,
      createdByName: rule.createdByName || null,
      ipAddress: null,
    });
    scopeRuntime.lastTriggeredAt = context.nowIso;
  }

  return createdEvents;
}

export function __resetConditionalActionEngineForTests() {
  rulesCache.clear();
  geofenceCache.clear();
  runtimeState.clear();
}
