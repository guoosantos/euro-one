import crypto from "node:crypto";

const TOKEN_SAFETY_WINDOW_MS = 60_000;
const missingBaseUrlLogged = { value: false };

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function hashValue(value) {
  if (!value) return null;
  return crypto.createHash("sha256").update(String(value)).digest("hex").slice(0, 12);
}

function withTrailingSlashRemoved(value) {
  if (!value) return null;
  return String(value).trim().replace(/\/+$/, "") || null;
}

function logMissingBaseUrl() {
  if (missingBaseUrlLogged.value) return;
  missingBaseUrlLogged.value = true;
  console.warn("[xdm] integração XDM desativada (XDM_BASE_URL não configurado)");
}

function parseResponseBody(text) {
  if (!text) return { text: "", parsed: null };
  const trimmed = String(text).trim();
  if (!trimmed) return { text: "", parsed: null };
  try {
    return { text: trimmed, parsed: JSON.parse(trimmed) };
  } catch (_error) {
    return { text: trimmed, parsed: null };
  }
}

function buildHttpError(message, { status, code, details, expose = false } = {}) {
  const error = new Error(message);
  if (status) error.status = status;
  if (code) error.code = code;
  if (details) error.details = details;
  if (expose) error.expose = true;
  return error;
}

export class XdmClient {
  constructor({
    authUrl = process.env.XDM_AUTH_URL,
    baseUrl = process.env.XDM_BASE_URL,
    clientId = process.env.XDM_CLIENT_ID,
    clientSecret = process.env.XDM_CLIENT_SECRET,
    authMode = process.env.XDM_AUTH_MODE,
    scope = process.env.XDM_OAUTH_SCOPE,
    audience = process.env.XDM_OAUTH_AUDIENCE,
    timeoutMs = Number(process.env.XDM_TIMEOUT_MS) || 15_000,
    maxRetries = Number(process.env.XDM_MAX_RETRIES) || 3,
    retryBaseMs = Number(process.env.XDM_RETRY_BASE_MS) || 500,
  } = {}) {
    this.authUrl = withTrailingSlashRemoved(authUrl);
    this.baseUrl = withTrailingSlashRemoved(baseUrl);
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.authMode = authMode;
    this.scope = scope;
    this.audience = audience;
    this.timeoutMs = timeoutMs;
    this.maxRetries = maxRetries;
    this.retryBaseMs = retryBaseMs;
    this.tokenCache = {
      token: null,
      expiresAt: 0,
    };
  }

  ensureConfigured() {
    if (!this.authUrl || !this.baseUrl || !this.clientId || !this.clientSecret) {
      if (!this.baseUrl) {
        logMissingBaseUrl();
      }
      throw new Error("XDM não configurado (verifique XDM_AUTH_URL, XDM_BASE_URL, XDM_CLIENT_ID, XDM_CLIENT_SECRET)");
    }
  }

  async getToken({ correlationId } = {}) {
    this.ensureConfigured();
    const now = Date.now();
    if (this.tokenCache.token && now < this.tokenCache.expiresAt - TOKEN_SAFETY_WINDOW_MS) {
      return this.tokenCache.token;
    }

    const normalizedAuthMode = String(this.authMode || "post").trim().toLowerCase();
    const useBasic =
      normalizedAuthMode === "basic" ||
      normalizedAuthMode === "client_secret_basic" ||
      normalizedAuthMode === "basic_auth";
    const authMode = useBasic ? "basic" : "post";

    const body = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: this.clientId,
    });
    if (!useBasic) {
      body.set("client_secret", this.clientSecret);
    }

    if (this.scope && String(this.scope).trim()) {
      body.set("scope", String(this.scope).trim());
    }
    if (this.audience && String(this.audience).trim()) {
      body.set("audience", String(this.audience).trim());
    }

    console.info("[xdm] auth request", {
      correlationId,
      clientId: this.clientId,
      authUrl: this.authUrl,
      authMode,
      hasScope: Boolean(this.scope && String(this.scope).trim()),
      hasAudience: Boolean(this.audience && String(this.audience).trim()),
    });

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(new Error("XDM auth timeout")), this.timeoutMs);

    try {
      const headers = { "Content-Type": "application/x-www-form-urlencoded" };
      if (useBasic) {
        const credentials = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString("base64");
        headers.Authorization = `Basic ${credentials}`;
      }
      const response = await fetch(this.authUrl, {
        method: "POST",
        headers,
        body,
        signal: controller.signal,
      });

      if (!response.ok) {
        const responseText = await response.text();
        const { parsed } = parseResponseBody(responseText);
        const responseCode = parsed?.error || parsed?.code || null;
        const responseMessage = parsed?.error_description || parsed?.message || responseText;
        console.error("[xdm] auth failed", {
          correlationId,
          status: response.status,
          body: responseText,
          clientId: this.clientId,
          authUrl: this.authUrl,
          authMode,
          hasScope: Boolean(this.scope && String(this.scope).trim()),
          hasAudience: Boolean(this.audience && String(this.audience).trim()),
        });
        if (
          response.status === 401 &&
          String(responseCode || responseText)
            .toLowerCase()
            .includes("invalid_client")
        ) {
          throw buildHttpError(
            "Credenciais OAuth do XDM recusadas (invalid_client). Verifique se o client permite client_credentials e se o secret é válido/atual.",
            {
              status: response.status,
              code: "invalid_client",
              expose: true,
              details: {
                authUrl: this.authUrl,
                clientId: this.clientId,
                authMode,
                response: responseMessage,
              },
            },
          );
        }
        throw buildHttpError(`Falha ao autenticar no XDM: ${response.status} ${responseMessage}`, {
          status: response.status,
          code: responseCode || "XDM_AUTH_FAILED",
          expose: true,
          details: {
            authUrl: this.authUrl,
            clientId: this.clientId,
            authMode,
            response: responseMessage,
          },
        });
      }

      const payload = await response.json();
      const expiresIn = Number(payload?.expires_in || 0);
      const token = payload?.access_token;
      if (!token) {
        throw new Error("Token XDM ausente na resposta de autenticação");
      }

      this.tokenCache = {
        token,
        expiresAt: now + Math.max(expiresIn, 60) * 1000,
      };

      console.info("[xdm] token atualizado", {
        correlationId,
        expiresIn,
        tokenHash: hashValue(token),
      });

      return token;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async request(method, path, body, { headers = {}, correlationId } = {}) {
    this.ensureConfigured();
    const url = `${this.baseUrl}${path.startsWith("/") ? "" : "/"}${path}`;
    let attempt = 0;

    while (attempt < this.maxRetries) {
      attempt += 1;
      const token = await this.getToken({ correlationId });
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(new Error("XDM request timeout")), this.timeoutMs);
      const isFormData = typeof FormData !== "undefined" && body instanceof FormData;
      const requestHeaders = {
        Authorization: `Bearer ${token}`,
        ...(isFormData ? {} : { "Content-Type": "application/json" }),
        ...headers,
      };
      const tokenHash = hashValue(token);

      const startedAt = Date.now();

      try {
        const response = await fetch(url, {
          method,
          headers: requestHeaders,
          body: body ? (isFormData ? body : JSON.stringify(body)) : undefined,
          signal: controller.signal,
        });

        if (response.status === 401 && attempt === 1) {
          this.tokenCache.token = null;
        }

        if ((response.status === 429 || response.status >= 500) && attempt < this.maxRetries) {
          const waitMs = this.retryBaseMs * 2 ** (attempt - 1);
          console.warn("[xdm] retry", {
            correlationId,
            method,
            path,
            status: response.status,
            attempt,
            waitMs,
            tokenHash,
          });
          await delay(waitMs);
          continue;
        }

        const durationMs = Date.now() - startedAt;

        if (!response.ok) {
          const responseText = await response.text();
          const { parsed } = parseResponseBody(responseText);
          const responseCode = parsed?.error || parsed?.code || null;
          const responseMessage = parsed?.message || parsed?.error_description || responseText;
          console.error("[xdm] request failed", {
            correlationId,
            method,
            path,
            status: response.status,
            durationMs,
            errorHash: hashValue(responseText),
            tokenHash,
          });
          throw buildHttpError(`XDM error ${response.status} ${responseMessage}`, {
            status: response.status,
            code: responseCode || "XDM_REQUEST_FAILED",
            details: {
              method,
              path,
              response: responseMessage,
            },
          });
        }

        const contentType = response.headers.get("content-type") || "";
        const responseBody = contentType.includes("application/json") ? await response.json() : await response.text();

        console.info("[xdm] request ok", {
          correlationId,
          method,
          path,
          status: response.status,
          durationMs,
          tokenHash,
        });

        return responseBody;
      } finally {
        clearTimeout(timeoutId);
      }
    }

    throw new Error(`XDM request failed after ${this.maxRetries} attempts`);
  }
}

export default XdmClient;
