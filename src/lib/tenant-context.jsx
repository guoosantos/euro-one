import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import api, {
  clearStoredSession,
  getStoredSession,
  setStoredSession,
} from "./api";
import { tenants as mockTenants } from "../mock/fleet";
import { encodeCredentials } from "./auth-utils";

const TenantContext = createContext(null);

const FALLBACK_TENANTS = Array.isArray(mockTenants) && mockTenants.length > 0 ? mockTenants : [];


export function TenantProvider({ children }) {
  const stored = useMemo(() => getStoredSession(), []);

  const [tenantId, setTenantId] = useState(FALLBACK_TENANTS[0]?.id ?? null);
  const [user, setUser] = useState(stored?.user ?? null);
  const [token, setToken] = useState(stored?.token ?? null);
  const [loading, setLoading] = useState(false);
  const [initialising, setInitialising] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;

    async function hydrateSession() {
      if (!token) {
        setInitialising(false);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const response = await api.get("/session");
        if (cancelled) return;
        const nextUser = response?.data?.user || response?.data || null;
        setUser(nextUser);
        setStoredSession({ token, user: nextUser });
      } catch (sessionError) {
        if (cancelled) return;
        console.warn("Failed to hydrate session", sessionError);
        setError(sessionError);
        setUser(null);
        setToken(null);
        clearStoredSession();
      } finally {
        if (!cancelled) {
          setLoading(false);
          setInitialising(false);
        }
      }
    }

    hydrateSession();

    return () => {
      cancelled = true;
    };
  }, [token]);

  const login = useCallback(async ({ username, password, remember = true }) => {
    setLoading(true);
    setError(null);
    try {
      const payload = { email: username, password };
      const response = await api.post("/session", payload);
      const responseUser = response?.data?.user || response?.data || { login: username };
      const responseToken = response?.data?.token;
      const derivedToken =
        responseToken ||
        (username && password
          ? `Basic ${encodeCredentials(username, password)}`
          : null);

      if (!derivedToken) {
        throw new Error("Não foi possível obter o token de sessão");
      }

      if (remember) {
        setStoredSession({ token: derivedToken, user: responseUser });
      }

      setToken(derivedToken);
      setUser(responseUser);
      return responseUser;
    } catch (loginError) {
      setError(loginError);
      throw loginError;
    } finally {
      setLoading(false);
      setInitialising(false);
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.delete("/session").catch(() => undefined);
    } finally {
      clearStoredSession();
      setToken(null);
      setUser(null);
    }
  }, []);

  const value = useMemo(() => {
    const tenant = FALLBACK_TENANTS.find((item) => item.id === tenantId) ?? null;
    return {
      tenantId,
      setTenantId,
      tenant,
      tenants: FALLBACK_TENANTS,
      user,
      token,
      login,
      logout,
      loading,
      initialising,
      error,
      isAuthenticated: Boolean(token && user),
    };
  }, [tenantId, user, token, login, logout, loading, error, initialising]);

  return <TenantContext.Provider value={value}>{children}</TenantContext.Provider>;
}

export function useTenant() {
  const ctx = useContext(TenantContext);
  if (!ctx) {
    throw new Error("useTenant deve ser usado dentro de TenantProvider");
  }
  return ctx;
}

