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

export function isNoPermissionError(error) {
  const haystack = [
    error?.code,
    error?.details?.code,
    error?.details?.response,
    error?.details?.responseSample,
    error?.message,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return haystack.includes("no_permission");
}

export function logNoPermissionDiagnostics({ error, correlationId, method, path } = {}) {
  console.warn("[xdm] NO_PERMISSION", {
    authUrl: process.env.XDM_AUTH_URL || null,
    baseUrl: process.env.XDM_BASE_URL || null,
    dealerId: process.env.XDM_DEALER_ID || null,
    configName: process.env.XDM_CONFIG_NAME || process.env.XDM_CONFIG_ID || null,
    correlationId: correlationId || error?.details?.correlationId || null,
    requestMethod: method || null,
    requestPath: path || null,
    xdmMethod: error?.details?.method || null,
    xdmPath: error?.details?.path || null,
    response: error?.details?.response || null,
    responseSample: error?.details?.responseSample || null,
  });
}

export function isDeviceNotFoundError(error) {
  const status = Number(error?.status || error?.statusCode);
  if (status === 404) return true;
  const response = String(error?.details?.response || error?.message || "").toLowerCase();
  return response.includes("device") && response.includes("not found");
}

export default {
  wrapXdmError,
  isNoPermissionError,
  logNoPermissionDiagnostics,
  isDeviceNotFoundError,
};
