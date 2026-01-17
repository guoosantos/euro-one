import { useEffect, useMemo, useRef, useState } from "react";

import { useTranslation } from "../i18n.js";
import { useTenant } from "../tenant-context.jsx";
import { CoreApi } from "../coreApi.js";

export default function useTasks(params = {}) {
  const { tenantId } = useTenant();
  const { t } = useTranslation();

  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

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
      return JSON.stringify(resolvedParams);
    } catch {
      return "";
    }
  }, [resolvedParams]);

  const shouldRun = lastHashRef.current !== currentHash;

  useEffect(() => {
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
        console.error("[tasks] Falha ao carregar tasks", {
          params: resolvedParams,
          status: err?.response?.status ?? err?.status,
          error: err,
        });
        const friendly =
          err?.response?.data?.message ||
          err?.message ||
          t("errors.loadTasks");
        setError(new Error(friendly));
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [currentHash, shouldRun, t, resolvedParams.clientId]);

  return { tasks, loading, error };
}
