const NETWORK_ERROR_CODES = new Set([
  "ECONNREFUSED",
  "ENOTFOUND",
  "EAI_AGAIN",
  "ECONNRESET",
  "ETIMEDOUT",
]);

function isTimeoutError(error) {
  if (!error) return false;
  if (error.name === "AbortError") return true;
  const message = error.message?.toLowerCase?.() || "";
  return message.includes("timeout") || message.includes("timed out");
}

function isPayloadParseError(error) {
  return (
    error?.type === "entity.parse.failed" ||
    (error instanceof SyntaxError && "body" in (error || {}))
  );
}

function resolveStatus(error) {
  if (!error) return 500;
  if (isPayloadParseError(error)) return 400;
  if (isTimeoutError(error)) return 504;
  if (NETWORK_ERROR_CODES.has(error.code)) return 502;

  const fromError = Number(error.status || error.statusCode);
  if (!Number.isNaN(fromError) && fromError > 0) return fromError;

  const fromResponse = Number(error.response?.status);
  if (!Number.isNaN(fromResponse) && fromResponse > 0) return fromResponse;

  return 500;
}

function extractResponseMessage(error) {
  const data = error?.response?.data;
  if (!data) return null;

  if (typeof data === "string") {
    const trimmed = data.trim();
    if (trimmed) return trimmed;
  }

  if (typeof data === "object") {
    if (typeof data.message === "string" && data.message.trim()) return data.message;
    if (typeof data.cause === "string" && data.cause.trim()) return data.cause;
    if (typeof data.error === "string" && data.error.trim()) return data.error;
  }

  return null;
}

function buildMessage(error, status) {
  if (error?.code === "TRACCAR_UNAVAILABLE" || error?.isTraccarError) {
    return error?.message || "Não foi possível consultar o Traccar";
  }

  const responseMessage = extractResponseMessage(error);
  if (responseMessage) return responseMessage;

  if (isPayloadParseError(error)) {
    return "Corpo da requisição inválido ou malformado.";
  }

  if (isTimeoutError(error)) {
    return "Tempo de resposta esgotado ao contatar o serviço externo (Traccar).";
  }

  if (NETWORK_ERROR_CODES.has(error?.code)) {
    return "Não foi possível conectar ao serviço externo (Traccar). Verifique o host ou a rede.";
  }

  if (error?.response) {
    if (status === 401 || status === 403) {
      return "Falha na autenticação com o serviço externo (Traccar). Refaça o login ou ajuste as credenciais.";
    }
    if (status === 404) {
      return "Recurso não encontrado no serviço externo (Traccar).";
    }
    if (status >= 500 && status < 600) {
      return "Serviço externo indisponível no momento. Tente novamente em instantes.";
    }
  }

  if (error?.expose || status < 500) {
    return error?.message || "Erro na requisição";
  }

  return "Erro interno no servidor";
}

function extractDetails(error) {
  if (!error) return null;

  if (error.response?.data !== undefined) {
    return error.response.data;
  }

  if (Array.isArray(error.errors)) {
    return error.errors;
  }

  if (error.details) return error.details;

  if (error.message && !error.expose) {
    return error.message;
  }

  return null;
}

function sanitizeDetails(details) {
  try {
    if (details === undefined) return undefined;
    if (details === null) return null;
    if (typeof details === "string") return details;
    return JSON.parse(JSON.stringify(details));
  } catch (_err) {
    return undefined;
  }
}

export function errorHandler(err, req, res, _next) {
  const status = resolveStatus(err);
  const code = err?.code || err?.response?.data?.code || err?.response?.data?.error;
  const errorCode = code || (status >= 500 ? "INTERNAL_SERVER_ERROR" : "REQUEST_ERROR");
  const message = buildMessage(err, status);
  const details = extractDetails(err);

  console.error("[error]", req.method, req.originalUrl, {
    status,
    code,
    message: err?.message,
    stack: process.env.NODE_ENV !== "production" ? err?.stack : undefined,
    response: err?.response?.data,
  });

  const payload = { message, errorCode };
  payload.error = code || err?.code || message;
  if (code) payload.code = code;

  const shouldExposeDetails = process.env.NODE_ENV !== "production" || status < 500;
  if (details && shouldExposeDetails) {
    const safeDetails = sanitizeDetails(details);
    if (safeDetails !== undefined) {
      payload.details = safeDetails;
    }
  }

  res.status(status).json(payload);
}
