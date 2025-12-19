import { useCallback, useEffect, useState } from "react";

import { API_ROUTES } from "../api-routes.js";
import safeApi from "../safe-api.js";
import { useTenant } from "../tenant-context.jsx";

export function useTrackerMappings() {
  const { tenantId, role } = useTenant();
  const [devices, setDevices] = useState([]);
  const [telemetryMappings, setTelemetryMappings] = useState([]);
  const [eventMappings, setEventMappings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const canManage = role === "admin";

  const loadDevices = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: requestError } = await safeApi.get(API_ROUTES.tracker.devices, {
      params: tenantId ? { clientId: tenantId } : undefined,
    });
    if (requestError) {
      setError(requestError);
      setDevices([]);
    } else {
      setDevices(Array.isArray(data?.devices) ? data.devices : []);
    }
    setLoading(false);
  }, [tenantId]);

  const loadMappings = useCallback(
    async (params = {}) => {
      setLoading(true);
      setError(null);
      const { data, error: requestError } = await safeApi.get(API_ROUTES.tracker.mappings, {
        params: {
          ...(tenantId ? { clientId: tenantId } : {}),
          ...(params.deviceId ? { deviceId: params.deviceId } : {}),
          ...(params.protocol ? { protocol: params.protocol } : {}),
        },
      });
      if (requestError) {
        setError(requestError);
        setTelemetryMappings([]);
        setEventMappings([]);
      } else {
        setTelemetryMappings(Array.isArray(data?.telemetry) ? data.telemetry : []);
        setEventMappings(Array.isArray(data?.events) ? data.events : []);
      }
      setLoading(false);
    },
    [tenantId],
  );

  useEffect(() => {
    if (!canManage) return;
    loadDevices();
    loadMappings();
  }, [canManage, loadDevices, loadMappings]);

  const saveTelemetryMapping = useCallback(
    async (payload) => {
      const target = payload.id
        ? `${API_ROUTES.tracker.telemetryMappings}/${payload.id}`
        : API_ROUTES.tracker.telemetryMappings;
      const method = payload.id ? "put" : "post";
      const body = { ...payload, clientId: payload.clientId || tenantId };
      const { data, error: requestError } = await safeApi[method](target, body);
      if (requestError) throw requestError;
      await loadMappings({ deviceId: payload.deviceId, protocol: payload.protocol });
      return data?.mapping || null;
    },
    [loadMappings, tenantId],
  );

  const saveEventMapping = useCallback(
    async (payload) => {
      const target = payload.id
        ? `${API_ROUTES.tracker.eventMappings}/${payload.id}`
        : API_ROUTES.tracker.eventMappings;
      const method = payload.id ? "put" : "post";
      const body = { ...payload, clientId: payload.clientId || tenantId };
      const { data, error: requestError } = await safeApi[method](target, body);
      if (requestError) throw requestError;
      await loadMappings({ deviceId: payload.deviceId, protocol: payload.protocol });
      return data?.mapping || null;
    },
    [loadMappings, tenantId],
  );

  const deleteMapping = useCallback(async (type, id) => {
    const endpoint = type === "event" ? API_ROUTES.tracker.eventMappings : API_ROUTES.tracker.telemetryMappings;
    await safeApi.delete(`${endpoint}/${id}`);
    await loadMappings();
  }, [loadMappings]);

  return {
    canManage,
    devices,
    telemetryMappings,
    eventMappings,
    loading,
    error,
    reload: loadMappings,
    saveTelemetryMapping,
    saveEventMapping,
    deleteMapping,
    loadDevices,
  };
}

export default useTrackerMappings;
