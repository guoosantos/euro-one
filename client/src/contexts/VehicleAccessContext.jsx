import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { CoreApi, normaliseListPayload } from "../lib/coreApi.js";
import { useTenant } from "../lib/tenant-context.jsx";
import { resolveMirrorClientParams } from "../lib/mirror-params.js";
import { ACCESS_REASONS, normalizeAccessReason, resolveAccessReason } from "../lib/access-reasons.js";

const VehicleAccessContext = createContext({
  accessibleVehicles: [],
  accessibleVehicleIds: [],
  accessibleDeviceIds: [],
  isRestricted: false,
  reason: null,
  accessReason: null,
  loading: false,
  error: null,
  reload: () => {},
});

function extractDeviceIds(vehicles) {
  const ids = new Set();
  vehicles.forEach((vehicle) => {
    if (vehicle?.deviceId) ids.add(String(vehicle.deviceId));
    if (vehicle?.primaryDeviceId) ids.add(String(vehicle.primaryDeviceId));
    const devices = Array.isArray(vehicle?.devices) ? vehicle.devices : [];
    devices.forEach((device) => {
      const key = device?.traccarId ?? device?.id ?? device?.deviceId;
      if (key != null) ids.add(String(key));
    });
  });
  return Array.from(ids);
}

export function VehicleAccessProvider({ children }) {
  const {
    tenantId,
    isAuthenticated,
    initialising,
    loading: tenantLoading,
    mirrorContextMode,
    activeMirror,
    activeMirrorOwnerClientId,
    contextSwitching,
    contextSwitchKey,
    contextAbortSignal,
  } = useTenant();
  const [accessibleVehicles, setAccessibleVehicles] = useState([]);
  const [isRestricted, setIsRestricted] = useState(false);
  const [reason, setReason] = useState(null);
  const [accessReason, setAccessReason] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const loadSeqRef = useRef(0);
  const mirrorOwnerClientId = activeMirror?.ownerClientId ?? activeMirrorOwnerClientId;
  const loadVehicles = useCallback(async () => {
    const seq = ++loadSeqRef.current;
    if (!isAuthenticated || initialising || tenantLoading || contextSwitching) {
      if (loadSeqRef.current === seq) {
        setAccessibleVehicles([]);
        setIsRestricted(false);
        setReason(null);
        setAccessReason(null);
        setError(null);
        setLoading(false);
      }
      return;
    }
    setLoading(true);
    setError(null);
    setReason(null);
    setAccessReason(null);
    try {
      const params = resolveMirrorClientParams({ tenantId, mirrorContextMode, mirrorOwnerClientId }) || {};
      const payload = await CoreApi.listAccessibleVehicles(params, {
        signal: contextAbortSignal,
      });
      const vehicles = normaliseListPayload(payload);
      const restricted = Boolean(payload?.meta?.restricted);
      const nextReason = normalizeAccessReason(payload?.reason);
      if (loadSeqRef.current !== seq) return;
      setAccessibleVehicles(vehicles);
      setIsRestricted(restricted);
      setReason(nextReason && vehicles.length === 0 ? nextReason : null);
    } catch (requestError) {
      if (loadSeqRef.current !== seq) return;
      if (requestError?.name === "AbortError" || requestError?.code === "ERR_CANCELED") {
        return;
      }
      const status = requestError?.status || requestError?.response?.status;
      const resolvedReason = resolveAccessReason(requestError);
      if (status === 403) {
        setAccessReason(resolvedReason || ACCESS_REASONS.FORBIDDEN_SCOPE);
      }
      setError(requestError instanceof Error ? requestError : new Error("Falha ao carregar veículos acessíveis"));
    } finally {
      if (loadSeqRef.current === seq) setLoading(false);
    }
  }, [
    contextAbortSignal,
    contextSwitching,
    initialising,
    isAuthenticated,
    mirrorContextMode,
    mirrorOwnerClientId,
    tenantId,
    tenantLoading,
  ]);

  useEffect(() => {
    loadVehicles().catch(() => {});
  }, [loadVehicles, contextSwitchKey]);

  const accessibleVehicleIds = useMemo(
    () => accessibleVehicles.map((vehicle) => String(vehicle.id)).filter(Boolean),
    [accessibleVehicles],
  );
  const accessibleDeviceIds = useMemo(() => extractDeviceIds(accessibleVehicles), [accessibleVehicles]);

  const value = useMemo(
    () => ({
      accessibleVehicles,
      accessibleVehicleIds,
      accessibleDeviceIds,
      isRestricted,
      reason,
      accessReason,
      loading,
      error,
      reload: loadVehicles,
    }),
    [
      accessibleVehicles,
      accessibleVehicleIds,
      accessibleDeviceIds,
      isRestricted,
      reason,
      accessReason,
      loading,
      error,
      loadVehicles,
    ],
  );

  return <VehicleAccessContext.Provider value={value}>{children}</VehicleAccessContext.Provider>;
}

export function useVehicleAccess() {
  return useContext(VehicleAccessContext);
}

export default VehicleAccessContext;
