import createError from "http-errors";

function resolveStatus(error, fallback = 502) {
  const status = Number(error?.status || error?.statusCode);
  if (Number.isFinite(status) && status > 0) return status;
  return fallback;
}

function normalizePayloadSample(payloadSample) {
  if (payloadSample == null) return null;
  if (typeof payloadSample === "string") return payloadSample;
  try {
    return JSON.parse(JSON.stringify(payloadSample));
  } catch (_error) {
    return String(payloadSample);
  }
}

export function wrapXdmError(error, { step, correlationId, payloadSample, status } = {}) {
  const resolvedStatus = status != null ? Number(status) : resolveStatus(error);
  const message = step ? `Falha no XDM (${step})` : "Falha no XDM";
  const wrapped = createError(resolvedStatus || 502, message);
  wrapped.expose = true;
  wrapped.code = error?.code || error?.details?.code || "XDM_REQUEST_FAILED";
  wrapped.details = {
    step: step || null,
    correlationId: correlationId || null,
    payloadSample: normalizePayloadSample(payloadSample),
    cause: error?.message || null,
    response: error?.details?.response || null,
    responseSample: error?.details?.responseSample || null,
  };

  console.error("[xdm] step failed", {
    correlationId,
    step,
    status: resolvedStatus || 502,
    message: error?.message || error,
    payloadSample: normalizePayloadSample(payloadSample),
  });

  return wrapped;
}

export function isDeviceNotFoundError(error) {
  const status = Number(error?.status || error?.statusCode);
  if (status === 404) return true;
  const response = String(error?.details?.response || error?.message || "").toLowerCase();
  return response.includes("device") && response.includes("not found");
}

export default {
  wrapXdmError,
  isDeviceNotFoundError,
};
