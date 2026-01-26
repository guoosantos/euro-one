import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useTranslation } from "../i18n.js";
import { useTenant } from "../tenant-context.jsx";
import { CoreApi } from "../coreApi.js";

export default function useTasks(params = {}, { enabled = true } = {}) {
  const { tenantId } = useTenant();
  const { t } = useTranslation();

  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);

  // 🔥 Memo verdadeiro — não muda enquanto valores internos não mudarem
  const resolvedParams = useMemo(() => {
    const p = { ...params };
    if (tenantId) p.clientId = tenantId;
    return p;
  }, [tenantId, params.clientId, params.status, params.vehicleId, params.driverId, params.from, params.to, params.type]);

  // Guardar última hash estável para não ficar disparando effect
  const lastHashRef = useRef("");
  const currentHash = useMemo(() => {
    try {
      return JSON.stringify({ ...resolvedParams, reloadKey });
    } catch {
      return "";
    }
  }, [reloadKey, resolvedParams]);

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

    if (!resolvedParams.clientId) {
      setTasks([]);
      setError(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    CoreApi.listTasks(resolvedParams)
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
  }, [currentHash, enabled, shouldRun, t, resolvedParams.clientId]);

  const reload = useCallback(() => {
    setReloadKey((current) => current + 1);
  }, []);

  return { tasks, loading, error, reload };
}
