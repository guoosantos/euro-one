import { normalizeDiagnosticKey, translateDiagnosticEvent } from "../../../shared/eventTranslator.js";

export const resolveIotmDiagnosticInfo = ({ funId, warId, rawCode, payload } = {}) =>
  normalizeDiagnosticKey({ funId, warId, rawCode, payload });

export function formatIotmDiagEvent({ funId, warId, rawCode, payload } = {}) {
  const diagnostic = translateDiagnosticEvent({ funId, warId, rawCode, payload });
  if (diagnostic?.label_ptBR) return diagnostic.label_ptBR;
  return rawCode ? `Evento IOTM ${rawCode}` : "";
}

export default formatIotmDiagEvent;
