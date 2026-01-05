import iotmEventsPtBR from "../i18n/iotmEvents.ptBR.js";

const REGISTER_LABELS = {
  20: "Registro de falhas (bits 24–31)",
  21: "Registro de falhas (bits 16–23)",
  22: "Registro de falhas (bits 8–15)",
  23: "Registro de falhas (bits 0–7)",
  24: "Registro PC (bits 24–31)",
  25: "Registro PC (bits 16–23)",
  26: "Registro PC (bits 8–15)",
  27: "Registro PC (bits 0–7)",
};

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

  if (resolvedFunId !== null && resolvedWarId) {
    const registerLabel = REGISTER_LABELS[resolvedFunId];
    if (registerLabel) {
      return `${registerLabel}: ${resolvedWarId}`;
    }
  }

  if (resolvedFunId === 0 && resolvedWarId === "164") {
    return "Sincronização NTP concluída";
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
