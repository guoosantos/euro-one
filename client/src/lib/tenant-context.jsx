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
  registerUnauthorizedHandler,
  setStoredSession,
} from "./api.js";
import { API_ROUTES } from "./api-routes.js";
import { normalizeAdminClientName } from "./admin-general.js";

const TenantContext = createContext(null);

function normaliseClients(payload, currentUser) {
  let list = Array.isArray(payload?.clients)
    ? payload.clients
    : Array.isArray(payload)
      ? payload
      : Array.isArray(payload?.data)
        ? payload.data
        : payload?.client
          ? [payload.client]
          : [];

  if (!list.length && currentUser?.client) {
    list = [currentUser.client];
  }

  if (!list.length && currentUser?.clientId && currentUser?.role !== "admin") {
    list = [
      {
        id: currentUser.clientId,
        name: currentUser.attributes?.companyName || currentUser.name || "Meu cliente",
        segment: currentUser.attributes?.segment || "Operação",
        deviceLimit: currentUser.attributes?.deviceLimit,
        userLimit: currentUser.attributes?.userLimit,
      },
    ];
  }

  return list.map((client) => ({
    id: client.id,
    name: normalizeAdminClientName(client.companyName || client.name),
    segment: client.attributes?.segment || "Frota",
    deviceLimit: client.deviceLimit,
    userLimit: client.userLimit,
  }));
}

export function TenantProvider({ children }) {
  const stored = useMemo(() => getStoredSession(), []);
  const hasStoredTenantId =
    stored?.user && Object.prototype.hasOwnProperty.call(stored.user, "tenantId");
  const storedTenantId = hasStoredTenantId ? stored.user.tenantId : null;

  const [tenantId, setTenantId] = useState(
    hasStoredTenantId ? storedTenantId : stored?.user?.clientId ?? null,
  );
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
        const response = await api.get(API_ROUTES.session);
        if (cancelled) return;
        const payload = response?.data || {};
        const resolvedClientId = payload.clientId || payload.client?.id || payload.user?.clientId || null;
        const nextUser = payload.user ? { ...payload.user, clientId: payload.user.clientId ?? resolvedClientId } : payload || null;
        setUser(nextUser);
        setStoredSession({ token, user: nextUser });
        const resolvedClients = normaliseClients(payload.clients || payload.client ? payload : null, nextUser);
        setTenants(resolvedClients);
        if (nextUser) {
          const responseTenant = payload.client?.id || payload.clientId || resolvedClientId || null;
          const suggestedTenant =
            responseTenant || nextUser.clientId || tenantId || (payload.clients?.[0]?.id ?? null);
          setTenantId((currentTenantId) => {
            if (nextUser.role !== "admin") {
              const requiredTenantId = nextUser.clientId ?? resolvedClients[0]?.id ?? null;
              if (requiredTenantId && currentTenantId && currentTenantId !== requiredTenantId) {
                console.warn("Corrigindo tenantId não-admin para clientId da sessão", {
                  from: currentTenantId,
                  to: requiredTenantId,
                });
              }
              return requiredTenantId ?? null;
            }

            if (currentTenantId === null) return null;

            const initialTenantId = currentTenantId ?? suggestedTenant ?? null;
            const isInitialValid = initialTenantId
              ? resolvedClients.some((client) => client.id === initialTenantId)
              : false;
            if (isInitialValid) {
              return initialTenantId;
            }

            const fallbackTenantId = suggestedTenant ?? resolvedClients[0]?.id ?? null;
            if (fallbackTenantId && fallbackTenantId !== initialTenantId) {
              console.warn("Corrigindo tenantId inválido durante hydrateSession", {
                from: initialTenantId,
                to: fallbackTenantId,
              });
            }

            if (!fallbackTenantId && resolvedClients.length === 1) {
              return resolvedClients[0].id;
            }

            return fallbackTenantId ?? null;
          });
        }
      } catch (sessionError) {
        if (cancelled) return;
        console.warn("Falha ao restaurar sessão", sessionError);
        if (Number(sessionError?.status || sessionError?.response?.status) === 401) {
          setUser(null);
          setToken(null);
          setTenants([]);
          setTenantId(null);
          clearStoredSession();
          if (typeof window !== "undefined") {
            window.location.assign("/login");
          }
          return;
        }
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
        const response = await api.get(API_ROUTES.clients);
        if (!cancelled) {
          const list = normaliseClients(response?.data, currentUser);
          setTenants(list);
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

  useEffect(() => {
    const unsubscribe = registerUnauthorizedHandler(() => {
      setToken(null);
      setUser(null);
      setTenants([]);
      setTenantId(null);
      setLoading(false);
      setInitialising(false);
    });

    return unsubscribe;
  }, []);

  const refreshClients = useCallback(async () => {
    if (!user) return [];
    if (user.role !== "admin") {
      const list = normaliseClients(null, user);
      setTenants(list);
      setTenantId((prev) => prev ?? list[0]?.id ?? user.clientId ?? user.id ?? null);
      return list;
    }
    const response = await api.get(API_ROUTES.clients);
    const list = normaliseClients(response?.data, user);
    setTenants(list);
    return list;
  }, [user, tenantId]);

  const login = useCallback(async ({ username, password, remember = true }) => {
    setLoading(true);
    setError(null);
    try {
      const payload = { email: username, password, remember };
      const response = await api.post(API_ROUTES.login, payload);
      const responseUser = response?.data?.user || { login: username };
      const responseClient = response?.data?.client;
      const responseClientId = response?.data?.clientId || responseClient?.id || responseUser?.clientId;
      const responseClients = response?.data?.clients;
      const responseToken = response?.data?.token;
      if (!responseToken) {
        throw new Error("Token de sessão não retornado");
      }
      const nextUser = { ...responseUser, clientId: responseUser.clientId ?? responseClientId ?? responseClient?.id };
      const nextTenants = normaliseClients(
        responseClients || responseClient ? { clients: responseClients, client: responseClient } : null,
        nextUser,
      );
      const resolvedTenantId = responseClient?.id || responseClientId || nextUser.clientId || nextTenants[0]?.id || null;

      setToken(responseToken);
      setUser(nextUser);
      setStoredSession({ token: responseToken, user: nextUser });
      setTenants(nextTenants);
      setTenantId(resolvedTenantId);
      try {
        const sessionResponse = await api.get(API_ROUTES.session);
        const sessionPayload = sessionResponse?.data || {};
        const resolvedClientId =
          sessionPayload.clientId || sessionPayload.client?.id || sessionPayload.user?.clientId || null;
        const sessionUser = sessionPayload.user
          ? { ...sessionPayload.user, clientId: sessionPayload.user.clientId ?? resolvedClientId }
          : nextUser;
        const sessionTenants = normaliseClients(sessionPayload.clients || sessionPayload.client ? sessionPayload : null, sessionUser);
        setUser(sessionUser);
        setTenants(sessionTenants);
        setTenantId((prev) => prev ?? resolvedClientId ?? sessionTenants[0]?.id ?? resolvedTenantId);
        setStoredSession({ token: responseToken, user: sessionUser });
      } catch (sessionError) {
        if (Number(sessionError?.status || sessionError?.response?.status) === 401) {
          clearStoredSession();
          setUser(null);
          setToken(null);
          setTenants([]);
          setTenantId(null);
          throw sessionError;
        }
        console.warn("Falha ao validar sessão após login", sessionError);
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
      await api.post(API_ROUTES.logout).catch(() => undefined);
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
      setTenantId((prev) => prev ?? user.clientId ?? list[0]?.id ?? null);
    }
  }, [user, tenants]);

  useEffect(() => {
    if (!user || !token) return;
    if (user.tenantId === tenantId) {
      setStoredSession({ token, user });
      return;
    }
    const nextUser = { ...user, tenantId };
    setUser(nextUser);
    setStoredSession({ token, user: nextUser });
  }, [tenantId, token, user]);

  const value = useMemo(() => {
    const isAdmin = user?.role === "admin";
    const tenant =
      tenants.find((item) => item.id === tenantId) ??
      (isAdmin && !tenantId ? { id: null, name: "Todos os clientes", segment: "Todas as frotas" } : tenants[0] ?? null);
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
      hasAdminAccess: isAdmin,
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
