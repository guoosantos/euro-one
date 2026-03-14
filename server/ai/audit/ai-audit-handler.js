import { randomUUID } from "crypto";

import { loadCollection, saveCollection } from "../../services/storage.js";

const STORAGE_KEY = "ai-audit-log";
const records = new Map();

function clone(value) {
  if (!value) return null;
  return JSON.parse(JSON.stringify(value));
}

function syncStorage() {
  saveCollection(STORAGE_KEY, Array.from(records.values()));
}

const persisted = loadCollection(STORAGE_KEY, []);
persisted.forEach((entry) => {
  if (!entry?.id) return;
  records.set(String(entry.id), entry);
});

function toList(value) {
  return Array.isArray(value) ? value : [];
}

export function estimateAiCost({ usage = {}, pricing = {} } = {}) {
  const inputTokens = Number(usage?.input_tokens ?? usage?.prompt_tokens ?? 0);
  const outputTokens = Number(usage?.output_tokens ?? usage?.completion_tokens ?? 0);
  const inputPer1k = Number(pricing?.inputPer1k ?? 0);
  const outputPer1k = Number(pricing?.outputPer1k ?? 0);
  if (!Number.isFinite(inputPer1k) || !Number.isFinite(outputPer1k)) return null;
  if (inputPer1k <= 0 && outputPer1k <= 0) return null;
  const total = (Math.max(0, inputTokens) / 1000) * Math.max(0, inputPer1k) +
    (Math.max(0, outputTokens) / 1000) * Math.max(0, outputPer1k);
  return Number.isFinite(total) ? Number(total.toFixed(6)) : null;
}

export function recordAiAudit(payload = {}) {
  const id = payload.id ? String(payload.id) : randomUUID();
  const record = {
    id,
    traceId: payload.traceId ? String(payload.traceId) : null,
    correlationId: payload.correlationId ? String(payload.correlationId) : null,
    contextId: payload.contextId ? String(payload.contextId) : null,
    flowType: payload.flowType ? String(payload.flowType) : "chat",
    startedAt: payload.startedAt || new Date().toISOString(),
    endedAt: payload.endedAt || new Date().toISOString(),
    durationMs: Number(payload.durationMs) || 0,
    status: payload.status ? String(payload.status) : "ok",
    provider: payload.provider ? String(payload.provider) : "local-operational",
    model: payload.model ? String(payload.model) : null,
    user: clone(payload.user),
    screen: clone(payload.screen),
    entity: clone(payload.entity),
    request: {
      message: payload.message ? String(payload.message) : "",
      prompt: payload.prompt ? String(payload.prompt) : "",
      toolNames: toList(payload.toolNames).map((item) => String(item)),
      input: clone(payload.input),
    },
    response: {
      text: payload.responseText ? String(payload.responseText) : "",
      summary: payload.responseSummary ? String(payload.responseSummary) : "",
      toolsUsed: clone(payload.toolsUsed) || [],
      usage: clone(payload.usage) || null,
      estimatedCost: payload.estimatedCost ?? null,
    },
    observability: clone(payload.observability) || null,
    error: payload.error
      ? {
          message: payload.error?.message || String(payload.error),
          code: payload.error?.code || null,
          status: payload.error?.status || payload.error?.statusCode || null,
        }
      : null,
    createdAt: new Date().toISOString(),
  };

  records.set(id, record);
  syncStorage();
  return clone(record);
}

export function listAiAudit({ contextId, userId, clientId, limit = 20 } = {}) {
  const filtered = Array.from(records.values())
    .filter((entry) => {
      if (contextId && String(entry.contextId || "") !== String(contextId)) return false;
      if (userId && String(entry.user?.id || "") !== String(userId)) return false;
      if (clientId && String(entry.user?.clientId || "") !== String(clientId)) return false;
      return true;
    })
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())
    .slice(0, Math.max(1, Number(limit) || 20));
  return filtered.map(clone);
}

