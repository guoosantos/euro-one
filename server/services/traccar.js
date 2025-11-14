import axios from "axios";
import createError from "http-errors";

import { config } from "../config.js";

const BASE_URL = `${config.traccar.baseUrl.replace(/\/$/, "")}/api`;

function encodeBasic(user, password) {
  if (!user || !password) return null;
  return Buffer.from(`${user}:${password}`).toString("base64");
}

function resolveAdminHeaders() {
  if (config.traccar.adminToken) {
    return { Authorization: `Bearer ${config.traccar.adminToken}` };
  }
  if (config.traccar.adminUser && config.traccar.adminPassword) {
    const token = encodeBasic(config.traccar.adminUser, config.traccar.adminPassword);
    return { Authorization: `Basic ${token}` };
  }
  throw createError(500, "Credenciais administrativas do Traccar não configuradas");
}

export function resolveUserHeaders(context) {
  if (!context) {
    throw createError(401, "Sessão inválida");
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
  throw createError(401, "Credenciais do Traccar não encontradas");
}

export async function traccarRequest(options, context, { asAdmin = false } = {}) {
  const headers = {
    Accept: "application/json",
    ...(asAdmin ? resolveAdminHeaders() : resolveUserHeaders(context)),
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

export async function createUser(payload, { asAdmin = false, context, clientId } = {}) {
  const response = await traccarRequest(
    {
      method: "post",
      url: "/users",
      data: payload,
    },
    asAdmin ? null : context,
    { asAdmin },
  );

  if (clientId) {
    try {
      await traccarRequest(
        {
          method: "post",
          url: "/permissions",
          data: {
            userId: clientId,
            otherId: response.data?.id,
            type: "user",
          },
        },
        asAdmin ? null : context,
        { asAdmin },
      );
    } catch (error) {
      // Caso a associação falhe, ainda retornamos o usuário criado mas avisamos a camada superior.
      error.expose = true;
      throw error;
    }
  }

  return response.data;
}

export async function updateUser(id, payload, { asAdmin = false, context } = {}) {
  const response = await traccarRequest(
    {
      method: "put",
      url: `/users/${id}`,
      data: payload,
    },
    asAdmin ? null : context,
    { asAdmin },
  );
  return response.data;
}

export async function deleteUser(id, { asAdmin = false, context } = {}) {
  await traccarRequest(
    {
      method: "delete",
      url: `/users/${id}`,
    },
    asAdmin ? null : context,
    { asAdmin },
  );
  return true;
}

export async function listUsers(params = {}, { asAdmin = false, context } = {}) {
  const response = await traccarRequest(
    {
      method: "get",
      url: "/users",
      params,
    },
    asAdmin ? null : context,
    { asAdmin },
  );
  return Array.isArray(response.data) ? response.data : response.data?.users || response.data?.data || [];
}

export async function traccarProxy(method, url, { context, params, data } = {}) {
  const response = await traccarRequest(
    {
      method,
      url,
      params,
      data,
    },
    context,
  );
  return response.data;
}
