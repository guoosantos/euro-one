import diagnosticCatalog from "../../../shared/eventCatalogPtBR.json" with { type: "json" };
import iotmEventsPtBR from "../i18n/iotmEvents.ptBR.js";

const DIAGNOSTIC_TEMPLATES = new Map(
  (diagnosticCatalog?.templates || []).map((entry) => [String(entry.id).toLowerCase(), entry]),
);

const toNumberOrNull = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const toTextOrNull = (value) => {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text ? text : null;
};

const pickFirst = (...values) => values.find((value) => value !== null && value !== undefined && `${value}`.trim() !== "");

const buildTemplateContext = (funId, warId) => {
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
};

const renderTemplate = (template, context) =>
  String(template || "").replace(/\{(\w+)\}/g, (match, key) => {
    const value = context?.[key];
    return value === null || value === undefined || value === "" ? match : String(value);
  });

const resolveTemplateLabel = (funId, warId) => {
  if (!Number.isFinite(funId) || warId === null || warId === undefined || warId === "") return null;
  const warText = String(warId);
  const keys = [];

  if (funId >= 20 && funId <= 27) keys.push(`f${funId}=x`);
  if (funId === 106) keys.push("f106=xx");
  if (funId === 112) keys.push("f112=n");
  if (funId === 113) keys.push("f113=n");
  if (funId === 130) keys.push("f130=id");
  if (funId >= 116 && funId <= 119) keys.push(`f${funId}=x`);
  if (funId >= 121 && funId <= 129) keys.push(`f${funId}=x`);
  if (funId >= 140 && funId < 145) keys.push(`f140+scriptid=${warText}`);
  if (funId === 161) keys.push("f161=xx");
  if (funId === 200) keys.push("f200=x");
  if ([221, 222, 223, 224].includes(funId)) keys.push(`f${funId}=x`);
  if (funId >= 180 && funId <= 182) keys.push(`f180+source=${warText}`);
  if (funId >= 174 && funId <= 179) keys.push(`f${funId}=x`);
  if (funId >= 240 && funId <= 241) keys.push("f240+source=xx");
  if (funId >= 250 && funId <= 251) keys.push("f250+source=xx");

  const entry = keys.map((key) => DIAGNOSTIC_TEMPLATES.get(key)).find(Boolean);
  if (!entry) return null;

  const context = buildTemplateContext(funId, warId);
  return entry.template ? renderTemplate(entry.template, context) : entry.labelPt;
};

const extractFromPayload = (payload) => {
  if (!payload || typeof payload !== "object") return { funId: null, warId: null };
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
  );

  return {
    funId: toNumberOrNull(funIdRaw),
    warId: toTextOrNull(warIdRaw),
  };
};

export const resolveIotmDiagnosticInfo = ({ funId, warId, rawCode, payload } = {}) => {
  const raw = toTextOrNull(rawCode);
  if (raw) {
    const match = raw.match(/^f\s*(\d+)\s*=\s*(.+)$/i);
    if (match) {
      return {
        funId: toNumberOrNull(match[1]),
        warId: toTextOrNull(match[2]),
        rawCode: raw,
      };
    }
  }

  const payloadInfo = extractFromPayload(payload);
  if (payloadInfo.funId !== null || payloadInfo.warId !== null) {
    const numericRaw = raw && /^\d+$/.test(raw) ? raw : null;
    return {
      funId: payloadInfo.funId ?? (numericRaw ? toNumberOrNull(numericRaw) : null),
      warId: payloadInfo.warId ?? (payloadInfo.funId !== null && numericRaw ? numericRaw : null),
      rawCode: raw,
    };
  }

  if (raw && /^\d+$/.test(raw) && raw === "164") {
    return { funId: 0, warId: raw, rawCode: raw };
  }

  return null;
};

export function formatIotmDiagEvent({ funId, warId, rawCode, payload } = {}) {
  const info = resolveIotmDiagnosticInfo({ funId, warId, rawCode, payload });
  if (!info) return rawCode ? `Evento IOTM ${rawCode}` : "";

  const resolvedFunId = toNumberOrNull(info.funId);
  const resolvedWarId = toTextOrNull(info.warId);
  const raw = toTextOrNull(info.rawCode);

  if (resolvedFunId === 0 && resolvedWarId === "164") {
    return "Sincronização NTP concluída";
  }

  if (resolvedFunId !== null && resolvedWarId) {
    const templateLabel = resolveTemplateLabel(resolvedFunId, resolvedWarId);
    if (templateLabel) return templateLabel;
  }

  const key =
    resolvedFunId !== null && resolvedWarId
      ? `f${resolvedFunId}=${resolvedWarId}`.toLowerCase()
      : raw
        ? raw.toLowerCase()
        : null;

  if (key && iotmEventsPtBR.has(key)) {
    return iotmEventsPtBR.get(key) || "";
  }

  if (resolvedFunId !== null || resolvedWarId) {
    return `Evento IOTM (fun_id=${resolvedFunId ?? "?"}, war_id=${resolvedWarId ?? "?"})`;
  }

  return raw ? `Evento IOTM ${raw}` : "";
}

export default formatIotmDiagEvent;
