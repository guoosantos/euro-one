import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
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

const RECEIVER_TYPES = new Set([
  "GERENCIADORA",
  "SEGURADORA",
  "GERENCIADORA DE RISCO",
  "COMPANHIA DE SEGURO",
]);

function isReceiverClient(client) {
  const type =
    client?.attributes?.clientProfile?.clientType ||
    client?.attributes?.clientType ||
    client?.attributes?.segment ||
    "";
  return RECEIVER_TYPES.has(String(type).toUpperCase());
}

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
        attributes: currentUser.attributes || {},
      },
    ];
  }

  return list.map((client) => ({
    id: client.id,
    name: normalizeAdminClientName(client.companyName || client.name),
    segment: client.attributes?.segment || "Frota",
    deviceLimit: client.deviceLimit,
    userLimit: client.userLimit,
    attributes: client.attributes || {},
  }));
}

function resolveMirrorOwners(list = [], currentUser) {
  if (!currentUser || currentUser.role === "admin") return null;
  const owners = list.filter((client) => String(client.id) !== String(currentUser.clientId));
  return owners.length ? owners : null;
}

function resolveValidTenantId({ currentTenantId, suggestedTenantId, tenants, isAdmin }) {
  if (isAdmin && currentTenantId === null) return null;
  const candidate = currentTenantId ?? suggestedTenantId ?? null;
  if (candidate && tenants.some((client) => String(client.id) === String(candidate))) {
    return candidate;
  }
  const fallback = suggestedTenantId ?? tenants[0]?.id ?? null;
  if (fallback && fallback !== candidate) {
    console.warn("Corrigindo tenantId inválido", { from: candidate, to: fallback });
  }
  return fallback ?? null;
}

export function TenantProvider({ children }) {
  const stored = useMemo(() => getStoredSession(), []);
  const hasStoredTenantId =
    stored?.user && Object.prototype.hasOwnProperty.call(stored.user, "tenantId");
  const storedTenantId = hasStoredTenantId ? stored.user.tenantId : null;
  const storedActiveMirrorOwnerClientId = stored?.user?.activeMirrorOwnerClientId ?? null;
  const storedMirrorContextMode = stored?.user?.mirrorContextMode ?? null;

  const [tenantId, setTenantId] = useState(
    hasStoredTenantId ? storedTenantId : stored?.user?.clientId ?? null,
  );
  const [user, setUser] = useState(stored?.user ?? null);
  const [token, setToken] = useState(stored?.token ?? null);
  const [tenants, setTenants] = useState([]);
  const [mirrorOwners, setMirrorOwners] = useState(null);
  const [activeMirror, setActiveMirror] = useState(null);
  const [activeMirrorOwnerClientId, setActiveMirrorOwnerClientId] = useState(
    storedActiveMirrorOwnerClientId,
  );
  const [mirrorModeEnabled, setMirrorModeEnabled] = useState(null);
  const [mirrorContextMode, setMirrorContextMode] = useState(storedMirrorContextMode);
  const [loading, setLoading] = useState(false);
  const [initialising, setInitialising] = useState(true);
  const [error, setError] = useState(null);
  const [permissionContext, setPermissionContext] = useState({
    permissions: null,
    isFull: true,
    permissionGroupId: null,
  });
  const [permissionLoading, setPermissionLoading] = useState(false);
  const [permissionTenantId, setPermissionTenantId] = useState(null);
  const [permissionLoaded, setPermissionLoaded] = useState(false);
  const lastUserIdRef = useRef(stored?.user?.id ?? null);

  const fetchTenantContext = useCallback(async ({ clientId } = {}) => {
    try {
      const params = clientId === null || clientId === undefined ? undefined : { clientId };
      const response = await api.get(API_ROUTES.context, { params });
      return response?.data || null;
    } catch (contextError) {
      const status = contextError?.status || contextError?.response?.status;
      if (status === 403) {
        console.warn("Contexto de tenant negado", contextError);
        return { error: contextError, status };
      }
      throw contextError;
    }
  }, []);

  const fetchMirrorContext = useCallback(async ({ ownerClientId } = {}) => {
    try {
      const params = ownerClientId ? { ownerClientId } : undefined;
      const headers = ownerClientId ? { "X-Owner-Client-Id": ownerClientId } : undefined;
      const response = await api.get(API_ROUTES.mirrorsContext, { params, headers });
      return response?.data || null;
    } catch (mirrorError) {
      console.warn("Falha ao carregar contexto de mirror", mirrorError);
      return null;
    }
  }, []);

  const applyPermissionContext = useCallback((payload, resolvedTenantId) => {
    if (!payload) return;
    const permissions =
      payload?.permissions && typeof payload.permissions === "object" ? payload.permissions : null;
    setPermissionContext({
      permissions,
      isFull: Boolean(payload?.isFull || payload?.level === "full"),
      permissionGroupId: payload?.permissionGroupId ?? null,
    });
    setPermissionTenantId(resolvedTenantId ?? null);
    setPermissionLoaded(true);
    setPermissionLoading(false);
  }, []);

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

        setPermissionLoading(true);
        setPermissionLoaded(false);
        setPermissionTenantId(null);
        const contextResponse = await fetchTenantContext();
        const contextPayload = contextResponse?.error ? null : contextResponse;
        const contextClients = normaliseClients(contextPayload?.clients || contextPayload?.client ? contextPayload : null, nextUser);
        const sessionClients = normaliseClients(payload.clients || payload.client ? payload : null, nextUser);
        const availableClients = contextClients.length ? contextClients : sessionClients;
        const mirrorOwnerList = resolveMirrorOwners(availableClients, nextUser);
        const effectiveTenants =
          nextUser?.role !== "admin" && Array.isArray(mirrorOwnerList) && mirrorOwnerList.length
            ? mirrorOwnerList
            : availableClients;

        setMirrorOwners(mirrorOwnerList);
        setTenants(effectiveTenants);
        setActiveMirror(contextPayload?.mirror || null);
        setActiveMirrorOwnerClientId(contextPayload?.mirror?.ownerClientId ?? storedActiveMirrorOwnerClientId);
        setMirrorModeEnabled(
          typeof contextPayload?.mirrorModeEnabled === "boolean" ? contextPayload.mirrorModeEnabled : null,
        );
        if (contextPayload?.permissionContext) {
          applyPermissionContext(contextPayload.permissionContext, contextPayload?.clientId || resolvedClientId);
        } else {
          setPermissionLoading(false);
          setPermissionLoaded(false);
          setPermissionTenantId(null);
        }

        if (nextUser) {
          const responseTenant = contextPayload?.clientId || payload.client?.id || payload.clientId || resolvedClientId || null;
          const preferredTenantId = hasStoredTenantId ? storedTenantId : tenantId;
          const nextTenantId = resolveValidTenantId({
            currentTenantId: preferredTenantId,
            suggestedTenantId: responseTenant || nextUser.clientId,
            tenants: effectiveTenants,
            isAdmin: nextUser.role === "admin",
          });
          setTenantId(nextTenantId);
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

    hydrateSession();

    return () => {
      cancelled = true;
    };
  }, [fetchTenantContext, hasStoredTenantId, storedActiveMirrorOwnerClientId, storedTenantId, tenantId, token]);

  useEffect(() => {
    const currentId = user?.id ?? null;
    if (lastUserIdRef.current && currentId && currentId !== lastUserIdRef.current) {
      setTenantId(null);
      setTenants([]);
      setMirrorOwners(null);
      setActiveMirror(null);
      setActiveMirrorOwnerClientId(null);
      setMirrorModeEnabled(null);
      setMirrorContextMode(null);
      setPermissionLoaded(false);
      setPermissionTenantId(null);
    }
    lastUserIdRef.current = currentId;
  }, [user?.id]);

  useEffect(() => {
    let cancelled = false;

    async function bootstrapMirrorContext() {
      if (!user || !token) return;
      if (user.role === "admin") {
        setMirrorContextMode("admin");
        return;
      }
      const payload = await fetchMirrorContext();
      if (cancelled || !payload) return;
      if (typeof payload.mirrorModeEnabled === "boolean") {
        setMirrorModeEnabled(payload.mirrorModeEnabled);
      }
      if (payload.mode) {
        setMirrorContextMode(payload.mode);
      }
      if (payload.mode !== "target") return;
      const owners = normaliseClients(payload.owners || [], user);
      if (!owners.length) return;
      const storedOwnerId = storedActiveMirrorOwnerClientId;
      const selectedOwnerId =
        owners.find((owner) => String(owner.id) === String(storedOwnerId))?.id ?? owners[0].id;
      setMirrorOwners(owners);
      setTenants(owners);
      setActiveMirrorOwnerClientId(selectedOwnerId);

      const ownerPayload = await fetchMirrorContext({ ownerClientId: selectedOwnerId });
      if (cancelled || !ownerPayload) return;
      if (typeof ownerPayload.mirrorModeEnabled === "boolean") {
        setMirrorModeEnabled(ownerPayload.mirrorModeEnabled);
      }
      setActiveMirror(ownerPayload.activeMirror || null);
    }

    bootstrapMirrorContext();

    return () => {
      cancelled = true;
    };
  }, [fetchMirrorContext, storedActiveMirrorOwnerClientId, token, user]);

  useEffect(() => {
    let cancelled = false;
    if (!user || !token) return () => {};
    if (user.role === "admin" && tenantId === null) {
      setActiveMirror(null);
      setActiveMirrorOwnerClientId(null);
      return () => {
        cancelled = true;
      };
    }
    setPermissionLoading(true);
    setPermissionLoaded(false);
    setPermissionTenantId(null);
    fetchTenantContext({ clientId: tenantId })
      .then((payload) => {
        if (cancelled || !user) return;
        if (payload?.error) {
          const fallbackTenant = tenants[0]?.id ?? user.clientId ?? null;
          if (fallbackTenant && fallbackTenant !== tenantId) {
            setTenantId(fallbackTenant);
          }
          return;
        }
        const normalizedClients = normaliseClients(payload?.clients || payload?.client ? payload : null, user);
        const mirrorOwnerList = resolveMirrorOwners(normalizedClients, user);
        const effectiveTenants =
          user.role !== "admin" && Array.isArray(mirrorOwnerList) && mirrorOwnerList.length
            ? mirrorOwnerList
            : normalizedClients;
        if (effectiveTenants.length) {
          setTenants(effectiveTenants);
          setMirrorOwners(mirrorOwnerList);
        }
        setActiveMirror(payload?.mirror || null);
        setActiveMirrorOwnerClientId(payload?.mirror?.ownerClientId ?? null);
        setMirrorModeEnabled(typeof payload?.mirrorModeEnabled === "boolean" ? payload.mirrorModeEnabled : null);
        if (payload?.permissionContext) {
          applyPermissionContext(payload.permissionContext, payload?.clientId || tenantId);
        } else {
          setPermissionLoading(false);
          setPermissionLoaded(false);
          setPermissionTenantId(null);
        }
      })
      .catch((contextError) => {
        if (!cancelled) {
          console.warn("Falha ao carregar contexto do tenant", contextError);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [fetchTenantContext, tenantId, tenants, token, user]);

  useEffect(() => {
    let cancelled = false;
    if (!user || !token || mirrorContextMode !== "target" || !activeMirrorOwnerClientId) {
      return () => {};
    }

    async function loadActiveMirror() {
      const payload = await fetchMirrorContext({ ownerClientId: activeMirrorOwnerClientId });
      if (cancelled || !payload) return;
      if (typeof payload.mirrorModeEnabled === "boolean") {
        setMirrorModeEnabled(payload.mirrorModeEnabled);
      }
      setActiveMirror(payload.activeMirror || null);
    }

    loadActiveMirror();

    return () => {
      cancelled = true;
    };
  }, [activeMirrorOwnerClientId, fetchMirrorContext, mirrorContextMode, token, user]);

  useEffect(() => {
    let cancelled = false;

    async function loadPermissionContext() {
      if (permissionLoading) {
        return;
      }
      if (permissionLoaded && String(permissionTenantId ?? "") === String(tenantId ?? "")) {
        return;
      }
      if (!user) {
        setPermissionContext({ permissions: null, isFull: true, permissionGroupId: null });
        setPermissionLoaded(true);
        setPermissionTenantId(null);
        setPermissionLoading(false);
        return;
      }
      if (user.role === "admin") {
        setPermissionContext({ permissions: null, isFull: true, permissionGroupId: null });
        setPermissionLoaded(true);
        setPermissionTenantId(tenantId ?? null);
        setPermissionLoading(false);
        return;
      }
      setPermissionLoading(true);
      try {
        const params = tenantId === null || tenantId === undefined ? {} : { clientId: tenantId };
        const response = await api.get(API_ROUTES.permissionsContext, { params });
        if (cancelled) return;
        const payload = response?.data || {};
        applyPermissionContext(payload, tenantId ?? null);
      } catch (permissionError) {
        if (cancelled) return;
        const status = permissionError?.response?.status ?? permissionError?.status;
        if (
          status === 403 &&
          tenantId !== null &&
          tenantId !== undefined &&
          user?.clientId &&
          tenantId !== user.clientId
        ) {
          setTenantId(user.clientId);
          return;
        }
        console.warn("Falha ao carregar permissões", permissionError);
        setPermissionContext({ permissions: null, isFull: false, permissionGroupId: null });
        setPermissionLoaded(true);
        setPermissionTenantId(tenantId ?? null);
      } finally {
        if (!cancelled) setPermissionLoading(false);
      }
    }

    if (!token) {
      setPermissionContext({ permissions: null, isFull: true, permissionGroupId: null });
      setPermissionLoaded(true);
      setPermissionTenantId(null);
      setPermissionLoading(false);
      return () => {
        cancelled = true;
      };
    }

    loadPermissionContext();

    return () => {
      cancelled = true;
    };
  }, [
    activeMirror,
    applyPermissionContext,
    permissionLoaded,
    permissionLoading,
    permissionTenantId,
    setTenantId,
    tenantId,
    token,
    user,
  ]);

  useEffect(() => {
    const unsubscribe = registerUnauthorizedHandler(() => {
      setToken(null);
      setUser(null);
      setTenants([]);
      setTenantId(null);
      setMirrorOwners(null);
      setActiveMirror(null);
      setActiveMirrorOwnerClientId(null);
      setMirrorModeEnabled(null);
      setMirrorContextMode(null);
      setLoading(false);
      setInitialising(false);
    });

    return unsubscribe;
  }, []);

  const refreshClients = useCallback(async () => {
    if (!user) return [];
    const contextPayload = await fetchTenantContext({ clientId: tenantId });
    if (contextPayload?.error) {
      return tenants;
    }
    const normalized = normaliseClients(contextPayload?.clients || contextPayload?.client ? contextPayload : null, user);
    const mirrorOwnerList = resolveMirrorOwners(normalized, user);
    const effectiveTenants =
      user.role !== "admin" && Array.isArray(mirrorOwnerList) && mirrorOwnerList.length
        ? mirrorOwnerList
        : normalized;
    setMirrorOwners(mirrorOwnerList);
    setTenants(effectiveTenants);
    setTenantId((currentTenantId) =>
      resolveValidTenantId({
        currentTenantId,
        suggestedTenantId: contextPayload?.clientId || user.clientId,
        tenants: effectiveTenants,
        isAdmin: user.role === "admin",
      }),
    );
    return effectiveTenants;
  }, [fetchTenantContext, tenantId, tenants, user]);

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
        const contextResponse = await fetchTenantContext();
        const contextPayload = contextResponse?.error ? null : contextResponse;
        const contextClients = normaliseClients(contextPayload?.clients || contextPayload?.client ? contextPayload : null, sessionUser);
        const sessionTenants = normaliseClients(sessionPayload.clients || sessionPayload.client ? sessionPayload : null, sessionUser);
        const availableClients = contextClients.length ? contextClients : sessionTenants;
        const mirrorOwnerList = resolveMirrorOwners(availableClients, sessionUser);
        const effectiveTenants =
          sessionUser.role !== "admin" && Array.isArray(mirrorOwnerList) && mirrorOwnerList.length
            ? mirrorOwnerList
            : availableClients;
        const nextTenantId = resolveValidTenantId({
          currentTenantId: tenantId ?? resolvedTenantId,
          suggestedTenantId: contextPayload?.clientId || resolvedClientId || resolvedTenantId,
          tenants: effectiveTenants,
          isAdmin: sessionUser.role === "admin",
        });
        setUser(sessionUser);
        setMirrorOwners(mirrorOwnerList);
        setTenants(effectiveTenants);
        setTenantId(nextTenantId);
        setActiveMirror(contextPayload?.mirror || null);
        setActiveMirrorOwnerClientId(contextPayload?.mirror?.ownerClientId ?? null);
        setMirrorModeEnabled(
          typeof contextPayload?.mirrorModeEnabled === "boolean" ? contextPayload.mirrorModeEnabled : null,
        );
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
  }, [fetchTenantContext, tenantId]);

  const logout = useCallback(async () => {
    try {
      await api.post(API_ROUTES.logout).catch(() => undefined);
    } finally {
      clearStoredSession();
      setToken(null);
      setUser(null);
      setTenants([]);
      setTenantId(null);
      setMirrorOwners(null);
      setActiveMirror(null);
      setActiveMirrorOwnerClientId(null);
      setMirrorModeEnabled(null);
      setMirrorContextMode(null);
    }
  }, []);


  useEffect(() => {
    if (!user || !token) return;
    const activePermissionGroupId = activeMirror?.permissionGroupId ?? null;
    if (
      user.tenantId === tenantId &&
      user.activeMirrorOwnerClientId === activeMirrorOwnerClientId &&
      user.activeMirrorPermissionGroupId === activePermissionGroupId &&
      user.mirrorContextMode === mirrorContextMode
    ) {
      setStoredSession({ token, user });
      return;
    }
    const nextUser = {
      ...user,
      tenantId,
      activeMirrorOwnerClientId,
      activeMirrorPermissionGroupId: activePermissionGroupId,
      mirrorContextMode,
    };
    setUser(nextUser);
    setStoredSession({ token, user: nextUser });
  }, [activeMirror, activeMirrorOwnerClientId, mirrorContextMode, tenantId, token, user]);

  const value = useMemo(() => {
    const isAdmin = user?.role === "admin";
    const canSwitchTenant = isAdmin || (Array.isArray(mirrorOwners) && mirrorOwners.length > 0);
    const tenant =
      tenants.find((item) => item.id === tenantId) ??
      (isAdmin && !tenantId ? { id: null, name: "Todos os clientes", segment: "Todas as frotas" } : tenants[0] ?? null);
    const isMirrorReceiver = Boolean(
      !isAdmin &&
        ((Array.isArray(mirrorOwners) && mirrorOwners.length > 0) || (tenant ? isReceiverClient(tenant) : false)),
    );
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
      canSwitchTenant,
      role: user?.role ?? "guest",
      activeMirror,
      activeMirrorOwnerClientId,
      activeMirrorPermissionGroupId: activeMirror?.permissionGroupId ?? null,
      mirrorOwners,
      isMirrorReceiver,
      mirrorModeEnabled,
      mirrorContextMode,
      permissionContext,
      permissionLoading,
    };
  }, [
    tenantId,
    tenants,
    user,
    token,
    login,
    logout,
    loading,
    error,
    initialising,
    refreshClients,
    mirrorOwners,
    activeMirror,
    activeMirrorOwnerClientId,
    mirrorModeEnabled,
    mirrorContextMode,
    permissionContext,
    permissionLoading,
  ]);

  return <TenantContext.Provider value={value}>{children}</TenantContext.Provider>;
}

export function useTenant() {
  const ctx = useContext(TenantContext);
  if (!ctx) {
    throw new Error("useTenant deve ser usado dentro de TenantProvider");
  }
  return ctx;
}
