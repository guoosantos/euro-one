import diagnosticCatalog from "./deviceDiagnosticEvents.pt-BR.json" with { type: "json" };

const POSITION_LABEL_PT = "Posição";

const DIAGNOSTIC_EVENT_MAP = new Map(
  (diagnosticCatalog?.events || []).map((entry) => [String(entry.key).toLowerCase(), entry]),
);

const DIAGNOSTIC_TEMPLATE_MAP = new Map(
  (diagnosticCatalog?.templates || []).map((entry) => [String(entry.key).toLowerCase(), entry]),
);

const DIAGNOSTIC_TEMPLATE_BY_FUN_ID = new Map(
  (diagnosticCatalog?.templates || []).reduce((acc, entry) => {
    const funId = entry?.fun_id;
    const key = typeof funId === "number" ? funId : String(funId || "").trim();
    if (key === "") return acc;
    const list = acc.get(key) || [];
    list.push(entry);
    acc.set(key, list);
    return acc;
  }, new Map()),
);

const toNumberOrNull = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const toTextOrNull = (value) => {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text ? text : null;
};

const pickFirst = (...values) => values.find((value) => value !== null && value !== undefined && `${value}`.trim() !== "");

function extractFromPayload(payload) {
  if (!payload || typeof payload !== "object") return { funId: null, warId: null, eventCode: null };
  const attributes =
    payload.attributes || payload.position?.attributes || payload.rawAttributes || payload.position?.rawAttributes || {};

  const funIdRaw = pickFirst(
    payload.funId,
    payload.fun_id,
    payload.functionId,
    payload.function_id,
    attributes.funId,
    attributes.fun_id,
    attributes.functionId,
    attributes.function_id,
  );
  const warIdRaw = pickFirst(
    payload.warId,
    payload.war_id,
    payload.warningId,
    payload.warning_id,
    payload.warnId,
    attributes.warId,
    attributes.war_id,
    attributes.warningId,
    attributes.warning_id,
    attributes.warnId,
  );
  const eventRaw = pickFirst(
    payload.event,
    payload.eventCode,
    payload.event_id,
    payload.eventId,
    payload.position?.event,
    payload.position?.attributes?.event,
    attributes.event,
    attributes.eventCode,
    attributes.event_id,
    attributes.eventId,
  );

  return {
    funId: toNumberOrNull(funIdRaw),
    warId: toTextOrNull(warIdRaw),
    eventCode: toTextOrNull(eventRaw),
  };
}

function parseRawCode(rawCode) {
  if (!rawCode) return null;
  const raw = String(rawCode).trim();
  if (!raw) return null;

  const funWarMatch = raw.match(/fun_id\s*=\s*(\d+)\s*,\s*war_id\s*=\s*([^,\s]+)/i);
  if (funWarMatch) {
    return { funId: toNumberOrNull(funWarMatch[1]), warId: toTextOrNull(funWarMatch[2]) };
  }

  const fMatch = raw.match(/^f\s*(\d+)\s*=\s*(.+)$/i);
  if (fMatch) {
    return { funId: toNumberOrNull(fMatch[1]), warId: toTextOrNull(fMatch[2]) };
  }

  const numericMatch = raw.match(/^\d+$/);
  if (numericMatch) {
    return { eventCode: numericMatch[0] };
  }

  return null;
}

function buildTemplateContext(funId, warId) {
  const context = {
    fun_id: funId,
    war_id: warId,
    script_id: null,
    source: null,
    source_label: null,
  };

  if (Number.isFinite(funId)) {
    if (funId >= 140 && funId < 145) {
      context.script_id = funId - 140;
    }
    if (funId >= 180 && funId <= 182) {
      context.source = funId - 180;
      context.source_label = context.source === 1 ? "CAN1" : context.source === 2 ? "CAN2" : `Fonte ${context.source}`;
    }
    if (funId >= 240 && funId <= 241) {
      context.source = funId - 240;
      context.source_label = context.source === 0 ? "GPS" : context.source === 1 ? "NTP" : `Fonte ${context.source}`;
    }
    if (funId >= 250 && funId <= 251) {
      context.source = funId - 250;
      context.source_label = context.source === 0 ? "GPS" : context.source === 1 ? "NTP" : `Fonte ${context.source}`;
    }
  }

  return context;
}

function renderTemplate(template, context, valueOverride) {
  return String(template || "").replace(/\{(\w+)\}/g, (match, key) => {
    const value = key === "war_id" && valueOverride !== undefined ? valueOverride : context?.[key];
    return value === null || value === undefined || value === "" ? match : String(value);
  });
}

function resolveTemplate(funId, warId) {
  const funKey = Number.isFinite(funId) ? funId : String(funId || "").trim();
  if (funKey === "") return null;
  const templates = DIAGNOSTIC_TEMPLATE_BY_FUN_ID.get(funKey) || [];
  if (!templates.length) return null;
  const entry = templates[0];
  if ((warId === null || warId === undefined || warId === "") && entry.war_id === "x") {
    const label = entry.title || entry.template || entry.description;
    return {
      entry,
      label,
    };
  }
  const context = buildTemplateContext(funId, warId);
  const warValue = entry.war_id === "x" ? `x=${warId}` : warId;
  const label = entry.template ? renderTemplate(entry.template, context, warValue) : entry.title;
  return {
    entry,
    label,
  };
}

function isPositionPayload(payload = {}) {
  if (!payload || typeof payload !== "object") return false;
  const target = payload.position || payload;
  const attributes = target.attributes || payload.attributes || payload.rawAttributes || payload.position?.attributes || {};
  const lat = target.latitude ?? target.lat ?? attributes.latitude ?? attributes.lat;
  const lon = target.longitude ?? target.lng ?? attributes.longitude ?? attributes.lng;
  if (Number.isFinite(Number(lat)) && Number.isFinite(Number(lon))) return true;
  const telemetrySignals = [
    target.speed,
    attributes.speed,
    target.course,
    attributes.course,
    target.altitude,
    attributes.altitude,
    target.valid,
    attributes.valid,
  ];
  return telemetrySignals.some((value) => value !== null && value !== undefined);
}

export function normalizeDiagnosticKey({ payload, rawCode, funId, warId } = {}) {
  const fromArgs = funId !== undefined || warId !== undefined ? { funId, warId } : null;
  const fromRaw = parseRawCode(rawCode);
  const fromPayload = extractFromPayload(payload);

  const resolvedFunId = toNumberOrNull(fromArgs?.funId ?? fromRaw?.funId ?? fromPayload?.funId);
  const resolvedWarId = toTextOrNull(fromArgs?.warId ?? fromRaw?.warId ?? fromPayload?.warId);

  if (resolvedFunId !== null && resolvedWarId !== null) {
    return {
      funId: resolvedFunId,
      warId: resolvedWarId,
      key: `fun_id=${resolvedFunId},war_id=${resolvedWarId}`,
      displayCode: `F${resolvedFunId}=${resolvedWarId}`,
    };
  }

  if (resolvedFunId !== null && resolvedWarId === null && DIAGNOSTIC_TEMPLATE_BY_FUN_ID.has(resolvedFunId)) {
    return {
      funId: resolvedFunId,
      warId: null,
      key: `fun_id=${resolvedFunId},war_id=x`,
      displayCode: `F${resolvedFunId}`,
    };
  }

  const numericCode = toTextOrNull(fromRaw?.eventCode ?? fromPayload?.eventCode);
  if (!numericCode) return null;

  const diagnosticKey = `fun_id=0,war_id=${numericCode}`;
  if (DIAGNOSTIC_EVENT_MAP.has(diagnosticKey.toLowerCase())) {
    return {
      funId: 0,
      warId: numericCode,
      key: diagnosticKey,
      displayCode: `F0=${numericCode}`,
    };
  }

  const templateFunId = toNumberOrNull(numericCode);
  if (templateFunId !== null && DIAGNOSTIC_TEMPLATE_BY_FUN_ID.has(templateFunId)) {
    const templateWarId = toTextOrNull(fromArgs?.warId ?? fromPayload?.warId ?? fromRaw?.warId);
    return {
      funId: templateFunId,
      warId: templateWarId,
      key: templateWarId ? `fun_id=${templateFunId},war_id=${templateWarId}` : `fun_id=${templateFunId},war_id=x`,
      displayCode: templateWarId ? `F${templateFunId}=${templateWarId}` : `F${templateFunId}`,
    };
  }

  return null;
}

export function translateDiagnosticEvent({ payload, rawCode, funId, warId } = {}) {
  const resolved = normalizeDiagnosticKey({ payload, rawCode, funId, warId });
  if (!resolved) {
    const rawParsed = parseRawCode(rawCode);
    const payloadExtract = extractFromPayload(payload);
    const rawEventCode = toTextOrNull(rawParsed?.eventCode ?? payloadExtract?.eventCode);
    if (rawEventCode) return null;
    if (isPositionPayload(payload)) {
      return {
        label_ptBR: POSITION_LABEL_PT,
        raw_code: "",
        category: "system",
        fallback_used: false,
      };
    }
    return null;
  }

  const key = resolved.key.toLowerCase();
  const exact = DIAGNOSTIC_EVENT_MAP.get(key);
  if (exact) {
    return {
      label_ptBR: exact.description || exact.title,
      raw_code: resolved.key,
      category: "diagnostic",
      fallback_used: false,
    };
  }

  const template = resolveTemplate(resolved.funId, resolved.warId);
  if (template?.label) {
    return {
      label_ptBR: template.label,
      raw_code: resolved.key,
      category: "diagnostic",
      fallback_used: false,
    };
  }

  return {
    label_ptBR: `Evento desconhecido (fun_id=${resolved.funId ?? "?"}, war_id=${resolved.warId ?? "?"})`,
    raw_code: resolved.key,
    category: "unknown",
    fallback_used: true,
  };
}

export default {
  normalizeDiagnosticKey,
  translateDiagnosticEvent,
};
