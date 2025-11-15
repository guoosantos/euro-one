import axios from "axios";
import createError from "http-errors";

import { config } from "../config.js";

const BASE_URL = `${config.traccar.baseUrl.replace(/\/$/, "")}/api`;

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

function encodeBasic(user, password) {
  if (!user || !password) return null;
  return Buffer.from(`${user}:${password}`).toString("base64");
}

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
    const token = encodeBasic(config.traccar.adminUser, config.traccar.adminPassword);
    return { Authorization: `Basic ${token}` };
  }
  throw createError(500, "Credenciais administrativas do Traccar não configuradas");
}

function storeAdminToken({ session, token }) {
  if (session) {
    config.traccar.adminToken = `session:${session}`;
    return;
  }
  if (token) {
    config.traccar.adminToken = normaliseAdminToken(token);
  }
}

export function resolveUserHeaders(context) {
  if (!context) {
    return null;
  }
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
      const message = data?.message || data?.cause || error.message || "Falha ao comunicar com o Traccar";
      throw createError(status, message);
    }
    throw createError(502, error?.message || "Erro de rede ao comunicar com o Traccar");
  }
}

export async function traccarAdminRequest(options) {
  return traccarRequest(options, null, { asAdmin: true });
}

export async function loginTraccar(email, password) {
  const headers = {
    Authorization: `Basic ${encodeBasic(email, password)}`,
  };
  const response = await axios.post(
    `${BASE_URL}/session`,
    {},
    {
      headers,
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
    token: headers.Authorization,
  };
}
export async function traccarProxy(method, url, { context, params, data, asAdmin = false } = {}) {
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

export async function initializeTraccarAdminSession() {
  if (!config.traccar.adminUser || !config.traccar.adminPassword) {
    console.warn("Credenciais administrativas do Traccar não configuradas");
    return;
  }
  try {
    const session = await loginTraccar(config.traccar.adminUser, config.traccar.adminPassword);
    storeAdminToken(session);
  } catch (error) {
    console.warn("Falha ao autenticar no Traccar como administrador", error?.message || error);
  }
}
