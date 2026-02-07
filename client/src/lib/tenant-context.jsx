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
import { isAdminGeneralClientName, normalizeAdminClientName } from "./admin-general.js";
import { canAccess as canAccessPermission } from "./permissions.js";
import { resolveMirrorClientParams, resolveMirrorHeaders } from "./mirror-params.js";

const TenantContext = createContext(null);
const MIRROR_OWNER_STORAGE_KEY = "euro-one.mirror.owner-client-id";
const BOOT_TIMEOUT_MS = 5000;
const SWITCH_TIMEOUT_MS = 8000;
const CONTEXT_REFRESH_TIMEOUT_MS = 15000;
const PERMISSION_READY_TIMEOUT_MS = 5000;

function createTimeoutError(stage, timeoutMs) {
  const error = new Error(`Tempo limite ao carregar ${stage}.`);
  error.code = "CLIENT_TIMEOUT";
  error.status = 504;
  error.stage = stage;
  error.timeoutMs = timeoutMs;
  return error;
}

function withDeadline(promise, timeoutMs, stage) {
  let timer = null;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(createTimeoutError(stage, timeoutMs)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

const RECEIVER_TYPES = new Set([
  "GERENCIADORA",
  "SEGURADORA",
  "GERENCIADORA DE RISCO",
  "COMPANHIA DE SEGURO",
]);
const BUONNY_MATCH = /BUONNY/i;

function isBuonnyClientName(name) {
  return BUONNY_MATCH.test(String(name || ""));
}

function isValidCssColor(value) {
  if (!value) return false;
  const text = String(value).trim();
  if (!text) return false;
  if (typeof window !== "undefined" && window.CSS?.supports) {
    return window.CSS.supports("color", text);
  }
  return /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(text) || /^(rgb|hsl)a?\(/i.test(text);
}

function resolveBrandColor(client) {
  if (!client) return null;
  const candidate =
    client.brandColor ??
    client.attributes?.brandColor ??
    client.attributes?.brand_color ??
    client.attributes?.accentColor ??
    client.attributes?.accent_color ??
    null;
  if (!candidate) return null;
  const value = String(candidate).trim();
  if (!value) return null;
  return isValidCssColor(value) ? value : null;
}

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
    brandColor: resolveBrandColor(client),
    deviceLimit: client.deviceLimit,
    userLimit: client.userLimit,
    attributes: client.attributes || {},
  }));
}

function resolveAdminGeneralTenantId(list = []) {
  const match = Array.isArray(list)
    ? list.find((client) => isAdminGeneralClientName(client?.name || client?.companyName))
    : null;
  return match?.id ?? null;
}

function normalizeAdminTenantId(tenantId, user, tenantList) {
  if (!user || user.role !== "admin") return tenantId;
  if (tenantId === null || tenantId === undefined) return null;
  const adminTenantId = resolveAdminGeneralTenantId(tenantList);
  if (adminTenantId && String(adminTenantId) === String(tenantId)) {
    return null;
  }
  return tenantId;
}

function filterAdminTenants(list = [], isAdmin) {
  if (!isAdmin) return list;
  if (!Array.isArray(list)) return [];
  return list.filter((client) => !isAdminGeneralClientName(client?.name || client?.companyName));
}

function resolveMirrorOwners(list = [], { homeClientId, currentUser, allowedMirrorOwnerIds } = {}) {
  if (!currentUser || currentUser.role === "admin") return null;
  let owners = list.filter((client) => String(client.id) !== String(homeClientId ?? currentUser.clientId));
  if (Array.isArray(allowedMirrorOwnerIds)) {
    const allowedSet = new Set(allowedMirrorOwnerIds.map((id) => String(id)));
    owners = owners.filter((client) => allowedSet.has(String(client.id)));
  }
  return owners.length ? owners : null;
}

function mergeTenantLists(base = [], extra = []) {
  if (!Array.isArray(extra) || extra.length === 0) return base;
  const seen = new Set(base.map((client) => String(client.id)));
  const merged = [...base];
  extra.forEach((client) => {
    const id = String(client?.id ?? "");
    if (!id || seen.has(id)) return;
    seen.add(id);
    merged.push(client);
  });
  return merged;
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

function areSameTenants(current = [], next = []) {
  if (current === next) return true;
  if (!Array.isArray(current) || !Array.isArray(next)) return false;
  if (current.length !== next.length) return false;
  for (let index = 0; index < current.length; index += 1) {
    const currentId = current[index]?.id ?? null;
    const nextId = next[index]?.id ?? null;
    if (String(currentId ?? "") !== String(nextId ?? "")) {
      return false;
    }
  }
  return true;
}

function areSameMirror(current, next) {
  if (current === next) return true;
  if (!current && !next) return true;
  if (!current || !next) return false;
  return (
    String(current.ownerClientId ?? "") === String(next.ownerClientId ?? "") &&
    String(current.targetClientId ?? "") === String(next.targetClientId ?? "") &&
    String(current.mirrorId ?? "") === String(next.mirrorId ?? "") &&
    String(current.permissionGroupId ?? "") === String(next.permissionGroupId ?? "") &&
    String(current.vehicleGroupId ?? "") === String(next.vehicleGroupId ?? "")
  );
}

function getStoredMirrorOwnerId() {
  if (typeof window === "undefined") return null;
  try {
    const sessionValue = window.sessionStorage?.getItem(MIRROR_OWNER_STORAGE_KEY);
  if (sessionValue) return sessionValue;
    const localValue = window.localStorage?.getItem(MIRROR_OWNER_STORAGE_KEY);
  if (localValue) return localValue;
    return null;
  } catch (_error) {
    return null;
  }
}

export function setStoredMirrorOwnerId(value) {
  if (typeof window === "undefined") return;
  try {
    if (value) {
      window.sessionStorage?.setItem(MIRROR_OWNER_STORAGE_KEY, value);
      window.localStorage?.setItem(MIRROR_OWNER_STORAGE_KEY, value);
    } else {
      window.sessionStorage?.removeItem(MIRROR_OWNER_STORAGE_KEY);
      window.localStorage?.removeItem(MIRROR_OWNER_STORAGE_KEY);
    }
  } catch (_error) {
    // ignore storage failures
  }
}

export function TenantProvider({ children }) {
  const stored = useMemo(() => getStoredSession(), []);
  const storedUserId = stored?.user?.id ?? null;
  const hasStoredTenantId =
    stored?.user && Object.prototype.hasOwnProperty.call(stored.user, "tenantId");
  const storedTenantId = hasStoredTenantId ? stored.user.tenantId : null;
  const storedActiveMirrorOwnerClientId =
    getStoredMirrorOwnerId() ?? stored?.user?.activeMirrorOwnerClientId ?? null;
  const storedMirrorContextMode = stored?.user?.mirrorContextMode ?? null;

  const [tenantId, setTenantIdState] = useState(
    hasStoredTenantId ? storedTenantId : stored?.user?.clientId ?? null,
  );
  const [user, setUser] = useState(stored?.user ?? null);
  const [token, setToken] = useState(stored?.token ?? null);
  const [homeClientId, setHomeClientId] = useState(stored?.user?.clientId ?? null);
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
    isFull: false,
    permissionGroupId: null,
  });
  const [permissionOwnerClientId, setPermissionOwnerClientId] = useState(null);
  const [permissionLoading, setPermissionLoading] = useState(false);
  const [permissionTenantId, setPermissionTenantId] = useState(null);
  const [permissionLoaded, setPermissionLoaded] = useState(false);
  const [permissionError, setPermissionError] = useState(null);
  const [accessScopeLoaded, setAccessScopeLoaded] = useState(false);
  const [allowedClientIds, setAllowedClientIds] = useState(null);
  const [allowedMirrorOwnerIds, setAllowedMirrorOwnerIds] = useState(null);
  const [mirrorAllowAll, setMirrorAllowAll] = useState(null);
  const [apiUnavailable, setApiUnavailable] = useState(false);
  const [contextSwitching, setContextSwitching] = useState(false);
  const [contextSwitchKey, setContextSwitchKey] = useState("init");
  const [contextAbortSignal, setContextAbortSignal] = useState(null);
  const lastUserIdRef = useRef(stored?.user?.id ?? null);
  const tenantsRef = useRef(tenants);
  const userRef = useRef(user);
  const tenantIdRef = useRef(tenantId);
  const hydratedRef = useRef(false);
  const lastTokenRef = useRef(stored?.token ?? null);
  const contextSwitchRef = useRef({ key: "init", id: 0 });
  const contextAbortRef = useRef(null);
  const contextSwitchingRef = useRef(false);
  const switchSeqRef = useRef(0);
  const bootstrapSeqRef = useRef(0);
  const contextFetchSeqRef = useRef(0);
  const mirrorStateRef = useRef({
    mirrorContextMode,
    mirrorModeEnabled,
    activeMirrorOwnerClientId,
    activeMirror,
  });
  const contextRequestRef = useRef({ key: null, ts: 0, promise: null, data: null, errorTs: 0 });
  const mirrorRequestRef = useRef({ key: null, ts: 0, promise: null, data: null, errorTs: 0 });
  const permissionRequestRef = useRef({ key: null, ts: 0, promise: null, data: null, errorTs: 0 });
  const lastContextEffectRef = useRef({ key: null, ts: 0 });
  const lastContextSuccessRef = useRef({ key: null, ts: 0 });
  const mirrorDebugRef = useRef({ last: 0 });
  const apiUnavailableRef = useRef({ until: 0 });
  const permissionFetchRef = useRef(null);
  const bootPermissionLoggedRef = useRef(false);
  const permissionAttemptRef = useRef(0);
  const permissionTimeoutRef = useRef({ count: 0, ts: 0 });

  const logBoot = useCallback((label, details = {}, level = "info") => {
    const payload = { ...details };
    if (level === "warn") {
      console.warn("[boot]", label, payload);
    } else {
      console.info("[boot]", label, payload);
    }
  }, []);

  const logMirrorDebug = useCallback((label, details = {}) => {
    const now = Date.now();
    if (now - mirrorDebugRef.current.last < 800) return;
    mirrorDebugRef.current.last = now;
    console.info("[mirror-debug]", label, details);
  }, []);

  const buildBootError = useCallback((stage, error) => {
    const base = error instanceof Error ? error : new Error(String(error || ""));
    const code = base?.code || base?.response?.data?.code || null;
    const isTimeout =
      code === "REQUEST_TIMEOUT" ||
      code === "CLIENT_TIMEOUT" ||
      base?.isTimeout === true ||
      base?.message?.toLowerCase?.().includes("tempo limite");
    const fallbackMap = {
      session: "Falha ao carregar sessão. Tente novamente.",
      permissions: "Falha ao carregar permissões da sessão. Tente novamente.",
      context: "Falha ao carregar contexto do cliente. Tente novamente.",
    };
    const timeoutMap = {
      session: "Tempo limite ao carregar sessão. Tente novamente.",
      permissions: "Tempo limite ao carregar permissões. Tente novamente.",
      context: "Tempo limite ao carregar contexto do cliente. Tente novamente.",
    };
    const message = isTimeout ? timeoutMap[stage] : fallbackMap[stage];
    if (message) {
      if (isTimeout) {
        base.message = message;
      } else if (!base.message || base.message === "Request timeout") {
        base.message = message;
      }
    }
    base.stage = stage;
    return base;
  }, []);

  const reportBootError = useCallback(
    (stage, error, details = {}) => {
      const resolved = buildBootError(stage, error);
      setError(resolved);
      logBoot(`boot:${stage} error`, { code: resolved?.code || null, ...details }, "warn");
      return resolved;
    },
    [buildBootError, logBoot],
  );

  const markApiUnavailable = useCallback((error) => {
    if (error?.code !== "API_UNREACHABLE") return false;
    apiUnavailableRef.current = { until: Date.now() + 8000 };
    setApiUnavailable(true);
    return true;
  }, []);

  const persistSessionUser = useCallback((partial = {}) => {
    const currentUser = userRef.current;
    if (!token || !currentUser) return;
    const stored = getStoredSession();
    const storedUser =
      stored?.user && String(stored.user?.id ?? "") === String(currentUser?.id ?? "")
        ? stored.user
        : currentUser;
    setStoredSession({
      token,
      user: {
        ...storedUser,
        ...partial,
      },
    });
  }, [token]);

  const resetMirrorSelection = useCallback(
    (reason = "unknown") => {
      logMirrorDebug("mirror:reset", {
        reason,
        activeMirrorOwnerClientId: activeMirrorOwnerClientId ?? null,
        mirrorContextMode: mirrorStateRef.current?.mirrorContextMode ?? null,
      });
      setActiveMirror(null);
      setActiveMirrorOwnerClientId(null);
      setStoredMirrorOwnerId(null);
      mirrorStateRef.current = {
        ...(mirrorStateRef.current || {}),
        activeMirrorOwnerClientId: null,
        activeMirror: null,
      };
      persistSessionUser({ activeMirrorOwnerClientId: null, activeMirrorPermissionGroupId: null });
    },
    [activeMirrorOwnerClientId, logMirrorDebug, persistSessionUser],
  );

  const clearStoredTenantId = useCallback(
    (reason = "unknown") => {
      logMirrorDebug("tenant:reset", { reason, tenantId: tenantIdRef.current ?? null });
      persistSessionUser({ tenantId: null });
    },
    [logMirrorDebug, persistSessionUser],
  );

  const canUseMirrorAll = useMemo(() => {
    if (!user || user.role === "admin") return false;
    if (mirrorAllowAll === true) return true;
    if (Array.isArray(allowedMirrorOwnerIds)) return allowedMirrorOwnerIds.length > 0;
    if (Array.isArray(mirrorOwners)) return mirrorOwners.length > 0;
    return false;
  }, [allowedMirrorOwnerIds, mirrorAllowAll, mirrorOwners, user]);

  const applyPermissionContext = useCallback((payload, resolvedTenantId, ownerClientId = null) => {
    if (!payload) return;
    const permissions =
      payload?.permissions && typeof payload.permissions === "object" ? payload.permissions : null;
    const currentUser = userRef.current;
    const isAdmin = currentUser?.role === "admin";
    const fallbackTenantId = currentUser?.clientId ?? null;
    const isGlobalAdminTenant = isAdmin && (resolvedTenantId === null || resolvedTenantId === undefined);
    const effectiveTenantId = isGlobalAdminTenant ? null : (resolvedTenantId ?? fallbackTenantId ?? null);
    setPermissionContext({
      permissions,
      isFull: Boolean(payload?.isFull || payload?.level === "full"),
      permissionGroupId: payload?.permissionGroupId ?? null,
    });
    setPermissionTenantId(effectiveTenantId);
    setPermissionOwnerClientId(ownerClientId ?? null);
    setPermissionLoaded(true);
    setPermissionLoading(false);
  }, []);

  const applyAccessScope = useCallback((payload) => {
    if (!payload || payload?.aborted) return;
    const clientIds = Array.isArray(payload.clientIds)
      ? payload.clientIds.map((id) => String(id))
      : null;
    const allowAll = payload.mirrorAllowAll === true;
    const mirrorOwnerIds = Array.isArray(payload.mirrorOwnerIds)
      ? payload.mirrorOwnerIds.map((id) => String(id))
      : [];
    setAllowedClientIds(clientIds);
    setAllowedMirrorOwnerIds(allowAll ? null : mirrorOwnerIds);
    setMirrorAllowAll(allowAll);
    setAccessScopeLoaded(true);
  }, []);

  const fetchAccessScope = useCallback(async ({ signal, timeoutMs = BOOT_TIMEOUT_MS } = {}) => {
    try {
      const request = api.get(API_ROUTES.mePermissions, { signal, timeout: timeoutMs });
      const response = await withDeadline(request, timeoutMs + 500, "permissions");
      return response?.data || null;
    } catch (accessError) {
      if (accessError?.name === "AbortError" || accessError?.code === "ERR_CANCELED") {
        return { aborted: true };
      }
      if (accessError?.code === "REQUEST_TIMEOUT" || accessError?.code === "CLIENT_TIMEOUT") {
        return { error: accessError, status: 504, code: accessError?.code };
      }
      console.warn("Falha ao carregar escopo de acesso", accessError);
      return { error: accessError };
    }
  }, []);

  const fetchPermissionContext = useCallback(
    async ({
      clientId,
      force = false,
      minIntervalMs = 4000,
      signal,
      timeoutMs = CONTEXT_REFRESH_TIMEOUT_MS,
    } = {}) => {
      const effectiveClientId =
        clientId === undefined ? (tenantIdRef.current ?? userRef.current?.clientId ?? null) : clientId;
      const {
        mirrorContextMode: resolvedMirrorMode,
        activeMirrorOwnerClientId: resolvedActiveMirrorOwnerClientId,
      } = mirrorStateRef.current || {};
      const mirrorOwnerClientId =
        resolvedMirrorMode === "target" && resolvedActiveMirrorOwnerClientId
          ? String(resolvedActiveMirrorOwnerClientId)
          : null;
      const modeKey = resolvedMirrorMode ?? "self";
      const ownerKey = mirrorOwnerClientId ?? "none";
      const tenantKey =
        effectiveClientId === null || effectiveClientId === undefined ? "self" : String(effectiveClientId);
      const key = `${modeKey}:${ownerKey}:${tenantKey}`;
      const now = Date.now();
      const cached = permissionRequestRef.current;
      if (!force && cached.key === key) {
        if (cached.promise) {
          return cached.promise;
        }
        if (now - cached.ts < minIntervalMs) {
          if (cached.errorTs && now - cached.errorTs < minIntervalMs) {
            return cached.data ?? null;
          }
          return cached.data ?? null;
        }
      }
      const params =
        effectiveClientId === null || effectiveClientId === undefined ? {} : { clientId: effectiveClientId };
      const headers = mirrorOwnerClientId
        ? { "X-Owner-Client-Id": mirrorOwnerClientId, "X-Mirror-Mode": "target" }
        : undefined;
      const request = withDeadline(
        api.get(API_ROUTES.permissionsContext, { params, headers, signal, timeout: timeoutMs }),
        timeoutMs + 500,
        "permissions",
      )
        .then((response) => response?.data || {})
        .catch((permissionError) => {
          if (permissionError?.name === "AbortError" || permissionError?.code === "ERR_CANCELED") {
            return { aborted: true };
          }
          if (permissionError?.code === "REQUEST_TIMEOUT" || permissionError?.code === "CLIENT_TIMEOUT") {
            permissionRequestRef.current = {
              key,
              ts: Date.now(),
              promise: null,
              data: cached.data ?? null,
              errorTs: Date.now(),
            };
            return { error: permissionError, status: 504, code: permissionError?.code };
          }
          throw permissionError;
        })
        .finally(() => {
          if (permissionRequestRef.current.key === key) {
            permissionRequestRef.current.promise = null;
          }
        });
      permissionRequestRef.current = { key, ts: now, promise: request, data: cached.data, errorTs: 0 };
      const payload = await request;
      const cachedData = payload?.error ? cached.data ?? null : payload;
      permissionRequestRef.current = {
        key,
        ts: Date.now(),
        promise: null,
        data: cachedData,
        errorTs: payload?.error ? Date.now() : 0,
      };
      return payload;
    },
    [],
  );

  useEffect(() => {
    contextSwitchingRef.current = contextSwitching;
  }, [contextSwitching]);

  const beginContextSwitch = useCallback(
    (nextKey, reason = "manual") => {
      const prevSwitch = contextSwitchRef.current;
      const seq = ++switchSeqRef.current;
      contextSwitchRef.current = { key: nextKey, id: seq };
      if (contextAbortRef.current) {
        try {
          contextAbortRef.current.abort(new Error("Context switch"));
          logMirrorDebug("switch:abort", {
            seq: prevSwitch.id,
            key: prevSwitch.key,
            reason,
          });
        } catch (_error) {
          // ignore abort errors
        }
      }
      const controller = new AbortController();
      contextAbortRef.current = controller;
      setContextAbortSignal(controller.signal);
      setContextSwitchKey(nextKey);
      setContextSwitching(true);
      logMirrorDebug("switch:begin", {
        seq,
        key: nextKey,
        reason,
        route: typeof window !== "undefined" ? window.location.pathname : "",
        tenantId: tenantIdRef.current ?? null,
        mirrorContextMode: mirrorStateRef.current?.mirrorContextMode ?? null,
        activeMirrorOwnerClientId: mirrorStateRef.current?.activeMirrorOwnerClientId ?? null,
      });
      return { seq, signal: controller.signal, key: nextKey };
    },
    [logMirrorDebug],
  );

  const finishContextSwitch = useCallback(
    (key, seq, status = "done") => {
      if (contextSwitchRef.current.key !== key) return;
      if (seq !== undefined && contextSwitchRef.current.id !== seq) return;
      setContextSwitching(false);
      logMirrorDebug("switch:end", {
        seq: contextSwitchRef.current.id,
        key,
        status,
        route: typeof window !== "undefined" ? window.location.pathname : "",
      });
    },
    [logMirrorDebug],
  );

  const setTenantId = useCallback(
    (nextTenantId) => {
      let resolved =
        nextTenantId === "" || nextTenantId === undefined ? null : nextTenantId;
      resolved = normalizeAdminTenantId(resolved, userRef.current, tenantsRef.current);
      if (contextSwitchingRef.current) {
        setTenantIdState((current) => {
          if (String(current ?? "") === String(resolved ?? "")) {
            return current;
          }
          return resolved;
        });
        return;
      }
      setTenantIdState((current) => {
        if (String(current ?? "") === String(resolved ?? "")) {
          return current;
        }
        return resolved;
      });
      if (mirrorContextMode === "target") {
        const resolvedHome = homeClientId ?? userRef.current?.clientId ?? null;
        const shouldMirror =
          resolved !== null &&
          resolved !== undefined &&
          resolvedHome &&
          String(resolved) !== String(resolvedHome);
        const mirrorOwnerIds = Array.isArray(mirrorOwners)
          ? new Set(mirrorOwners.map((owner) => String(owner.id)))
          : null;
        const nextOwnerId = shouldMirror ? String(resolved) : null;
        setActiveMirrorOwnerClientId((current) => {
          if (!shouldMirror) {
            if (!mirrorOwnerIds || mirrorOwnerIds.size === 0) {
              return current;
            }
            return null;
          }
          if (mirrorOwnerIds && mirrorOwnerIds.size > 0 && !mirrorOwnerIds.has(String(nextOwnerId ?? ""))) {
            return current;
          }
          if (String(current ?? "") === String(nextOwnerId ?? "")) {
            return current;
          }
          return nextOwnerId;
        });
      }
    },
    [homeClientId, mirrorContextMode, mirrorOwners],
  );

  const fetchAdminDirectory = useCallback(async ({ signal, user: userOverride } = {}) => {
    const currentUser = userOverride || userRef.current;
    if (!currentUser || currentUser.role !== "admin") return null;
    try {
      const response = await api.get(API_ROUTES.clients, {
        signal,
        skipMirrorClient: true,
        headers: { "X-Mirror-Mode": "self" },
      });
      const list = Array.isArray(response?.data?.clients) ? response.data.clients : [];
      if (!list.length) return null;
      return normaliseClients({ clients: list }, currentUser);
    } catch (error) {
      console.warn("Falha ao carregar diretório completo de clientes", error);
      return null;
    }
  }, []);

  const fetchTenantContext = useCallback(async ({ clientId, force = false, minIntervalMs = 4000, signal, timeoutMs = CONTEXT_REFRESH_TIMEOUT_MS } = {}) => {
    const effectiveClientId =
      clientId === undefined ? (tenantIdRef.current ?? userRef.current?.clientId ?? null) : clientId;
    const {
      mirrorContextMode: resolvedMirrorMode,
      mirrorModeEnabled: resolvedMirrorEnabled,
      activeMirrorOwnerClientId: resolvedActiveMirrorOwnerClientId,
      activeMirror: resolvedActiveMirror,
    } = mirrorStateRef.current || {};
    const resolvedOwnerId = resolvedActiveMirrorOwnerClientId ?? resolvedActiveMirror?.ownerClientId ?? null;
    const mirrorOwnerClientId =
      resolvedMirrorMode === "target" && resolvedOwnerId ? String(resolvedOwnerId) : null;
    const modeKey = resolvedMirrorMode ?? "self";
    const idKey =
      effectiveClientId === null || effectiveClientId === undefined ? "self" : String(effectiveClientId);
    const ownerKey = mirrorOwnerClientId ?? "none";
    const key = `${modeKey}:${ownerKey}:${idKey}`;
    const now = Date.now();
    const cached = contextRequestRef.current;
    if (!force && cached.key === key) {
      if (cached.promise) {
        return cached.promise;
      }
      if (now - cached.ts < minIntervalMs) {
        if (cached.errorTs && now - cached.errorTs < minIntervalMs) {
          return cached.data ?? null;
        }
        return cached.data ?? null;
      }
    }
    const params = resolveMirrorClientParams({
      params:
        effectiveClientId === null || effectiveClientId === undefined
          ? undefined
          : { clientId: effectiveClientId },
      tenantId: effectiveClientId,
      mirrorContextMode: resolvedMirrorMode,
      mirrorOwnerClientId,
    });
    const headers = resolveMirrorHeaders({
      mirrorModeEnabled: resolvedMirrorEnabled,
      mirrorOwnerClientId,
    });
    const request = withDeadline(
      api.get(API_ROUTES.context, { params, headers, skipMirrorClient: true, signal, timeout: timeoutMs }),
      timeoutMs + 500,
      "context",
    )
      .then((response) => {
        setApiUnavailable(false);
        return response?.data || null;
      })
      .catch((contextError) => {
        if (contextError?.name === "AbortError" || contextError?.code === "ERR_CANCELED") {
          return { aborted: true };
        }
        if (contextError?.code === "REQUEST_TIMEOUT" || contextError?.code === "CLIENT_TIMEOUT") {
          contextRequestRef.current = { key, ts: Date.now(), promise: null, data: cached.data ?? null, errorTs: Date.now() };
          return { error: contextError, status: 504, code: contextError?.code };
        }
        const status = contextError?.status || contextError?.response?.status;
        if (status === 403) {
          console.warn("Contexto de tenant negado", contextError);
          return { error: contextError, status };
        }
        if (markApiUnavailable(contextError)) {
          contextRequestRef.current = { key, ts: Date.now(), promise: null, data: cached.data ?? null, errorTs: Date.now() };
          return { error: contextError, status: 503, code: contextError.code };
        }
        contextRequestRef.current = { key, ts: Date.now(), promise: null, data: cached.data ?? null, errorTs: Date.now() };
        throw contextError;
      })
      .finally(() => {
        if (contextRequestRef.current.key === key) {
          contextRequestRef.current.promise = null;
        }
      });
    contextRequestRef.current = { key, ts: now, promise: request, data: cached.data, errorTs: 0 };
    const payload = await request;
    contextRequestRef.current = { key, ts: Date.now(), promise: null, data: payload, errorTs: 0 };
    return payload;
  }, []);

  const switchContext = useCallback(
    async ({ nextTenantId, nextOwnerClientId, nextMirrorMode } = {}) => {
      let resolvedTenantId =
        nextTenantId === "" || nextTenantId === undefined ? null : nextTenantId;
      resolvedTenantId = normalizeAdminTenantId(resolvedTenantId, userRef.current, tenantsRef.current);
      const resolvedOwnerId =
        nextOwnerClientId === "" || nextOwnerClientId === undefined ? null : nextOwnerClientId;
      const resolvedMirrorMode =
        nextMirrorMode === undefined || nextMirrorMode === null
          ? mirrorContextMode
          : nextMirrorMode || null;
      const nextKey = `${resolvedTenantId ?? "self"}:${resolvedOwnerId ?? "none"}:${resolvedMirrorMode ?? "self"}`;
      const currentKey = `${tenantId ?? "self"}:${activeMirrorOwnerClientId ?? "none"}:${mirrorContextMode ?? "self"}`;
      if (currentKey === nextKey && !contextSwitchingRef.current) {
        return;
      }
      setError(null);
      logBoot("boot:switchContext start", {
        tenantId: resolvedTenantId ?? null,
        ownerClientId: resolvedOwnerId ?? null,
        mirrorMode: resolvedMirrorMode ?? null,
      });
      const { seq, signal } = beginContextSwitch(nextKey, "switchContext");
      contextRequestRef.current = {
        key: null,
        ts: 0,
        promise: null,
        data: contextRequestRef.current.data ?? null,
        errorTs: 0,
      };
      mirrorRequestRef.current = {
        key: null,
        ts: 0,
        promise: null,
        data: mirrorRequestRef.current.data ?? null,
        errorTs: 0,
      };
      lastContextEffectRef.current = { key: null, ts: 0 };
      lastContextSuccessRef.current = { key: null, ts: 0 };
      setPermissionLoading(true);
      setPermissionLoaded(false);
      setPermissionTenantId(null);
      setPermissionOwnerClientId(null);
      setPermissionContext({ permissions: null, isFull: false, permissionGroupId: null });
      setActiveMirror(null);
      setActiveMirrorOwnerClientId(resolvedOwnerId);
      setStoredMirrorOwnerId(resolvedOwnerId);
      setMirrorContextMode(resolvedMirrorMode);
      mirrorStateRef.current = {
        ...(mirrorStateRef.current || {}),
        mirrorContextMode: resolvedMirrorMode,
        activeMirrorOwnerClientId: resolvedOwnerId,
        activeMirror: null,
      };
      setTenantIdState((current) => {
        if (String(current ?? "") === String(resolvedTenantId ?? "")) {
          return current;
        }
        return resolvedTenantId;
      });

      const sessionUser = userRef.current;
      if (sessionUser && token) {
        setStoredSession({
          token,
          user: {
            ...sessionUser,
            tenantId: resolvedTenantId,
            activeMirrorOwnerClientId: resolvedOwnerId,
            mirrorContextMode: resolvedMirrorMode,
          },
        });
      }
      try {
        const contextResponse = await fetchTenantContext({
          clientId: resolvedTenantId ?? null,
          force: true,
          minIntervalMs: 0,
          signal,
          timeoutMs: SWITCH_TIMEOUT_MS,
        });
        if (contextResponse?.error) {
          reportBootError("context", contextResponse.error, {
            stage: "switchContext",
            status: contextResponse.status ?? null,
            tenantId: resolvedTenantId ?? null,
          });
          if (contextSwitchRef.current.id === seq) {
            finishContextSwitch(nextKey, seq, "timeout");
          }
          return;
        }
        if (contextSwitchRef.current.id !== seq) return;
        const permissionPayload = await fetchPermissionContext({
          clientId: resolvedTenantId ?? null,
          signal,
          timeoutMs: SWITCH_TIMEOUT_MS,
        });
        if (permissionPayload?.error) {
          reportBootError("permissions", permissionPayload.error, {
            stage: "switchContext",
            status: permissionPayload.status ?? null,
            tenantId: resolvedTenantId ?? null,
          });
        }
        if (!permissionPayload?.aborted && !permissionPayload?.error) {
          applyPermissionContext(permissionPayload, resolvedTenantId ?? null, resolvedOwnerId ?? null);
        }
      } catch (switchError) {
        reportBootError("context", switchError, {
          stage: "switchContext",
          tenantId: resolvedTenantId ?? null,
        });
      } finally {
        if (contextSwitchRef.current.id === seq) {
          setPermissionLoading((current) => (current ? false : current));
          finishContextSwitch(nextKey, seq, "done");
        }
      }
    },
    [
      activeMirrorOwnerClientId,
      beginContextSwitch,
      applyPermissionContext,
      fetchPermissionContext,
      fetchTenantContext,
      finishContextSwitch,
      logBoot,
      mirrorContextMode,
      reportBootError,
      tenantId,
      token,
    ],
  );

  const fetchMirrorContext = useCallback(async ({ ownerClientId, force = false, minIntervalMs = 4000, signal } = {}) => {
    const modeKey = mirrorStateRef.current?.mirrorContextMode ?? "self";
    const tenantKey = tenantIdRef.current ?? "self";
    const ownerKey = ownerClientId ? String(ownerClientId) : "self";
    const key = `${tenantKey}:${modeKey}:${ownerKey}`;
    const now = Date.now();
    const cached = mirrorRequestRef.current;
    if (!force && cached.key === key) {
      if (cached.promise) {
        return cached.promise;
      }
      if (now - cached.ts < minIntervalMs) {
        if (cached.errorTs && now - cached.errorTs < minIntervalMs) {
          return cached.data ?? null;
        }
        return cached.data ?? null;
      }
    }
    const params = ownerClientId ? { ownerClientId } : undefined;
    const headers = ownerClientId ? { "X-Owner-Client-Id": ownerClientId } : undefined;
    const request = api
      .get(API_ROUTES.mirrorsContext, { params, headers, skipMirrorClient: true, signal })
      .then((response) => {
        setApiUnavailable(false);
        return response?.data || null;
      })
      .catch((mirrorError) => {
        if (mirrorError?.name === "AbortError" || mirrorError?.code === "ERR_CANCELED") {
          return { aborted: true };
        }
        console.warn("Falha ao carregar contexto de mirror", mirrorError);
        const status = mirrorError?.status || mirrorError?.response?.status;
        if (status === 403) {
          resetMirrorSelection("mirror-context-403");
        }
        if (markApiUnavailable(mirrorError)) {
          mirrorRequestRef.current = { key, ts: Date.now(), promise: null, data: cached.data ?? null, errorTs: Date.now() };
          return { error: mirrorError, status: 503, code: mirrorError.code };
        }
        mirrorRequestRef.current = { key, ts: Date.now(), promise: null, data: cached.data ?? null, errorTs: Date.now() };
        return null;
      })
      .finally(() => {
        if (mirrorRequestRef.current.key === key) {
          mirrorRequestRef.current.promise = null;
        }
      });
    mirrorRequestRef.current = { key, ts: now, promise: request, data: cached.data, errorTs: 0 };
    const payload = await request;
    mirrorRequestRef.current = { key, ts: Date.now(), promise: null, data: payload, errorTs: 0 };
    return payload;
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function hydrateSession() {
      const seq = ++bootstrapSeqRef.current;
      if (!token) {
        setLoading(false);
        setInitialising(false);
        return;
      }
      if (hydratedRef.current && lastTokenRef.current === token) {
        setLoading(false);
        setInitialising(false);
        return;
      }
      lastTokenRef.current = token;
      hydratedRef.current = true;
      bootPermissionLoggedRef.current = false;
      setLoading(true);
      setError(null);
      logBoot("boot:start", { token: Boolean(token) });
      try {
        const sessionRequest = api.get(API_ROUTES.session, { timeout: BOOT_TIMEOUT_MS });
        const response = await withDeadline(sessionRequest, BOOT_TIMEOUT_MS + 500, "session");
        if (cancelled) return;
        const payload = response?.data || {};
        const resolvedClientId = payload.clientId || payload.client?.id || payload.user?.clientId || null;
        const nextUser = payload.user ? { ...payload.user, clientId: payload.user.clientId ?? resolvedClientId } : payload || null;
        const storedUserMatches =
          storedUserId !== null &&
          storedUserId !== undefined &&
          String(storedUserId) === String(nextUser?.id ?? "");
        const safeStoredTenantId = storedUserMatches ? storedTenantId : null;
        const safeStoredMirrorOwnerClientId = storedUserMatches ? storedActiveMirrorOwnerClientId : null;
        const resolvedHomeClientId = nextUser?.clientId ?? resolvedClientId ?? null;
        if (seq !== bootstrapSeqRef.current) {
          setPermissionLoading(false);
          return;
        }
        setUser(nextUser);
        logBoot("boot:session ok", {
          userId: nextUser?.id ?? null,
          role: nextUser?.role ?? null,
        });
        if (resolvedHomeClientId) {
          setHomeClientId(resolvedHomeClientId);
        }
        setStoredSession({ token, user: nextUser });

        setPermissionLoading(true);
        setPermissionLoaded(false);
        setPermissionTenantId(null);
        const accessPayload = await fetchAccessScope({ signal: contextAbortSignal, timeoutMs: BOOT_TIMEOUT_MS });
        if (cancelled) return;
        if (accessPayload?.error) {
          logBoot("boot:access-scope error", {
            code: accessPayload?.code || accessPayload?.error?.code || null,
          }, "warn");
        } else if (accessPayload && !accessPayload.aborted) {
          applyAccessScope(accessPayload);
          logBoot("boot:access-scope ok", {});
        }
        const allowedMirrorOwnersFromPayload =
          accessPayload?.mirrorAllowAll === true
            ? null
            : Array.isArray(accessPayload?.mirrorOwnerIds)
              ? accessPayload.mirrorOwnerIds.map((id) => String(id))
              : allowedMirrorOwnerIds;
        const contextResponse = await fetchTenantContext({
          clientId: resolvedClientId ?? tenantIdRef.current ?? null,
          force: true,
          timeoutMs: BOOT_TIMEOUT_MS,
        });
        if (contextResponse?.error) {
          reportBootError("context", contextResponse.error, {
            status: contextResponse.status ?? null,
            clientId: resolvedClientId ?? null,
          });
          setPermissionLoading(false);
          setPermissionLoaded(false);
          setPermissionTenantId(null);
          setPermissionOwnerClientId(null);
          return;
        }
        if (!contextResponse?.aborted) {
          logBoot("boot:context ok", { clientId: contextResponse?.clientId ?? null });
        }
        const contextPayload = contextResponse?.error ? null : contextResponse;
        const contextClients = normaliseClients(contextPayload?.clients || contextPayload?.client ? contextPayload : null, nextUser);
        const sessionClients = normaliseClients(payload.clients || payload.client ? payload : null, nextUser);
        const availableClients = contextClients.length ? contextClients : sessionClients;
        const mirrorOwnerList = resolveMirrorOwners(availableClients, {
          homeClientId: resolvedHomeClientId,
          currentUser: nextUser,
          allowedMirrorOwnerIds: allowedMirrorOwnersFromPayload,
        });
        const effectiveTenants = availableClients;

        if (seq !== bootstrapSeqRef.current) {
          setPermissionLoading(false);
          return;
        }
        setMirrorOwners(mirrorOwnerList);
        setTenants(effectiveTenants);
        setActiveMirror((current) => (areSameMirror(current, contextPayload?.mirror || null) ? current : (contextPayload?.mirror || null)));
        setActiveMirrorOwnerClientId(
          contextPayload?.mirror?.ownerClientId ?? safeStoredMirrorOwnerClientId ?? null,
        );
        setMirrorModeEnabled(
          typeof contextPayload?.mirrorModeEnabled === "boolean" ? contextPayload.mirrorModeEnabled : null,
        );
        if (contextPayload?.permissionContext) {
          applyPermissionContext(
            contextPayload.permissionContext,
            contextPayload?.clientId || resolvedClientId,
            contextPayload?.mirror?.ownerClientId ?? safeStoredMirrorOwnerClientId ?? null,
          );
          if (!bootPermissionLoggedRef.current) {
            bootPermissionLoggedRef.current = true;
            logBoot("boot:permissions ok", { source: "context" });
          }
        } else {
          setPermissionLoading(false);
          setPermissionLoaded(false);
          setPermissionTenantId(null);
          setPermissionOwnerClientId(null);
        }

        if (nextUser) {
          const responseTenant = contextPayload?.clientId || payload.client?.id || payload.clientId || resolvedClientId || null;
          const preferredTenantId = hasStoredTenantId ? safeStoredTenantId : resolvedHomeClientId;
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
        reportBootError("session", sessionError, {
          status: sessionError?.status || sessionError?.response?.status || null,
        });
        setUser(null);
        setToken(null);
        clearStoredSession();
      } finally {
        if (!cancelled && seq === bootstrapSeqRef.current) {
          setLoading(false);
          setInitialising(false);
        }
      }
    }

    hydrateSession();

    return () => {
      cancelled = true;
    };
  }, [
    applyAccessScope,
    contextAbortSignal,
    fetchAccessScope,
    fetchTenantContext,
    hasStoredTenantId,
    logBoot,
    reportBootError,
    storedActiveMirrorOwnerClientId,
    storedTenantId,
    token,
    allowedMirrorOwnerIds,
  ]);

  useEffect(() => {
    tenantsRef.current = tenants;
  }, [tenants]);

  useEffect(() => {
    if (!user || user.role === "admin") return;
    if (!Array.isArray(tenants)) return;
    const mirrorOwnerList = resolveMirrorOwners(tenants, {
      homeClientId: homeClientId ?? user.clientId,
      currentUser: user,
      allowedMirrorOwnerIds,
    });
    setMirrorOwners((current) => {
      if (!mirrorOwnerList && !current) return current;
      const currentList = Array.isArray(current) ? current : [];
      const nextList = Array.isArray(mirrorOwnerList) ? mirrorOwnerList : [];
      return areSameTenants(currentList, nextList) ? current : mirrorOwnerList;
    });
  }, [allowedMirrorOwnerIds, homeClientId, tenants, user]);

  useEffect(() => {
    userRef.current = user;
    if (user?.clientId && String(user.clientId) !== String(homeClientId ?? "")) {
      setHomeClientId(user.clientId);
    }
  }, [homeClientId, user]);

  useEffect(() => {
    tenantIdRef.current = tenantId;
  }, [tenantId]);

  useEffect(() => {
    if (user?.role !== "admin") return;
    const adminTenantId = resolveAdminGeneralTenantId(tenantsRef.current);
    if (!adminTenantId) return;
    if (tenantId !== null && tenantId !== undefined && String(tenantId) === String(adminTenantId)) {
      setTenantIdState(null);
    }
  }, [tenantId, user?.role, tenants]);

  useEffect(() => {
    if (permissionLoading && permissionContext?.permissions) {
      setPermissionLoading(false);
    }
  }, [permissionContext?.permissions, permissionLoading]);

  useEffect(() => {
    if (bootPermissionLoggedRef.current) return;
    if (!token) return;
    if (permissionLoaded && !permissionLoading) {
      bootPermissionLoggedRef.current = true;
      logBoot("boot:permissions ok", { source: "fetch" });
    }
  }, [logBoot, permissionLoaded, permissionLoading, token]);

  useEffect(() => {
    mirrorStateRef.current = {
      mirrorContextMode,
      mirrorModeEnabled,
      activeMirrorOwnerClientId,
      activeMirror,
    };
  }, [activeMirror, activeMirrorOwnerClientId, mirrorContextMode, mirrorModeEnabled]);

  useEffect(() => {
    if (mirrorContextMode !== "target") return;
    if (activeMirrorOwnerClientId) return;
    if (!permissionOwnerClientId) return;
    if (Array.isArray(allowedMirrorOwnerIds) && !allowedMirrorOwnerIds.includes(String(permissionOwnerClientId))) {
      return;
    }
    setActiveMirrorOwnerClientId(String(permissionOwnerClientId));
  }, [
    activeMirrorOwnerClientId,
    allowedMirrorOwnerIds,
    mirrorContextMode,
    permissionOwnerClientId,
    setActiveMirrorOwnerClientId,
  ]);

  useEffect(() => {
    contextRequestRef.current = {
      key: null,
      ts: 0,
      promise: null,
      data: contextRequestRef.current.data ?? null,
      errorTs: 0,
    };
  }, [activeMirrorOwnerClientId, mirrorContextMode]);

  useEffect(() => {
    const currentId = user?.id ?? null;
    if (lastUserIdRef.current && currentId && currentId !== lastUserIdRef.current) {
      setTenantId(null);
      setTenants([]);
      setMirrorOwners(null);
      setActiveMirror(null);
      setActiveMirrorOwnerClientId(null);
      setStoredMirrorOwnerId(null);
      setMirrorModeEnabled(null);
      setMirrorContextMode(null);
      setAccessScopeLoaded(false);
      setAllowedClientIds(null);
      setAllowedMirrorOwnerIds(null);
      setMirrorAllowAll(null);
      setPermissionLoaded(false);
      setPermissionTenantId(null);
      clearStoredTenantId("user-change");
    }
    lastUserIdRef.current = currentId;
  }, [clearStoredTenantId, user?.id]);

  useEffect(() => {
    let cancelled = false;

    async function bootstrapMirrorContext() {
      if (!user || !token) return;
      if (user.role === "admin") {
        setMirrorContextMode("admin");
        return;
      }
      const payload = await fetchMirrorContext({ minIntervalMs: 30000, signal: contextAbortSignal });
      if (cancelled || !payload) return;
      if (payload?.error?.code === "API_UNREACHABLE") {
        return;
      }
      logMirrorDebug("bootstrap:mirror-context", {
        mode: payload?.mode ?? null,
        owners: Array.isArray(payload?.owners) ? payload.owners.length : null,
        targets: Array.isArray(payload?.targets) ? payload.targets.length : null,
        mirrorModeEnabled: payload?.mirrorModeEnabled ?? null,
      });
      if (typeof payload.mirrorModeEnabled === "boolean") {
        setMirrorModeEnabled(payload.mirrorModeEnabled);
      }
      if (payload.mode) {
        setMirrorContextMode(payload.mode);
      }
      if (payload.mode !== "target") return;
      const owners = normaliseClients(payload.owners || [], user);
      if (!owners.length || payload.mirrorModeEnabled === false) {
        setMirrorOwners([]);
        setActiveMirrorOwnerClientId(null);
        setStoredMirrorOwnerId(null);
        setMirrorContextMode("self");
        logMirrorDebug("bootstrap:owners-empty", {
          mode: payload?.mode ?? null,
          mirrorModeEnabled: payload?.mirrorModeEnabled ?? null,
        });
        return;
      }
      const storedOwnerId = getStoredMirrorOwnerId() ?? null;
      const forceAllForBuonny = isBuonnyClientName(
        payload?.targets?.[0]?.name
        || user?.attributes?.companyName
        || user?.name,
      );
      const wantsAll = (storedOwnerId && String(storedOwnerId) === "all") || forceAllForBuonny;
      const selectedOwnerId =
        owners.find((owner) => String(owner.id) === String(storedOwnerId))?.id ??
        (owners[0] ? owners[0].id : null);
      setMirrorOwners(owners);
      setTenants((current) => mergeTenantLists(current, owners));
      if (wantsAll) {
        setActiveMirrorOwnerClientId("all");
        setStoredMirrorOwnerId("all");
        setActiveMirror(null);
        logMirrorDebug("bootstrap:owners-all", { count: owners.length, forced: forceAllForBuonny });
        return;
      }
      if (selectedOwnerId) {
        setActiveMirrorOwnerClientId(selectedOwnerId);
        setStoredMirrorOwnerId(selectedOwnerId);
      }

      const ownerPayload = selectedOwnerId
        ? await fetchMirrorContext({
            ownerClientId: selectedOwnerId,
            minIntervalMs: 30000,
            signal: contextAbortSignal,
          })
        : null;
      if (cancelled || !ownerPayload) return;
      if (ownerPayload?.error?.code === "API_UNREACHABLE") {
        return;
      }
      logMirrorDebug("bootstrap:owner-context", {
        ownerClientId: selectedOwnerId,
        mirrorModeEnabled: ownerPayload?.mirrorModeEnabled ?? null,
        hasMirror: Boolean(ownerPayload?.activeMirror),
      });
      if (typeof ownerPayload.mirrorModeEnabled === "boolean") {
        setMirrorModeEnabled(ownerPayload.mirrorModeEnabled);
      }
      setActiveMirror((current) => (areSameMirror(current, ownerPayload.activeMirror || null) ? current : (ownerPayload.activeMirror || null)));
    }

    bootstrapMirrorContext();

    return () => {
      cancelled = true;
    };
  }, [contextAbortSignal, fetchMirrorContext, storedActiveMirrorOwnerClientId, token, user?.id, user?.role, user?.clientId]);

  useEffect(() => {
    if (!user || user.role === "admin") return;
    const storedOwnerId = getStoredMirrorOwnerId();
    if (String(storedOwnerId ?? "") === "all" && mirrorContextMode === "target") {
      if (!canUseMirrorAll) {
        if (activeMirrorOwnerClientId !== null) {
          setActiveMirrorOwnerClientId(null);
        }
        setStoredMirrorOwnerId(null);
        return;
      }
      if (String(activeMirrorOwnerClientId ?? "") !== "all") {
        setActiveMirrorOwnerClientId("all");
      }
      return;
    }
    if (String(activeMirrorOwnerClientId ?? "") === "all" && !canUseMirrorAll) {
      setActiveMirrorOwnerClientId(null);
      setStoredMirrorOwnerId(null);
      return;
    }
    if (activeMirrorOwnerClientId) {
      setStoredMirrorOwnerId(String(activeMirrorOwnerClientId));
    } else {
      setStoredMirrorOwnerId(null);
    }
  }, [activeMirrorOwnerClientId, canUseMirrorAll, mirrorContextMode, user]);

  useEffect(() => {
    if (mirrorContextMode === "target") return;
    if (activeMirrorOwnerClientId !== null) {
      setActiveMirrorOwnerClientId(null);
      setStoredMirrorOwnerId(null);
    }
  }, [activeMirrorOwnerClientId, mirrorContextMode]);

  useEffect(() => {
    if (mirrorContextMode !== "target") return;
    if (contextSwitching) return;
    if (!user) return;
    const storedOwnerId = getStoredMirrorOwnerId();
    if (String(storedOwnerId ?? "") === "all") {
      if (!canUseMirrorAll) {
        if (activeMirrorOwnerClientId !== null) {
          setActiveMirrorOwnerClientId(null);
        }
        setStoredMirrorOwnerId(null);
        return;
      }
      if (String(activeMirrorOwnerClientId ?? "") !== "all") {
        setActiveMirrorOwnerClientId("all");
      }
      return;
    }
    const mirrorOwnerIds = Array.isArray(mirrorOwners)
      ? new Set(mirrorOwners.map((owner) => String(owner.id)))
      : null;
    const nextOwnerId =
      storedOwnerId && mirrorOwnerIds?.has(String(storedOwnerId))
        ? String(storedOwnerId)
        : mirrorOwnerIds && mirrorOwnerIds.size > 0
          ? Array.from(mirrorOwnerIds)[0]
          : null;
    if (!nextOwnerId) return;
    if (String(activeMirrorOwnerClientId ?? "") !== String(nextOwnerId)) {
      logMirrorDebug("sync-owner:set", {
        nextOwnerId,
        activeMirrorOwnerClientId: activeMirrorOwnerClientId ?? null,
      });
      setActiveMirrorOwnerClientId(nextOwnerId);
    }
  }, [activeMirrorOwnerClientId, canUseMirrorAll, contextSwitching, mirrorContextMode, mirrorOwners, user]);

  useEffect(() => {
    if (mirrorContextMode !== "target") return;
    if (!activeMirrorOwnerClientId) return;
    if (!tenantId) return;
    if (String(activeMirrorOwnerClientId) === String(tenantId)) {
      const storedOwnerId = getStoredMirrorOwnerId();
      const fallbackOwner =
        String(storedOwnerId ?? "") === "all"
          ? "all"
          : storedOwnerId
            ? String(storedOwnerId)
            : "all";
      setActiveMirrorOwnerClientId(fallbackOwner);
    }
  }, [activeMirrorOwnerClientId, mirrorContextMode, tenantId]);

  useEffect(() => {
    if (!user || user.role === "admin") return;
    if (mirrorContextMode !== "target") return;
    if (!activeMirrorOwnerClientId) return;
    if (String(activeMirrorOwnerClientId) === "all") {
      if (!canUseMirrorAll) {
        setActiveMirrorOwnerClientId(null);
        setStoredMirrorOwnerId(null);
      }
      return;
    }
    if (
      Array.isArray(allowedMirrorOwnerIds) &&
      !allowedMirrorOwnerIds.includes(String(activeMirrorOwnerClientId))
    ) {
      setActiveMirrorOwnerClientId(null);
      setStoredMirrorOwnerId(null);
    }
  }, [activeMirrorOwnerClientId, allowedMirrorOwnerIds, canUseMirrorAll, mirrorContextMode, user]);

  useEffect(() => {
    let cancelled = false;
    const switchId = contextSwitchRef.current.id;
    const effectId = ++contextFetchSeqRef.current;
    if (!token) return () => {};
    const currentUser = userRef.current;
    if (!currentUser) return () => {};
    const contextKey = `${tenantId ?? "self"}:${activeMirrorOwnerClientId ?? "none"}:${mirrorContextMode ?? "self"}`;
    const now = Date.now();
    if (
      permissionLoaded &&
      !permissionLoading &&
      lastContextSuccessRef.current.key === contextKey &&
      now - lastContextSuccessRef.current.ts < 30000
    ) {
      if (contextSwitching && contextSwitchRef.current.key === contextKey) {
        finishContextSwitch(contextKey, switchId, "cached");
      }
      return () => {
        cancelled = true;
      };
    }
    if (lastContextEffectRef.current.key === contextKey && now - lastContextEffectRef.current.ts < 4000) {
      if (contextSwitching && contextSwitchRef.current.key === contextKey) {
        finishContextSwitch(contextKey, switchId, "throttled");
      }
      return () => {
        cancelled = true;
      };
    }
    lastContextEffectRef.current = { key: contextKey, ts: now };
    if (apiUnavailableRef.current.until > Date.now()) {
      if (contextSwitching && contextSwitchRef.current.key === contextKey) {
        finishContextSwitch(contextKey, switchId, "api-unavailable");
      }
      return () => {
        cancelled = true;
      };
    }
    if (currentUser.role === "admin" && tenantId === null) {
      setActiveMirror(null);
      setActiveMirrorOwnerClientId(null);
      if (contextSwitching && contextSwitchRef.current.key === contextKey) {
        finishContextSwitch(contextKey, switchId, "admin-self");
      }
      return () => {
        cancelled = true;
      };
    }
    const softRefresh = permissionLoaded && !permissionLoading;
    if (!softRefresh) {
      setPermissionLoading(true);
      setPermissionLoaded(false);
      setPermissionTenantId(null);
      setPermissionError(null);
    }
    logMirrorDebug("context:fetch", {
      tenantId: tenantId ?? null,
      mirrorContextMode: mirrorContextMode ?? null,
      activeMirrorOwnerClientId: activeMirrorOwnerClientId ?? null,
    });
    fetchTenantContext({ clientId: tenantId, minIntervalMs: 30000, signal: contextAbortSignal })
      .then((payload) => {
        if (cancelled || !currentUser) return;
        if (contextSwitchRef.current.id !== switchId) return;
        if (payload?.aborted) return;
        if (payload?.error) {
          if (payload?.status === 403) {
            resetMirrorSelection("context-403");
            clearStoredTenantId("context-403");
          }
          if (
            payload?.code === "REQUEST_TIMEOUT" ||
            payload?.code === "CLIENT_TIMEOUT" ||
            payload?.code === "API_UNREACHABLE"
          ) {
            reportBootError("context", payload.error, {
              stage: "refresh",
              status: payload?.status ?? null,
            });
          }
          const fallbackTenant = tenantsRef.current?.[0]?.id ?? currentUser.clientId ?? null;
          if (fallbackTenant && fallbackTenant !== tenantId) {
            setTenantId(fallbackTenant);
          }
          setPermissionContext({ permissions: null, isFull: false, permissionGroupId: null });
          setPermissionLoaded(false);
          setPermissionTenantId(null);
          setPermissionOwnerClientId(null);
          setPermissionLoading(false);
          if (payload?.code === "API_UNREACHABLE") {
            return;
          }
          if (contextSwitching && contextSwitchRef.current.key === contextKey) {
            finishContextSwitch(contextKey, switchId, "error");
          }
          return;
        }
        setApiUnavailable(false);
        setError((current) => (current ? null : current));
        const normalizedClients = normaliseClients(payload?.clients || payload?.client ? payload : null, currentUser);
        const mirrorOwnerList = resolveMirrorOwners(normalizedClients, {
          homeClientId: homeClientId ?? currentUser.clientId,
          currentUser,
          allowedMirrorOwnerIds,
        });
        const effectiveTenants =
          mirrorContextMode === "target" ? mergeTenantLists(normalizedClients, mirrorOwners) : normalizedClients;
        if (effectiveTenants.length) {
          setTenants((current) => (areSameTenants(current, effectiveTenants) ? current : effectiveTenants));
          if (mirrorOwnerList?.length) {
            setMirrorOwners(mirrorOwnerList);
          }
        }
        const nextMirror = payload?.mirror || null;
        setActiveMirror((current) => (areSameMirror(current, nextMirror) ? current : nextMirror));
        if (mirrorContextMode && mirrorContextMode !== "target") {
          setActiveMirrorOwnerClientId(nextMirror?.ownerClientId ?? null);
        }
        setMirrorModeEnabled(typeof payload?.mirrorModeEnabled === "boolean" ? payload.mirrorModeEnabled : null);
        if (payload?.permissionContext) {
          applyPermissionContext(
            payload.permissionContext,
            payload?.clientId || tenantId,
            payload?.mirror?.ownerClientId ?? activeMirrorOwnerClientId ?? null,
          );
        } else {
          // Evita travar a UI em "Carregando permissões..." quando o contexto não traz permissões.
          setPermissionLoading(false);
          setPermissionLoaded(true);
          setPermissionTenantId(tenantId ?? null);
          setPermissionOwnerClientId(activeMirrorOwnerClientId ?? null);
        }
        lastContextSuccessRef.current = { key: contextKey, ts: Date.now() };
        if (contextSwitching && contextSwitchRef.current.key === contextKey) {
          finishContextSwitch(contextKey, switchId, "done");
        }
        logMirrorDebug("context:done", {
          tenantId: tenantId ?? null,
          tenants: effectiveTenants.length,
          mirrorOwners: mirrorOwnerList?.length ?? 0,
          mirrorContextMode: mirrorContextMode ?? null,
          activeMirrorOwnerClientId: activeMirrorOwnerClientId ?? null,
          hasMirror: Boolean(nextMirror),
        });
      })
      .catch((contextError) => {
        if (!cancelled) {
          if (contextError?.name === "AbortError" || contextError?.code === "ERR_CANCELED") {
            if (contextSwitching && contextSwitchRef.current.key === contextKey) {
              finishContextSwitch(contextKey, switchId, "aborted");
            }
            return;
          }
          console.warn("Falha ao carregar contexto do tenant", contextError);
          setPermissionLoading(false);
          setPermissionLoaded(true);
          setPermissionTenantId(tenantId ?? null);
          setPermissionOwnerClientId(activeMirrorOwnerClientId ?? null);
          if (markApiUnavailable(contextError)) {
            setPermissionLoading(false);
            if (contextSwitching && contextSwitchRef.current.key === contextKey) {
              finishContextSwitch(contextKey, switchId, "api-unavailable");
            }
            return;
          }
          if (contextSwitching && contextSwitchRef.current.key === contextKey) {
            finishContextSwitch(contextKey, switchId, "error");
          }
        }
      });
    return () => {
      cancelled = true;
      if (contextFetchSeqRef.current === effectId) {
        setPermissionLoading(false);
      }
    };
  }, [
    activeMirrorOwnerClientId,
    allowedMirrorOwnerIds,
    clearStoredTenantId,
    contextAbortSignal,
    contextSwitching,
    fetchTenantContext,
    finishContextSwitch,
    homeClientId,
    mirrorContextMode,
    mirrorOwners,
    reportBootError,
    resetMirrorSelection,
    tenantId,
    token,
  ]);

  useEffect(() => {
    let cancelled = false;
    const switchId = contextSwitchRef.current.id;
    if (
      !user ||
      !token ||
      mirrorContextMode !== "target" ||
      !activeMirrorOwnerClientId ||
      contextSwitching
    ) {
      return () => {};
    }

    async function loadActiveMirror() {
      logMirrorDebug("mirror:fetch", {
        ownerClientId: activeMirrorOwnerClientId,
        mirrorContextMode: mirrorContextMode ?? null,
      });
      const payload = await fetchMirrorContext({
        ownerClientId: activeMirrorOwnerClientId,
        minIntervalMs: 30000,
        signal: contextAbortSignal,
      });
      if (cancelled || !payload) return;
      if (contextSwitchRef.current.id !== switchId) return;
      if (payload?.aborted) return;
      if (payload?.error?.code === "API_UNREACHABLE") {
        return;
      }
      if (typeof payload.mirrorModeEnabled === "boolean") {
        setMirrorModeEnabled(payload.mirrorModeEnabled);
      }
      setActiveMirror(payload.activeMirror || null);
      logMirrorDebug("mirror:done", {
        ownerClientId: activeMirrorOwnerClientId,
        mirrorModeEnabled: payload?.mirrorModeEnabled ?? null,
        hasMirror: Boolean(payload?.activeMirror),
      });
    }

    loadActiveMirror();

    return () => {
      cancelled = true;
    };
  }, [
    activeMirrorOwnerClientId,
    contextAbortSignal,
    contextSwitching,
    fetchMirrorContext,
    mirrorContextMode,
    token,
    user,
  ]);

  useEffect(() => {
    let cancelled = false;
    const switchId = contextSwitchRef.current.id;

    async function loadPermissionContext() {
      if (contextSwitching) {
        return;
      }
      permissionAttemptRef.current = Date.now();
      const mirrorSnapshot = mirrorStateRef.current || {};
      const mirrorMode = mirrorSnapshot.mirrorContextMode ?? mirrorContextMode ?? "self";
      const resolvedOwnerId = mirrorSnapshot.activeMirrorOwnerClientId ?? activeMirrorOwnerClientId ?? null;
      const permissionKey = `${mirrorMode}:${resolvedOwnerId ?? "none"}:${tenantId ?? "self"}`;
      if (permissionFetchRef.current === permissionKey) {
        return;
      }
      const activeMirrorPermissionGroupId = activeMirror?.permissionGroupId ?? null;
      const ownerMismatch =
        mirrorMode === "target" &&
        String(permissionOwnerClientId ?? "") !== String(resolvedOwnerId ?? "");
      if (permissionLoaded && String(permissionTenantId ?? "") === String(tenantId ?? "")) {
        if (mirrorMode === "target" && ownerMismatch) {
          // precisa recarregar quando o owner muda no modo target
        } else if (!activeMirrorPermissionGroupId) {
          return;
        } else if (String(permissionContext?.permissionGroupId ?? "") === String(activeMirrorPermissionGroupId)) {
          return;
        }
      }
      if (!user) {
        setPermissionContext({ permissions: null, isFull: false, permissionGroupId: null });
        setPermissionLoaded(true);
        setPermissionTenantId(null);
        setPermissionOwnerClientId(null);
        setPermissionLoading(false);
        return;
      }
      setPermissionLoading(true);
      permissionFetchRef.current = permissionKey;
      try {
        const payload = await fetchPermissionContext({ clientId: tenantId ?? null, signal: contextAbortSignal });
        if (cancelled || contextSwitchRef.current.id !== switchId) return;
        if (payload?.aborted) return;
        if (payload?.error) {
          reportBootError("permissions", payload.error, {
            stage: "refresh",
            status: payload?.status ?? null,
          });
          const fallbackTenantId = tenantId ?? null;
          const fallbackOwnerId = resolvedOwnerId ?? null;
          const cachedPermission = permissionRequestRef.current?.data;
          if (cachedPermission && !cachedPermission?.error && !cachedPermission?.aborted) {
            applyPermissionContext(cachedPermission, fallbackTenantId, fallbackOwnerId);
          } else {
            setPermissionContext({ permissions: null, isFull: false, permissionGroupId: null });
            setPermissionLoaded(true);
            setPermissionTenantId(fallbackTenantId);
            setPermissionOwnerClientId(fallbackOwnerId);
          }
          return;
        }
        applyPermissionContext(payload, tenantId ?? null, resolvedOwnerId ?? null);
      } catch (permissionError) {
        if (cancelled || contextSwitchRef.current.id !== switchId) return;
        if (permissionError?.name === "AbortError" || permissionError?.code === "ERR_CANCELED") return;
        const status = permissionError?.response?.status ?? permissionError?.status;
        if (status === 403) {
          resetMirrorSelection("permissions-403");
          clearStoredTenantId("permissions-403");
          setPermissionContext({ permissions: null, isFull: false, permissionGroupId: null });
          setPermissionLoaded(false);
          setPermissionTenantId(null);
          setPermissionOwnerClientId(null);
          const fallbackTenantId = resolveValidTenantId({
            currentTenantId: null,
            suggestedTenantId: user?.clientId ?? null,
            tenants: tenantsRef.current,
            isAdmin: user?.role === "admin",
          });
          if (
            fallbackTenantId &&
            String(fallbackTenantId ?? "") !== String(tenantId ?? "")
          ) {
            setTenantId(fallbackTenantId);
            return;
          }
        }
        console.warn("Falha ao carregar permissões", permissionError);
        setPermissionContext({ permissions: null, isFull: false, permissionGroupId: null });
        setPermissionLoaded(true);
        setPermissionTenantId(tenantId ?? null);
        setPermissionOwnerClientId(resolvedOwnerId ?? null);
      } finally {
        if (permissionFetchRef.current === permissionKey) {
          permissionFetchRef.current = null;
        }
        if (!cancelled && contextSwitchRef.current.id === switchId) setPermissionLoading(false);
      }
    }

    if (!token) {
      setPermissionContext({ permissions: null, isFull: false, permissionGroupId: null });
      setPermissionLoaded(true);
      setPermissionTenantId(null);
      setPermissionOwnerClientId(null);
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
    activeMirrorOwnerClientId,
    applyPermissionContext,
    contextAbortSignal,
    contextSwitching,
    clearStoredTenantId,
    fetchPermissionContext,
    mirrorContextMode,
    reportBootError,
    permissionLoaded,
    permissionLoading,
    permissionTenantId,
    permissionContext?.permissionGroupId,
    permissionOwnerClientId,
    resetMirrorSelection,
    setTenantId,
    tenantId,
    token,
    user,
  ]);

  useEffect(() => {
    const unsubscribe = registerUnauthorizedHandler(() => {
      if (contextAbortRef.current) {
        try {
          contextAbortRef.current.abort(new Error("Unauthorized"));
        } catch (_error) {
          // ignore abort errors
        }
      }
      setContextSwitching(false);
      setContextSwitchKey("init");
      setContextAbortSignal(null);
      setToken(null);
      setUser(null);
      setError(null);
      setTenants([]);
      setTenantId(null);
      setMirrorOwners(null);
      setActiveMirror(null);
      setActiveMirrorOwnerClientId(null);
      setStoredMirrorOwnerId(null);
      setMirrorModeEnabled(null);
      setMirrorContextMode(null);
      setAccessScopeLoaded(false);
      setAllowedClientIds(null);
      setAllowedMirrorOwnerIds(null);
      setMirrorAllowAll(null);
      setApiUnavailable(false);
      setPermissionLoading(false);
      setPermissionLoaded(false);
      setPermissionError(null);
      setLoading(false);
      setInitialising(false);
    });

    return unsubscribe;
  }, []);

  const refreshClients = useCallback(async () => {
    if (!user) return [];
    const contextPayload = await fetchTenantContext({ clientId: tenantId, signal: contextAbortSignal });
    if (contextPayload?.error) {
      return tenants;
    }
    let normalized = normaliseClients(contextPayload?.clients || contextPayload?.client ? contextPayload : null, user);
    if (user.role === "admin") {
      const adminDirectory = await fetchAdminDirectory({ signal: contextAbortSignal, user });
      if (Array.isArray(adminDirectory) && adminDirectory.length) {
        normalized = adminDirectory;
      }
    }
    const mirrorOwnerList = resolveMirrorOwners(normalized, {
      homeClientId: homeClientId ?? user?.clientId,
      currentUser: user,
      allowedMirrorOwnerIds,
    });
    const effectiveTenants =
      mirrorContextMode === "target" ? mergeTenantLists(normalized, mirrorOwners) : normalized;
    setMirrorOwners(mirrorOwnerList);
    setTenants(effectiveTenants);
    const nextTenantId = resolveValidTenantId({
      currentTenantId: tenantId ?? null,
      suggestedTenantId: contextPayload?.clientId || user.clientId,
      tenants: effectiveTenants,
      isAdmin: user.role === "admin",
    });
    setTenantId(nextTenantId);
    return effectiveTenants;
  }, [
    allowedMirrorOwnerIds,
    contextAbortSignal,
    fetchAdminDirectory,
    fetchTenantContext,
    homeClientId,
    mirrorContextMode,
    mirrorOwners,
    setTenantId,
    tenantId,
    tenants,
    user,
  ]);

  const login = useCallback(async ({ username, password, remember = true }) => {
    const seq = ++bootstrapSeqRef.current;
    setLoading(true);
    setError(null);
    bootPermissionLoggedRef.current = false;
    logBoot("boot:login start", { username: username ? String(username) : null });
    setActiveMirror(null);
    setActiveMirrorOwnerClientId(null);
    setStoredMirrorOwnerId(null);
    setMirrorContextMode(null);
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
      if (nextUser?.clientId) {
        setHomeClientId(nextUser.clientId);
      }
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
      if (seq !== bootstrapSeqRef.current) return responseUser;
      try {
        const sessionRequest = api.get(API_ROUTES.session, { timeout: BOOT_TIMEOUT_MS });
        const sessionResponse = await withDeadline(sessionRequest, BOOT_TIMEOUT_MS + 500, "session");
        const sessionPayload = sessionResponse?.data || {};
        const resolvedClientId =
          sessionPayload.clientId || sessionPayload.client?.id || sessionPayload.user?.clientId || null;
        const sessionUser = sessionPayload.user
          ? { ...sessionPayload.user, clientId: sessionPayload.user.clientId ?? resolvedClientId }
          : nextUser;
        const accessPayload = await fetchAccessScope({ signal: contextAbortSignal, timeoutMs: BOOT_TIMEOUT_MS });
        if (accessPayload?.error) {
          logBoot("boot:access-scope error", {
            code: accessPayload?.code || accessPayload?.error?.code || null,
          }, "warn");
        } else if (accessPayload && !accessPayload.aborted) {
          applyAccessScope(accessPayload);
        }
        const allowedMirrorOwnersFromPayload =
          accessPayload?.mirrorAllowAll === true
            ? null
            : Array.isArray(accessPayload?.mirrorOwnerIds)
              ? accessPayload.mirrorOwnerIds.map((id) => String(id))
              : allowedMirrorOwnerIds;
        const contextResponse = await fetchTenantContext({
          clientId: resolvedClientId ?? resolvedTenantId ?? null,
          force: true,
          timeoutMs: BOOT_TIMEOUT_MS,
        });
        if (contextResponse?.error) {
          reportBootError("context", contextResponse.error, {
            stage: "login",
            status: contextResponse.status ?? null,
            clientId: resolvedClientId ?? null,
          });
          return responseUser;
        }
        const contextPayload = contextResponse?.error ? null : contextResponse;
        const contextClients = normaliseClients(
          contextPayload?.clients || contextPayload?.client ? contextPayload : null,
          sessionUser,
        );
        const sessionTenants = normaliseClients(
          sessionPayload.clients || sessionPayload.client ? sessionPayload : null,
          sessionUser,
        );
        const adminDirectory = sessionUser.role === "admin"
          ? await fetchAdminDirectory({ user: sessionUser })
          : null;
        const availableClients =
          Array.isArray(adminDirectory) && adminDirectory.length
            ? adminDirectory
            : (contextClients.length ? contextClients : sessionTenants);
        const mirrorOwnerList = resolveMirrorOwners(availableClients, {
          homeClientId: sessionUser?.clientId,
          currentUser: sessionUser,
          allowedMirrorOwnerIds: allowedMirrorOwnersFromPayload,
        });
        const effectiveTenants = availableClients;
        const nextTenantId = resolveValidTenantId({
          currentTenantId: tenantId ?? resolvedTenantId,
          suggestedTenantId: contextPayload?.clientId || resolvedClientId || resolvedTenantId,
          tenants: effectiveTenants,
          isAdmin: sessionUser.role === "admin",
        });
        if (seq !== bootstrapSeqRef.current) return responseUser;
        setUser(sessionUser);
        setMirrorOwners(mirrorOwnerList);
        setTenants(effectiveTenants);
        setTenantId(nextTenantId);
        setActiveMirror((current) =>
          areSameMirror(current, contextPayload?.mirror || null) ? current : (contextPayload?.mirror || null),
        );
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
        reportBootError("session", sessionError, { stage: "login" });
      }
      return responseUser;
    } catch (loginError) {
      setError(loginError);
      throw loginError;
    } finally {
      if (seq === bootstrapSeqRef.current) {
        setLoading(false);
        setInitialising(false);
      }
    }
  }, [
    allowedMirrorOwnerIds,
    applyAccessScope,
    contextAbortSignal,
    fetchAccessScope,
    fetchAdminDirectory,
    fetchTenantContext,
    logBoot,
    reportBootError,
    tenantId,
  ]);

  const retryPermissions = useCallback(
    (reason = "manual") => {
      logBoot("boot:permissions retry", { reason });
      if (reason !== "auto-timeout") {
        permissionTimeoutRef.current = { count: 0, ts: 0 };
      }
      setPermissionError(null);
      setPermissionLoading(false);
      setPermissionLoaded(false);
      setPermissionTenantId(null);
      setPermissionOwnerClientId(null);
      setPermissionContext({ permissions: null, isFull: false, permissionGroupId: null });
      permissionFetchRef.current = null;
      permissionRequestRef.current = {
        key: null,
        ts: 0,
        promise: null,
        data: permissionRequestRef.current.data ?? null,
        errorTs: 0,
      };
      bootPermissionLoggedRef.current = false;
    },
    [logBoot],
  );

  const logout = useCallback(async () => {
    try {
      await api.post(API_ROUTES.logout).catch(() => undefined);
    } finally {
      clearStoredSession();
      if (contextAbortRef.current) {
        try {
          contextAbortRef.current.abort(new Error("Logout"));
        } catch (_error) {
          // ignore abort errors
        }
      }
      setContextSwitching(false);
      setContextSwitchKey("init");
      setContextAbortSignal(null);
      setToken(null);
      setUser(null);
      setError(null);
      setTenants([]);
      setTenantId(null);
      setMirrorOwners(null);
      setActiveMirror(null);
      setActiveMirrorOwnerClientId(null);
      setMirrorModeEnabled(null);
      setMirrorContextMode(null);
      setAccessScopeLoaded(false);
      setAllowedClientIds(null);
      setAllowedMirrorOwnerIds(null);
      setMirrorAllowAll(null);
      setApiUnavailable(false);
      setPermissionLoading(false);
      setPermissionLoaded(false);
      setPermissionError(null);
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

  const permissionTenantMatches = useMemo(() => {
    if (user?.role === "admin") {
      if (!permissionContext?.permissionGroupId || permissionContext?.isFull) {
        return true;
      }
      if (permissionTenantId === null || permissionTenantId === undefined) return true;
      if (tenantId === null || tenantId === undefined) return true;
    }
    return String(permissionTenantId ?? "") === String(tenantId ?? "");
  }, [
    permissionContext?.isFull,
    permissionContext?.permissionGroupId,
    permissionTenantId,
    tenantId,
    user?.role,
  ]);

  const value = useMemo(() => {
    const isAdmin = user?.role === "admin";
    const canSwitchTenant = isAdmin || (Array.isArray(mirrorOwners) && mirrorOwners.length > 0);
    const tenantPool =
      mirrorContextMode === "target" ? mergeTenantLists(tenants, mirrorOwners) : tenants;
    const adminGeneralTenantId = isAdmin ? resolveAdminGeneralTenantId(tenantPool) : null;
    const filteredTenantPool = filterAdminTenants(tenantPool, isAdmin);
    const activeTenantId =
      isAdmin && adminGeneralTenantId && String(adminGeneralTenantId) === String(tenantId ?? "")
        ? null
        : tenantId;
    const tenant =
      filteredTenantPool.find((item) => String(item.id) === String(activeTenantId ?? "")) ??
      (isAdmin && (activeTenantId === null || activeTenantId === undefined)
        ? { id: null, name: "Todos os clientes", segment: "Todas as frotas" }
        : filteredTenantPool[0] ?? null);
    const tenantScope = isAdmin && (activeTenantId === null || activeTenantId === undefined) ? "ALL" : "SINGLE";
    const tenantReady = isAdmin || (activeTenantId !== null && activeTenantId !== undefined);
    const activeMirrorPermissionGroupId = activeMirror?.permissionGroupId ?? null;
    const permissionGroupMatches =
      mirrorContextMode === "target"
        ? (!activeMirrorPermissionGroupId || !permissionContext?.permissionGroupId
          ? true
          : String(permissionContext?.permissionGroupId ?? "") === String(activeMirrorPermissionGroupId ?? ""))
        : true;
    const mirrorTargetReady = mirrorContextMode !== "target" || Boolean(activeMirrorOwnerClientId);
    const permissionOwnerMatches =
      mirrorContextMode === "target"
        ? !permissionOwnerClientId ||
          String(permissionOwnerClientId ?? "") === String(activeMirrorOwnerClientId ?? "")
        : true;
    const permissionsReady =
      Boolean(user) &&
      !initialising &&
      !permissionLoading &&
      permissionLoaded &&
      permissionTenantMatches &&
      permissionGroupMatches &&
      mirrorTargetReady &&
      permissionOwnerMatches &&
      tenantReady &&
      !contextSwitching;
    const resolvedHomeClientId = homeClientId ?? user?.clientId ?? null;
    const homeClient =
      tenantPool.find((item) => String(item.id) === String(resolvedHomeClientId)) ??
      (resolvedHomeClientId
        ? {
            id: resolvedHomeClientId,
            name: user?.attributes?.companyName || user?.name || "Meu cliente",
            segment: user?.attributes?.segment || "Frota",
            brandColor: resolveBrandColor(user),
            attributes: user?.attributes || {},
          }
        : null);
    const activeClient = tenant;
    const activeClientId = activeTenantId ?? null;
    const activeClientType = isAdmin && activeClientId === null
      ? "global"
      : resolvedHomeClientId && activeClientId !== null && activeClientId !== undefined
        ? (String(activeClientId) === String(resolvedHomeClientId) ? "owned" : "mirrored")
        : "owned";
    const isReadOnly = activeClientType === "mirrored";
    const canAccess = (permissionOrMenuKey, pageKey, subKey) =>
      canAccessPermission(permissionOrMenuKey, {
        pageKey,
        subKey,
        user,
        tenant,
        permissionContext,
        isGlobalAdmin: isAdmin,
        permissionsReady,
        readOnly: isReadOnly,
      });
    const isMirrorReceiver = Boolean(
      !isAdmin &&
        ((Array.isArray(mirrorOwners) && mirrorOwners.length > 0) ||
          (homeClient ? isReceiverClient(homeClient) : false)),
    );
    return {
      homeClientId: resolvedHomeClientId,
      homeClient,
      tenantId,
      tenantScope,
      setTenantId,
      switchContext,
      contextSwitching,
      contextSwitchKey,
      contextAbortSignal,
      activeClientId,
      activeClient,
      activeClientType,
      tenant,
      tenants: filteredTenantPool,
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
      isGlobalAdmin: isAdmin,
      isTenantAdmin: user?.role === "tenant_admin",
      canSwitchTenant,
      role: user?.role ?? "guest",
      activeMirror,
      activeMirrorOwnerClientId,
      setActiveMirrorOwnerClientId,
      activeMirrorPermissionGroupId: activeMirror?.permissionGroupId ?? null,
      mirrorOwners,
      apiUnavailable,
      isMirrorReceiver,
      mirrorModeEnabled,
      mirrorContextMode,
      permissionContext,
      permissionError,
      permissionLoading,
      permissionsReady,
      retryPermissions,
      permissionOwnerClientId,
      accessScopeLoaded,
      allowedClientIds,
      allowedMirrorOwnerIds,
      mirrorAllowAll,
      canAccess,
      isReadOnly,
    };
  }, [
    homeClientId,
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
    setActiveMirrorOwnerClientId,
    setTenantId,
    switchContext,
    contextSwitching,
    contextSwitchKey,
    contextAbortSignal,
    mirrorModeEnabled,
    mirrorContextMode,
    permissionContext,
    permissionError,
    permissionLoaded,
    permissionLoading,
    permissionTenantMatches,
    retryPermissions,
    permissionOwnerClientId,
    accessScopeLoaded,
    allowedClientIds,
    allowedMirrorOwnerIds,
    mirrorAllowAll,
    apiUnavailable,
  ]);

  const permissionsReadyFlag = value.permissionsReady;

  useEffect(() => {
    if (!user || !token) {
      if (permissionError) setPermissionError(null);
      return;
    }
    if (permissionsReadyFlag) {
      if (permissionError) setPermissionError(null);
      if (permissionTimeoutRef.current.count) {
        permissionTimeoutRef.current = { count: 0, ts: 0 };
      }
      return;
    }
    if (loading || initialising || contextSwitching) return;
    if (permissionLoading) return;
    if (permissionError) return;
    if (!permissionAttemptRef.current) return;
    const timeoutError = buildBootError(
      "permissions",
      createTimeoutError("permissões", PERMISSION_READY_TIMEOUT_MS),
    );
    const timer = setTimeout(() => {
      if (!permissionsReadyFlag) {
        if (permissionTimeoutRef.current.count < 1) {
          permissionTimeoutRef.current = {
            count: permissionTimeoutRef.current.count + 1,
            ts: Date.now(),
          };
          retryPermissions?.("auto-timeout");
          return;
        }
        setPermissionError(timeoutError);
        logBoot(
          "boot:permissions timeout",
          {
            tenantId: tenantId ?? null,
            mirrorOwnerClientId: activeMirrorOwnerClientId ?? null,
            mirrorContextMode: mirrorContextMode ?? null,
            attempts: permissionTimeoutRef.current.count + 1,
          },
          "warn",
        );
      }
    }, PERMISSION_READY_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [
    activeMirrorOwnerClientId,
    buildBootError,
    contextSwitching,
    initialising,
    loading,
    logBoot,
    mirrorContextMode,
    permissionError,
    permissionLoading,
    permissionsReadyFlag,
    retryPermissions,
    tenantId,
    token,
    user,
  ]);

  return <TenantContext.Provider value={value}>{children}</TenantContext.Provider>;
}

export function useTenant() {
  const isTestEnv = typeof process !== "undefined" && process.env?.NODE_ENV === "test";
  if (isTestEnv && globalThis.__tenantOverride) {
    return globalThis.__tenantOverride;
  }
  const ctx = useContext(TenantContext);
  if (!ctx) {
    throw new Error("useTenant deve ser usado dentro de TenantProvider");
  }
  return ctx;
}
