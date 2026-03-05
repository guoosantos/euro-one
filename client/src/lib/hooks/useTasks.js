import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useTranslation } from "../i18n.js";
import { useTenant } from "../tenant-context.jsx";
import { CoreApi } from "../coreApi.js";
import { resolveMirrorClientParams } from "../mirror-params.js";

export default function useTasks(params = {}, { enabled = true, tenantIdOverride } = {}) {
  const {
    tenantId: contextTenantId,
    mirrorContextMode,
    activeMirrorOwnerClientId,
  } = useTenant();
  const { t } = useTranslation();

  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);

  const resolvedTenantId = tenantIdOverride !== undefined ? tenantIdOverride : contextTenantId;
  const mirrorOwnerClientId = activeMirrorOwnerClientId ?? null;
  const resolvedParams = useMemo(
    () =>
      resolveMirrorClientParams({
        params,
        tenantId: resolvedTenantId,
        mirrorContextMode,
        mirrorOwnerClientId,
      }) || {},
    [
      mirrorContextMode,
      mirrorOwnerClientId,
      params.clientId,
      params.status,
      params.vehicleId,
      params.driverId,
      params.from,
      params.to,
      params.type,
      resolvedTenantId,
    ],
  );

  // Guardar última hash estável para não ficar disparando effect
  const lastHashRef = useRef("");
  const currentHash = useMemo(() => {
    try {
      return JSON.stringify({ ...resolvedParams, reloadKey, mirrorOwnerClientId, mirrorContextMode });
    } catch {
      return "";
    }
  }, [mirrorContextMode, mirrorOwnerClientId, reloadKey, resolvedParams]);

  const shouldRun = lastHashRef.current !== currentHash;

  useEffect(() => {
    if (!enabled) {
      setTasks([]);
      setError(null);
      setLoading(false);
      return;
    }
    if (!shouldRun) return;

    lastHashRef.current = currentHash;

    let cancelled = false;

    setLoading(true);
    setError(null);

    CoreApi.listTasks({ params: resolvedParams })
      .then((data) => {
        if (cancelled) return;
        const list =
          Array.isArray(data?.tasks)
            ? data.tasks
            : Array.isArray(data)
            ? data
            : [];
        setTasks(list);
      })
      .catch((err) => {
        if (cancelled) return;
        const status = err?.response?.status ?? err?.status;
        if (status === 403) {
          setTasks([]);
          setError(null);
          return;
        }
        console.error("[tasks] Falha ao carregar tasks", {
          endpoint: "/core/tasks",
          params: resolvedParams,
          status,
          error: err,
        });
        const friendly =
          err?.response?.data?.message ||
          err?.message ||
          t("errors.loadTasks");
        const normalizedError = new Error(friendly);
        normalizedError.status = status;
        setTasks([]);
        setError(normalizedError);
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [
    currentHash,
    enabled,
    mirrorContextMode,
    mirrorOwnerClientId,
    shouldRun,
    t,
    resolvedParams.clientId,
  ]);

  const reload = useCallback(() => {
    setReloadKey((current) => current + 1);
  }, []);

  return { tasks, loading, error, reload };
}
