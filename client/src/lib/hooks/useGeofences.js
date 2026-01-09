import { useCallback, useEffect, useRef, useState } from "react";

import { API_ROUTES } from "../api-routes.js";
import { approximateCirclePoints } from "../kml.js";
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
  const points = normalisePoints(item.points || item.coordinates || item.area || []);
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

  const coordinates =
    type === "circle" && center && Number.isFinite(radius) && radius > 0
      ? approximateCirclePoints(center, radius, 48)
      : points;

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
    coordinates,
    geometryJson: item?.geometryJson || null,
    raw: item,
  };
}

function normaliseGeofences(payload) {
  const list = Array.isArray(payload?.geofences)
    ? payload.geofences
    : Array.isArray(payload?.data)
      ? payload.data
      : Array.isArray(payload)
        ? payload
        : [];
  return list.map((item) => normaliseGeofence(item)).filter(Boolean);
}

export function useGeofences({ autoRefreshMs = 60_000 } = {}) {
  const { tenantId, user } = useTenant();
  const [geofences, setGeofences] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [version, setVersion] = useState(0);
  const [autoRefreshPaused, setAutoRefreshPaused] = useState(false);
  const hasNotifiedError = useRef(false);

  useEffect(() => {
    let cancelled = false;
    let timer;

    async function fetchGeofences() {
      setLoading(true);
      setError(null);
      const { data, error: requestError, aborted, status } = await safeApi.get(API_ROUTES.geofences, {
        params: tenantId ? { clientId: tenantId } : undefined,
      });
      if (aborted || cancelled) return;

      let shouldPause = false;

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
          if (!hasNotifiedError.current && typeof window !== "undefined") {
            window.alert(friendly.message);
          }
          hasNotifiedError.current = true;
        }
      } else {
        hasNotifiedError.current = false;
        setAutoRefreshPaused(false);
        setError(null);
        setGeofences(normaliseGeofences(data));
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
  }, [autoRefreshMs, tenantId, version, autoRefreshPaused]);

  const refresh = useCallback(() => {
    setAutoRefreshPaused(false);
    hasNotifiedError.current = false;
    setVersion((value) => value + 1);
  }, []);

  const createGeofence = useCallback(
    async (payload) => {
      const { data, error, aborted } = await safeApi.post(API_ROUTES.geofences, {
        ...payload,
        clientId: payload?.clientId ?? tenantId ?? user?.clientId ?? null,
      });
      if (aborted) return null;
      if (error) throw error;
      refresh();
      return data?.geofence ?? data ?? null;
    },
    [refresh, tenantId, user?.clientId],
  );

  const updateGeofence = useCallback(
    async (id, payload) => {
      const { data, error, aborted } = await safeApi.put(`${API_ROUTES.geofences}/${id}`, {
        ...payload,
        clientId: payload?.clientId ?? tenantId ?? user?.clientId ?? null,
      });
      if (aborted) return null;
      if (error) throw error;
      refresh();
      return data?.geofence ?? data ?? null;
    },
    [refresh, tenantId, user?.clientId],
  );

  const deleteGeofence = useCallback(
    async (id) => {
      const { error, aborted } = await safeApi.delete(`${API_ROUTES.geofences}/${id}`);
      if (aborted) return;
      if (error) throw error;
      refresh();
    },
    [refresh],
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
