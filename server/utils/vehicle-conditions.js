import { randomUUID } from "crypto";

const DEFAULT_CONDITION = "Novo";

function toIsoDate(value) {
  const parsed = value ? new Date(value) : new Date();
  if (Number.isNaN(parsed.getTime())) return new Date().toISOString();
  return parsed.toISOString();
}

function normalizeConditionValue(value, fallback = DEFAULT_CONDITION) {
  const normalized = String(value || "").trim();
  return normalized || fallback;
}

function normalizeConditionNote(value) {
  return String(value || "").trim();
}

function normalizeConditionEntry(entry, { fallbackCondition = DEFAULT_CONDITION, fallbackSource = "manual" } = {}) {
  if (!entry || typeof entry !== "object") return null;
  return {
    id: entry.id ? String(entry.id) : randomUUID(),
    condition: normalizeConditionValue(entry.condition, fallbackCondition),
    note: normalizeConditionNote(entry.note),
    createdAt: toIsoDate(entry.createdAt || entry.date || entry.at),
    source: String(entry.source || fallbackSource),
  };
}

export function sortConditionHistory(history = []) {
  return [...history].sort((left, right) => {
    const leftTime = Date.parse(left?.createdAt || 0) || 0;
    const rightTime = Date.parse(right?.createdAt || 0) || 0;
    return rightTime - leftTime;
  });
}

export function normalizeConditionHistory(history = [], options = {}) {
  const normalized = (Array.isArray(history) ? history : [])
    .map((entry) => normalizeConditionEntry(entry, options))
    .filter(Boolean);
  return sortConditionHistory(normalized);
}

export function ensureConditionHistory(attributes, { condition = DEFAULT_CONDITION, note = "", source = "system" } = {}) {
  const baseAttributes = attributes && typeof attributes === "object" ? { ...attributes } : {};
  const history = normalizeConditionHistory(baseAttributes.conditions, {
    fallbackCondition: condition || DEFAULT_CONDITION,
    fallbackSource: source || "system",
  });
  if (!history.length) {
    history.push({
      id: randomUUID(),
      condition: normalizeConditionValue(condition, DEFAULT_CONDITION),
      note: normalizeConditionNote(note),
      createdAt: new Date().toISOString(),
      source: String(source || "system"),
    });
  }
  const sorted = sortConditionHistory(history);
  return {
    ...baseAttributes,
    condition: sorted[0]?.condition || normalizeConditionValue(condition, DEFAULT_CONDITION),
    conditions: sorted,
  };
}

export function appendConditionHistory(
  attributes,
  { condition = DEFAULT_CONDITION, note = "", source = "manual", createdAt = null } = {},
) {
  const baseAttributes = ensureConditionHistory(attributes, { condition: DEFAULT_CONDITION, source: "system" });
  const normalizedCondition = normalizeConditionValue(condition, baseAttributes.condition || DEFAULT_CONDITION);
  const normalizedNote = normalizeConditionNote(note);
  const nextEntry = {
    id: randomUUID(),
    condition: normalizedCondition,
    note: normalizedNote,
    createdAt: toIsoDate(createdAt),
    source: String(source || "manual"),
  };
  const currentHistory = Array.isArray(baseAttributes.conditions) ? [...baseAttributes.conditions] : [];
  const latest = currentHistory[0];
  if (
    latest &&
    latest.condition === nextEntry.condition &&
    String(latest.note || "") === String(nextEntry.note || "") &&
    String(latest.source || "") === String(nextEntry.source || "") &&
    !createdAt
  ) {
    return {
      ...baseAttributes,
      condition: latest.condition,
      conditions: sortConditionHistory(currentHistory),
    };
  }
  const merged = sortConditionHistory([nextEntry, ...currentHistory]);
  return {
    ...baseAttributes,
    condition: merged[0]?.condition || normalizedCondition,
    conditions: merged,
  };
}

export default {
  ensureConditionHistory,
  appendConditionHistory,
  normalizeConditionHistory,
  sortConditionHistory,
};
