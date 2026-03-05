import { useCallback, useEffect, useRef, useState } from "react";

import { API_ROUTES } from "../api-routes.js";
import safeApi from "../safe-api.js";
import { useTenant } from "../tenant-context.jsx";

const DEFAULT_COLOR = "#3b82f6";

function normalizeConfig(value) {
  const normalized = String(value || "").toLowerCase();
  if (["entrada", "entry", "enter", "in"].includes(normalized)) return "entry";
  if (["saida", "saída", "exit", "out"].includes(normalized)) return "exit";
  return null;
}

function normalizeAction(value) {
  const normalized = String(value || "").toLowerCase();
  if (["bloquear", "block", "lock"].includes(normalized)) return "block";
  if (["desbloquear", "unblock", "unlock"].includes(normalized)) return "unblock";
  return null;
}

function normalizeTargetActions(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (typeof value === "string") {
    return value
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
  }
  return null;
}

function normalisePoint(raw) {
  if (!raw) return null;
  if (Array.isArray(raw) && raw.length >= 2) {
    const [lat, lng] = raw;
    if (Number.isFinite(Number(lat)) && Number.isFinite(Number(lng))) {
      return [Number(lat), Number(lng)];
    }
  }
  if (typeof raw === "object") {
    const lat = raw.lat ?? raw.latitude ?? raw[0];
    const lng = raw.lng ?? raw.lon ?? raw.longitude ?? raw[1];
    if (Number.isFinite(Number(lat)) && Number.isFinite(Number(lng))) {
      return [Number(lat), Number(lng)];
    }
  }
  return null;
}

function normalisePoints(list) {
  if (!Array.isArray(list)) return [];
  return list
    .map((item) => normalisePoint(item))
    .filter((point) => Array.isArray(point) && point.length === 2);
}

function normaliseGeofence(item) {
  if (!item) return null;
  const type = String(item.type || item.shapeType || "polygon").toLowerCase();
  const rawPoints = Array.isArray(item.points)
    ? item.points
    : Array.isArray(item.coordinates)
      ? item.coordinates
      : null;
  const points = rawPoints || normalisePoints(item.points || item.coordinates || item.area || []);
  const center = normalisePoint(item.center || [item.latitude, item.longitude]) || points[0] || null;
  const radiusValue = item.radius ?? item.area ?? null;
  const radius = radiusValue === null || radiusValue === undefined ? null : Number(radiusValue);
  const metadata =
    item?.geometryJson?.metadata ||
    item?.geometryJson?.meta ||
    item?.metadata ||
    item?.attributes ||
    item?.attributes?.metadata ||
    {};
  const config = normalizeConfig(metadata.config ?? metadata.configuration ?? metadata.entryExit ?? metadata.trigger);
  const action = normalizeAction(metadata.action ?? metadata.geofenceAction ?? metadata.blockAction);
  const targetActions = normalizeTargetActions(metadata.targetActions ?? metadata.actions);

  return {
    id: item.id ? String(item.id) : null,
    clientId: item.clientId || null,
    name: item.name || "Geofence",
    description: item.description || "",
    type,
    color: item.color || DEFAULT_COLOR,
    isTarget: Boolean(item?.isTarget ?? item?.attributes?.isTarget),
    config,
    action,
    targetActions,
    points,
    center,
    radius: Number.isFinite(radius) ? radius : null,
    geometryJson: item?.geometryJson || null,
    raw: item,
  };
}

function extractGeofenceList(payload) {
  if (Array.isArray(payload?.geofences)) return payload.geofences;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload)) return payload;
  return [];
}

async function normaliseGeofencesAsync(list, { chunkSize = 300, isCancelled } = {}) {
  const raw = Array.isArray(list) ? list : [];
  if (raw.length === 0) return [];
  const effectiveChunkSize = raw.length > 2000 ? Math.max(100, Math.round(chunkSize / 3)) : chunkSize;
  if (raw.length <= effectiveChunkSize) {
    return raw.map((item) => normaliseGeofence(item)).filter(Boolean);
  }
  const normalised = [];
  const yieldFrame = () =>
    new Promise((resolve) => {
      if (typeof requestAnimationFrame === "function") {
        requestAnimationFrame(() => resolve());
      } else {
        setTimeout(resolve, 0);
      }
    });
  for (let index = 0; index < raw.length; index += effectiveChunkSize) {
    if (isCancelled?.()) return [];
    const slice = raw.slice(index, index + effectiveChunkSize);
    slice.forEach((item) => {
      const parsed = normaliseGeofence(item);
      if (parsed) normalised.push(parsed);
    });
    if (index + effectiveChunkSize < raw.length) {
      await yieldFrame();
    }
  }
  return normalised;
}

export function useGeofences({
  autoRefreshMs = 60_000,
  enabled = true,
  clientId,
  clientIds,
  params,
  headers,
  resolveHeadersForClient,
  skipMirrorClient = false,
} = {}) {
  const { tenantId, user } = useTenant();
  const resolvedClientId = clientId !== undefined ? clientId : tenantId;
  const resolvedClientIds = Array.isArray(clientIds)
    ? clientIds.map((value) => String(value)).filter(Boolean)
    : null;
  const [geofences, setGeofences] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [version, setVersion] = useState(0);
  const [autoRefreshPaused, setAutoRefreshPaused] = useState(false);
  const hasNotifiedError = useRef(false);

  useEffect(() => {
    let cancelled = false;
    let timer;

    if (!enabled) {
      setLoading(false);
      setError(null);
      setGeofences([]);
      return () => {
        cancelled = true;
        if (timer) clearTimeout(timer);
      };
    }

    async function fetchGeofences() {
      setLoading(true);
      setError(null);
      if (resolvedClientIds && resolvedClientIds.length > 0) {
        const responses = await Promise.all(
          resolvedClientIds.map((targetClientId) =>
            safeApi.get(API_ROUTES.geofences, {
              params: { ...(params || {}), clientId: targetClientId },
              headers: resolveHeadersForClient ? resolveHeadersForClient(targetClientId) : headers,
              skipMirrorClient,
            }),
          ),
        );
        if (cancelled) return;
        const mergedRaw = [];
        let forbiddenCount = 0;
        let errorSample = null;
        responses.forEach((result, index) => {
          if (result?.aborted) return;
          if (result?.forbidden || result?.status === 403) {
            forbiddenCount += 1;
            return;
          }
          if (result?.error) {
            if (!errorSample) errorSample = result.error;
            return;
          }
          const list = extractGeofenceList(result?.data);
          const ownerId = resolvedClientIds[index];
          list.forEach((item) => {
            if (ownerId && item && !item.clientId) {
              item.clientId = ownerId;
            }
          });
          mergedRaw.push(...list);
        });

        if (mergedRaw.length === 0 && forbiddenCount === responses.length) {
          const friendly = new Error("Sem acesso às cercas deste cliente.");
          friendly.status = 403;
          friendly.permanent = true;
          setError(friendly);
          setGeofences([]);
          setLoading(false);
          setAutoRefreshPaused(true);
          hasNotifiedError.current = true;
          return;
        }

        if (mergedRaw.length === 0 && errorSample) {
          const friendly = new Error(
            errorSample?.message || "Não foi possível carregar cercas. Verifique o tenant ou tente novamente.",
          );
          if (errorSample?.status) {
            friendly.status = errorSample.status;
          }
          setError(friendly);
          setGeofences([]);
          setLoading(false);
          setAutoRefreshPaused(true);
          return;
        }

        hasNotifiedError.current = false;
        setAutoRefreshPaused(false);
        setError(null);
        const merged = await normaliseGeofencesAsync(mergedRaw, {
          chunkSize: 300,
          isCancelled: () => cancelled,
        });
        if (cancelled) return;
        setGeofences(merged);
        setLoading(false);
        if (!cancelled && autoRefreshMs && !autoRefreshPaused) {
          timer = setTimeout(fetchGeofences, autoRefreshMs);
        }
        return;
      }

      const requestParams = {
        ...(params || {}),
        ...(resolvedClientId ? { clientId: resolvedClientId } : {}),
      };
      const { data, error: requestError, aborted, status, forbidden } = await safeApi.get(API_ROUTES.geofences, {
        params: Object.keys(requestParams).length ? requestParams : undefined,
        headers,
        skipMirrorClient,
      });
      if (aborted || cancelled) return;

      let shouldPause = false;

      if (forbidden || status === 403) {
        const friendly = new Error("Sem acesso às cercas deste cliente.");
        friendly.status = 403;
        friendly.permanent = true;
        setError(friendly);
        setGeofences([]);
        setLoading(false);
        setAutoRefreshPaused(true);
        hasNotifiedError.current = true;
        return;
      }

      if (requestError) {
        const friendly = new Error(
          requestError?.message || "Não foi possível carregar cercas. Verifique o tenant ou tente novamente.",
        );
        if (status) {
          friendly.status = status;
        }
        if (status && status >= 400 && status < 500) {
          friendly.permanent = true;
        }
        setError(friendly);
        setGeofences([]);
        if ((status && status >= 500) || friendly.permanent) {
          shouldPause = true;
          setAutoRefreshPaused(true);
          if (!hasNotifiedError.current && typeof window !== "undefined" && status !== 403) {
            window.alert(friendly.message);
          }
          hasNotifiedError.current = true;
        }
      } else {
        hasNotifiedError.current = false;
        setAutoRefreshPaused(false);
        setError(null);
        const rawList = extractGeofenceList(data);
        const nextClientId = data?.clientId ?? resolvedClientId ?? tenantId ?? user?.clientId ?? null;
        rawList.forEach((item) => {
          if (nextClientId && item && !item.clientId) {
            item.clientId = nextClientId;
          }
        });
        const list = await normaliseGeofencesAsync(rawList, {
          chunkSize: 300,
          isCancelled: () => cancelled,
        });
        if (cancelled) return;
        setGeofences(list);
      }

      setLoading(false);
      if (!cancelled && autoRefreshMs && !autoRefreshPaused && !shouldPause) {
        timer = setTimeout(fetchGeofences, autoRefreshMs);
      }
    }

    fetchGeofences();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [
    autoRefreshMs,
    autoRefreshPaused,
    enabled,
    headers,
    params,
    resolveHeadersForClient,
    resolvedClientId,
    resolvedClientIds,
    skipMirrorClient,
    version,
  ]);

  const refresh = useCallback(() => {
    setAutoRefreshPaused(false);
    hasNotifiedError.current = false;
    setVersion((value) => value + 1);
  }, []);

  const createGeofence = useCallback(
    async (payload) => {
      const targetClientId = payload?.clientId ?? resolvedClientId ?? tenantId ?? user?.clientId ?? null;
      const { data, error, aborted } = await safeApi.post(
        API_ROUTES.geofences,
        {
          ...payload,
          clientId: targetClientId,
        },
        { headers: resolveHeadersForClient ? resolveHeadersForClient(targetClientId) : headers, skipMirrorClient },
      );
      if (aborted) return null;
      if (error) throw error;
      refresh();
      return data?.geofence ?? data ?? null;
    },
    [headers, refresh, resolveHeadersForClient, resolvedClientId, skipMirrorClient, tenantId, user?.clientId],
  );

  const updateGeofence = useCallback(
    async (id, payload) => {
      const targetClientId = payload?.clientId ?? resolvedClientId ?? tenantId ?? user?.clientId ?? null;
      const { data, error, aborted } = await safeApi.put(
        `${API_ROUTES.geofences}/${id}`,
        {
          ...payload,
          clientId: targetClientId,
        },
        { headers: resolveHeadersForClient ? resolveHeadersForClient(targetClientId) : headers, skipMirrorClient },
      );
      if (aborted) return null;
      if (error) throw error;
      refresh();
      return data?.geofence ?? data ?? null;
    },
    [headers, refresh, resolveHeadersForClient, resolvedClientId, skipMirrorClient, tenantId, user?.clientId],
  );

  const deleteGeofence = useCallback(
    async (id) => {
      const targetClientId = resolvedClientId ?? tenantId ?? user?.clientId ?? null;
      const { error, aborted } = await safeApi.delete(`${API_ROUTES.geofences}/${id}`, {
        params: targetClientId ? { clientId: targetClientId } : undefined,
        headers: resolveHeadersForClient ? resolveHeadersForClient(targetClientId) : headers,
        skipMirrorClient,
      });
      if (aborted) return;
      if (error) throw error;
      refresh();
    },
    [headers, refresh, resolveHeadersForClient, resolvedClientId, skipMirrorClient, tenantId, user?.clientId],
  );

  const assignToDevice = useCallback(
    async ({ geofenceId, deviceId, groupId }) => {
      const payload = {
        geofenceId,
        ...(deviceId ? { deviceId } : {}),
        ...(groupId ? { groupId } : {}),
      };
      const { data, error, aborted } = await safeApi.post("permissions", payload);
      if (aborted) return null;
      if (error) throw error;
      refresh();
      return data ?? null;
    },
    [refresh],
  );

  return {
    geofences,
    loading,
    error,
    refresh,
    createGeofence,
    updateGeofence,
    deleteGeofence,
    assignToDevice,
  };
}

export default useGeofences;
