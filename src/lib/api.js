import axios from "axios";

const TOKEN_STORAGE_KEY = "euro-one.traccar.token";
const USER_STORAGE_KEY = "euro-one.traccar.user";
const BASE_URL = (import.meta?.env?.VITE_TRACCAR_BASE_URL || "http://localhost:8082").replace(/\/$/, "");

function getStorage() {
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      return window.localStorage;
    }
  } catch (error) {
    console.warn("Storage unavailable", error);
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
    console.warn("Failed to parse stored session", error);
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
    console.warn("Failed to persist session", error);
  }
}

export function clearStoredSession() {
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.removeItem(TOKEN_STORAGE_KEY);
    storage.removeItem(USER_STORAGE_KEY);
  } catch (error) {
    console.warn("Failed to clear session", error);
  }
}

function normaliseToken(value) {
  if (!value) return null;
  if (/^Bearer |^Basic |^Token /i.test(value)) {
    return value;
  }
  return `Bearer ${value}`;
}

function getEnvAuthorization() {
  const tokenFromEnv = normaliseToken(import.meta?.env?.VITE_TRACCAR_TOKEN);
  if (tokenFromEnv) {
    return tokenFromEnv;
  }

  const username = import.meta?.env?.VITE_TRACCAR_USERNAME;
  const password = import.meta?.env?.VITE_TRACCAR_PASSWORD;
  if (username && password) {
    try {
      const credentials = btoa(`${username}:${password}`);
      return `Basic ${credentials}`;
    } catch (error) {
      console.warn("Failed to encode credentials", error);
    }
  }
  return null;
}

function resolveAuthorizationHeader() {
  const stored = getStoredSession();
  if (stored?.token) {
    return normaliseToken(stored.token);
  }
  return getEnvAuthorization();
}

export const api = axios.create({
  baseURL: `${BASE_URL}/api`,
  withCredentials: true,
  timeout: 20000,
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
    }
    return Promise.reject(error);
  },
);

export default api;
