import { randomUUID } from "crypto";

import { normalizeFlowType } from "../domain/flow-types.js";

function sanitizeString(value) {
  if (value === null || value === undefined) return null;
  const normalized = String(value).trim();
  return normalized || null;
}

function sanitizeContextPart(value) {
  const normalized = sanitizeString(value);
  if (!normalized) return null;
  return normalized.replace(/[/:?#]+/g, "_");
}

function sanitizeObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function buildContextId(screen = {}, entity = {}) {
  const parts = [
    screen.routePath || screen.screenId || "screen",
    entity.entityType || "entity",
    entity.entityId || entity.plate || "none",
  ]
    .map((item) => sanitizeContextPart(item))
    .filter(Boolean);
  return parts.join(":");
}

export function buildContextSnapshot(req, payload = {}) {
  const input = sanitizeObject(payload.context);
  const screenInput = sanitizeObject(input.screen);
  const entityInput = sanitizeObject(input.entity);
  const filtersInput = sanitizeObject(input.filters);
  const flowType = normalizeFlowType(payload.flowType);

  const screen = {
    screenId: sanitizeString(screenInput.screenId) || sanitizeString(payload.screenId) || "unknown-screen",
    title: sanitizeString(screenInput.title) || sanitizeString(payload.screenTitle) || null,
    routePath: sanitizeString(screenInput.routePath) || sanitizeString(payload.routePath) || req?.path || null,
  };

  const entity = {
    entityType: sanitizeString(entityInput.entityType) || (payload.vehicleId || payload.plate ? "vehicle" : null),
    entityId: sanitizeString(entityInput.entityId) || sanitizeString(payload.vehicleId) || sanitizeString(payload.alertId),
    plate: sanitizeString(entityInput.plate) || sanitizeString(payload.plate),
    label: sanitizeString(entityInput.label) || null,
    deviceId: sanitizeString(entityInput.deviceId) || sanitizeString(payload.deviceId),
    attributes: sanitizeObject(entityInput.attributes),
  };

  return {
    requestId: sanitizeString(payload.requestId) || randomUUID(),
    flowType,
    screen,
    entity,
    summary: sanitizeString(input.summary) || sanitizeString(payload.summary),
    filters: filtersInput,
    history: Array.isArray(payload.history) ? payload.history.slice(-8) : [],
    message: sanitizeString(payload.message) || "",
    contextId: buildContextId(screen, entity),
    user: {
      id: sanitizeString(req?.user?.id),
      role: sanitizeString(req?.user?.role),
      clientId: sanitizeString(req?.clientId || req?.user?.clientId),
      name: sanitizeString(req?.user?.name || req?.user?.username || req?.user?.email),
    },
  };
}
