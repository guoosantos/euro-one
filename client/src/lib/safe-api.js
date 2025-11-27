import api from "./api.js";

const KNOWN_ABORT_ERRORS = new Set(["AbortError", "ERR_CANCELED", "TimeoutError"]);

function isAbortError(error) {
  return KNOWN_ABORT_ERRORS.has(error?.name) || error?.message === "Request aborted";
}

function buildTimeoutSignal(timeout = 20_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    const timeoutError = new Error("Tempo de resposta excedido");
    timeoutError.name = "TimeoutError";
    controller.abort(timeoutError);
  }, timeout);

  return { controller, timer };
}

async function request(
  method,
  url,
  { params, data, signal, timeout = 20_000, apiPrefix = true, headers, responseType } = {},
) {
  const { controller, timer } = buildTimeoutSignal(timeout);

  const forwardAbort = () => {
    try {
      controller.abort(signal?.reason);
    } catch (_error) {
      controller.abort();
    }
  };

  if (signal) {
    if (signal.aborted) {
      forwardAbort();
    } else {
      signal.addEventListener("abort", forwardAbort);
    }
  }

  try {
    const response = await api.request({
      method,
      url,
      params,
      data,
      signal: controller.signal,
      timeout,
      apiPrefix,
      headers,
      responseType,
    });
    return { data: response?.data ?? null, error: null, status: response?.status ?? null, response };
  } catch (error) {
    const normalised = error instanceof Error ? error : new Error(error?.message || "Erro na requisição");
    if (isAbortError(normalised)) {
      normalised.message = normalised.message || "Tempo de resposta excedido";
      return { data: null, error: null, status: null, response: null, aborted: true };
    }
    const statusCode = Number(error?.response?.status ?? error?.status);
    if (Number.isFinite(statusCode) && statusCode >= 400 && statusCode < 500) {
      normalised.permanent = true;
    }
    if (!Number.isFinite(statusCode) && normalised?.message?.includes?.("Failed to fetch")) {
      normalised.permanent = true;
    }
    normalised.response = error?.response;
    const resolvedStatus = Number.isFinite(statusCode) ? statusCode : null;
    return { data: null, error: normalised, status: resolvedStatus, response: error?.response };
  } finally {
    clearTimeout(timer);
    if (signal) {
      signal.removeEventListener("abort", forwardAbort);
    }
  }
}

const safeApi = {
  request: (options) => request(options?.method ?? "GET", options?.url, options),
  get: (url, options = {}) => request("GET", url, options),
  delete: (url, options = {}) => request("DELETE", url, options),
  post: (url, data, options = {}) => request("POST", url, { ...options, data }),
  put: (url, data, options = {}) => request("PUT", url, { ...options, data }),
  patch: (url, data, options = {}) => request("PATCH", url, { ...options, data }),
  isAbortError,
};

export default safeApi;
