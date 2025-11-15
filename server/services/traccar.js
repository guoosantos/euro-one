import axios from "axios";
import createError from "http-errors";

import { config } from "../config.js";

// Garante que nunca termina com / e sempre aponta para /api
const BASE_URL = `${config.traccar.baseUrl.replace(/\/$/, "")}/api`;

/**
 * Normaliza um token de admin do Traccar.
 * Aceita:
 *  - "session:<id>"
 *  - "JSESSIONID=<id>"
 *  - "Basic xxx" / "Bearer xxx"
 *  - "<token>" cru (vira "Bearer <token>")
 */
function normaliseAdminToken(token) {
  if (!token) return null;
  if (typeof token !== "string") return null;

  if (token.startsWith("session:")) {
    return token;
  }

  if (token.startsWith("JSESSIONID=")) {
    return `session:${token.split("=")[1]}`;
  }

  if (/^(Basic|Bearer)\s+/i.test(token)) {
    return token;
  }

  return `Bearer ${token}`;
}

/**
 * Monta um token Basic em base64 a partir de user:password.
 */
function encodeBasic(user, password) {
  if (!user || !password) return null;
  return Buffer.from(`${user}:${password}`).toString("base64");
}

/**
 * Headers padrão para chamadas como administrador.
 * Preferência:
 *  1. Usa config.traccar.adminToken (session / Bearer / Basic)
 *  2. Se não tiver token, usa Basic com adminUser/adminPassword
 */
function resolveAdminHeaders() {
  const token = normaliseAdminToken(config.traccar.adminToken);
  if (token) {
    if (token.startsWith("session:")) {
      const sessionId = token.split(":")[1];
      return { Cookie: `JSESSIONID=${sessionId}` };
    }
    return { Authorization: token };
  }

  if (config.traccar.adminUser && config.traccar.adminPassword) {
    const basicToken = encodeBasic(config.traccar.adminUser, config.traccar.adminPassword);
    return { Authorization: `Basic ${basicToken}` };
  }

  throw createError(500, "Credenciais administrativas do Traccar não configuradas");
}

/**
 * Guarda o token de admin em memória (para sessão ou bearer).
 */
function storeAdminToken({ session, token }) {
  if (session) {
    config.traccar.adminToken = `session:${session}`;
    return;
  }
  if (token) {
    config.traccar.adminToken = normaliseAdminToken(token);
  }
}

/**
 * Monta headers de autenticação para um usuário comum (não admin),
 * usando dados do context (por exemplo, quando um usuário loga
 * com credenciais próprias do Traccar).
 */
export function resolveUserHeaders(context) {
  if (!context) return null;

  const { traccar } = context;

  if (traccar?.type === "basic" && traccar?.token) {
    return { Authorization: `Basic ${traccar.token}` };
  }

  if (traccar?.type === "session" && traccar?.session) {
    return { Cookie: `JSESSIONID=${traccar.session}` };
  }

  if (traccar?.token) {
    return { Authorization: traccar.token };
  }

  return null;
}

/**
 * Função base para qualquer request ao Traccar.
 * - Se asAdmin = true → usa credenciais de admin.
 * - Se asAdmin = false → tenta usar contexto do usuário, senão cai no admin.
 */
export async function traccarRequest(options, context, { asAdmin = false } = {}) {
  let authHeaders;

  if (asAdmin) {
    authHeaders = resolveAdminHeaders();
  } else {
    authHeaders = resolveUserHeaders(context) || resolveAdminHeaders();
  }

  const headers = {
    Accept: "application/json",
    ...authHeaders,
    ...(options?.headers || {}),
  };

  try {
    const response = await axios({
      baseURL: BASE_URL,
      timeout: 20_000,
      ...options,
      headers,
    });

    return response;
  } catch (error) {
    if (error?.response) {
      const { status, data } = error.response;
      const message =
        data?.message || data?.cause || error.message || "Falha ao comunicar com o Traccar";
      throw createError(status, message);
    }

    throw createError(502, error?.message || "Erro de rede ao comunicar com o Traccar");
  }
}

/**
 * Atalho para request como admin.
 */
export async function traccarAdminRequest(options) {
  return traccarRequest(options, null, { asAdmin: true });
}

/**
 * Expor headers de admin (usado em alguns lugares específicos).
 */
export function getTraccarAdminHeaders() {
  return resolveAdminHeaders();
}

/**
 * Login explícito no Traccar via /api/session.
 * Útil se você quiser autenticar um usuário com sessão própria,
 * além do admin. NÃO é necessário para o admin funcionar,
 * porque usamos Basic Auth diretamente.
 */
export async function loginTraccar(email, password) {
  const response = await axios.post(
    `${BASE_URL}/session`,
    { email, password },
    {
      // não jogar exception automática em 4xx, vamos tratar na mão
      validateStatus: (status) => status >= 200 && status < 500,
    },
  );

  if (response.status >= 400) {
    throw createError(response.status, response.data?.message || "Credenciais inválidas no Traccar");
  }

  const cookies = response.headers?.["set-cookie"] || [];
  const sessionCookie = cookies
    .map((item) => item.split(";")[0])
    .find((item) => item.startsWith("JSESSIONID="));

  const sessionId = sessionCookie ? sessionCookie.split("=")[1] : null;

  return {
    user: response.data,
    session: sessionId,
    token: null, // aqui estamos usando cookie de sessão, não bearer
  };
}

/**
 * Proxy genérico para repassar chamadas ao Traccar e devolver apenas o data.
 */
export async function traccarProxy(
  method,
  url,
  { context, params, data, asAdmin = false } = {},
) {
  const response = await traccarRequest(
    {
      method,
      url,
      params,
      data,
    },
    asAdmin ? null : context,
    { asAdmin },
  );

  return response.data;
}

/**
 * Inicializa uma sessão/admin "testando" a conexão.
 * Aqui NÃO tentamos mais logar via /session.
 * Apenas fazemos um GET em /server com Basic Auth (igual ao seu curl).
 */
export async function initializeTraccarAdminSession() {
  if (!config.traccar.adminUser || !config.traccar.adminPassword) {
    console.warn("Credenciais administrativas do Traccar não configuradas");
    return;
  }

  try {
    // Isso já valida user/senha (igual ao curl -u admin:admin /api/server)
    await traccarAdminRequest({
      method: "GET",
      url: "/server",
    });

    console.log("Conectado ao Traccar como administrador.");
  } catch (error) {
    console.warn(
      "Falha ao autenticar no Traccar como administrador",
      error?.status || error?.statusCode || "",
      error?.message || error,
    );
  }
}
