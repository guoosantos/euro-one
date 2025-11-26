import api from "./api.js";

const KNOWN_ABORT_ERRORS = new Set(["AbortError", "ERR_CANCELED"]);

function isAbortError(error) {
  return KNOWN_ABORT_ERRORS.has(error?.name) || error?.message === "Request aborted";
}

async function request(method, url, { params, data, signal, timeout, apiPrefix = true, headers } = {}) {
  try {
    const response = await api.request({ method, url, params, data, signal, timeout, apiPrefix, headers });
    return { data: response?.data ?? null, error: null, status: response?.status ?? null, response };
  } catch (error) {
    if (isAbortError(error)) {
      return { data: null, error, status: error?.response?.status ?? null, response: error?.response };
    }
    const normalisedError = error instanceof Error ? error : new Error("Request failed");
    normalisedError.response = error?.response;
    return { data: null, error: normalisedError, status: error?.response?.status ?? null, response: error?.response };
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
