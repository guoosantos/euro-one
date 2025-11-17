import axios from "axios";

const TOKEN_STORAGE_KEY = "euro-one.session.token";
const USER_STORAGE_KEY = "euro-one.session.user";
const RAW_BASE_URL = import.meta?.env?.VITE_API_BASE_URL || "";
const BASE_URL = RAW_BASE_URL ? RAW_BASE_URL.replace(/\/$/, "") : "";

const unauthorizedHandlers = new Set();

export function registerUnauthorizedHandler(handler) {
  if (typeof handler !== "function") return () => {};
  unauthorizedHandlers.add(handler);
  return () => unauthorizedHandlers.delete(handler);
}

function notifyUnauthorized(error) {
  unauthorizedHandlers.forEach((handler) => {
    try {
      handler(error);
    } catch (notifyError) {
      console.warn("Falha ao notificar 401", notifyError);
    }
  });
}

function getStorage() {
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      return window.localStorage;
    }
  } catch (error) {
    console.warn("Storage indisponível", error);
  }
  return null;
}

export function getStoredSession() {
  const storage = getStorage();
  if (!storage) return { token: null, user: null };
  try {
    const rawToken = storage.getItem(TOKEN_STORAGE_KEY);
    const rawUser = storage.getItem(USER_STORAGE_KEY);
    return {
      token: rawToken || null,
      user: rawUser ? JSON.parse(rawUser) : null,
    };
  } catch (error) {
    console.warn("Falha ao carregar sessão persistida", error);
    return { token: null, user: null };
  }
}

export function setStoredSession(session) {
  const storage = getStorage();
  if (!storage) return;
  try {
    if (session?.token) {
      storage.setItem(TOKEN_STORAGE_KEY, session.token);
    }
    if (session?.user) {
      storage.setItem(USER_STORAGE_KEY, JSON.stringify(session.user));
    }
  } catch (error) {
    console.warn("Falha ao persistir sessão", error);
  }
}

export function clearStoredSession() {
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.removeItem(TOKEN_STORAGE_KEY);
    storage.removeItem(USER_STORAGE_KEY);
  } catch (error) {
    console.warn("Falha ao limpar sessão", error);
  }
}

function normaliseToken(value) {
  if (!value) return null;
  if (/^Bearer /i.test(value)) {
    return value;
  }
  return `Bearer ${value}`;
}

function resolveAuthorizationHeader() {
  const stored = getStoredSession();
  if (stored?.token) {
    return normaliseToken(stored.token);
  }
  return null;
}

export const api = axios.create({
  baseURL: `${BASE_URL || ""}/api`,
  withCredentials: true,
  timeout: 20_000,
});

api.interceptors.request.use((config) => {
  const authorization = resolveAuthorizationHeader();
  if (authorization) {
    config.headers = {
      ...(config.headers || {}),
      Authorization: authorization,
    };
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error?.response?.status === 401) {
      clearStoredSession();
      notifyUnauthorized(error);
    }
    return Promise.reject(error);
  },
);

export default api;
