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
} from "./api.js";

const TenantContext = createContext(null);

function normaliseClients(payload, currentUser) {
  if (!payload) {
    if (currentUser?.role === "manager" || currentUser?.role === "user" || currentUser?.role === "driver") {
      return [
        {
          id: currentUser.id,
          name: currentUser.attributes?.companyName || currentUser.name || "Minha empresa",
          segment: currentUser.attributes?.segment || "Operação",
        },
      ];
    }
    return [];
  }
  const list = Array.isArray(payload?.clients)
    ? payload.clients
    : Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.data)
    ? payload.data
    : [];
  return list.map((client) => ({
    id: client.id,
    name: client.companyName || client.name,
    segment: client.attributes?.segment || "Frota",
    deviceLimit: client.deviceLimit,
    userLimit: client.userLimit,
  }));
}

export function TenantProvider({ children }) {
  const stored = useMemo(() => getStoredSession(), []);

  const [tenantId, setTenantId] = useState(stored?.user?.tenantId ?? null);
  const [user, setUser] = useState(stored?.user ?? null);
  const [token, setToken] = useState(stored?.token ?? null);
  const [tenants, setTenants] = useState([]);
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
        if (nextUser) {
          const suggestedTenant = nextUser.role === "admin" ? tenantId : nextUser.id;
          setTenantId((prev) => prev ?? suggestedTenant ?? null);
        }
        setStoredSession({ token, user: nextUser });
        if (nextUser?.role === "admin") {
          await refreshClientsInternal(nextUser);
        } else {
          setTenants(normaliseClients(null, nextUser));
        }
      } catch (sessionError) {
        if (cancelled) return;
        console.warn("Falha ao restaurar sessão", sessionError);
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

    async function refreshClientsInternal(currentUser) {
      if (!currentUser || currentUser.role !== "admin") return;
      try {
        const response = await api.get("/clients");
        if (!cancelled) {
          const list = normaliseClients(response?.data, currentUser);
          setTenants(list);
          if (!tenantId && list.length) {
            setTenantId(list[0].id);
          }
        }
      } catch (clientError) {
        if (!cancelled) {
          console.warn("Falha ao carregar clientes", clientError);
          setTenants([]);
        }
      }
    }

    hydrateSession();

    return () => {
      cancelled = true;
    };
  }, [token]);

  const refreshClients = useCallback(async () => {
    if (!user) return [];
    if (user.role !== "admin") {
      const list = normaliseClients(null, user);
      setTenants(list);
      setTenantId((prev) => prev ?? list[0]?.id ?? user.id ?? null);
      return list;
    }
    const response = await api.get("/clients");
    const list = normaliseClients(response?.data, user);
    setTenants(list);
    if (!tenantId && list.length) {
      setTenantId(list[0].id);
    }
    return list;
  }, [user, tenantId]);

  const login = useCallback(async ({ username, password, remember = true }) => {
    setLoading(true);
    setError(null);
    try {
      const payload = { email: username, password, remember };
      const response = await api.post("/login", payload);
      const responseUser = response?.data?.user || { login: username };
      const responseToken = response?.data?.token;
      if (!responseToken) {
        throw new Error("Token de sessão não retornado");
      }
      setToken(responseToken);
      setUser(responseUser);
      setStoredSession({ token: responseToken, user: responseUser });
      if (responseUser?.role === "admin") {
        await refreshClients();
      } else {
        const list = normaliseClients(null, responseUser);
        setTenants(list);
        setTenantId(responseUser.id ?? list[0]?.id ?? null);
      }
      return responseUser;
    } catch (loginError) {
      setError(loginError);
      throw loginError;
    } finally {
      setLoading(false);
      setInitialising(false);
    }
  }, [refreshClients]);

  const logout = useCallback(async () => {
    try {
      await api.post("/logout").catch(() => undefined);
    } finally {
      clearStoredSession();
      setToken(null);
      setUser(null);
      setTenants([]);
      setTenantId(null);
    }
  }, []);

  useEffect(() => {
    if (!user) return;
    if (user.role !== "admin") {
      const list = normaliseClients(null, user);
      setTenants(list);
      setTenantId((prev) => prev ?? user.id ?? list[0]?.id ?? null);
    }
  }, [user]);

  const value = useMemo(() => {
    const tenant = tenants.find((item) => item.id === tenantId) ?? tenants[0] ?? null;
    return {
      tenantId,
      setTenantId,
      tenant,
      tenants,
      user,
      token,
      login,
      logout,
      loading,
      initialising,
      error,
      refreshClients,
      isAuthenticated: Boolean(token && user),
      hasAdminAccess: user?.role === "admin",
      role: user?.role ?? "guest",
    };
  }, [tenantId, tenants, user, token, login, logout, loading, error, initialising, refreshClients]);

  return <TenantContext.Provider value={value}>{children}</TenantContext.Provider>;
}

export function useTenant() {
  const ctx = useContext(TenantContext);
  if (!ctx) {
    throw new Error("useTenant deve ser usado dentro de TenantProvider");
  }
  return ctx;
}

