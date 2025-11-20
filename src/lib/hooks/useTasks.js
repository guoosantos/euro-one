import { useEffect, useMemo, useState } from "react";

import { useTranslation } from "../i18n.js";
import { useTenant } from "../tenant-context.jsx";
import { CoreApi } from "../coreApi.js";

export default function useTasks(params = {}) {
  const { tenantId } = useTenant();
  const { t } = useTranslation();
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const resolvedParams = useMemo(() => {
    const next = { ...params };
    if (tenantId) next.clientId = tenantId;
    return next;
  }, [params, tenantId]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    CoreApi.listTasks(resolvedParams)
      .then((data) => {
        if (cancelled) return;
        const list = Array.isArray(data?.tasks) ? data.tasks : Array.isArray(data) ? data : [];
        setTasks(list);
      })
      .catch((err) => {
        if (cancelled) return;
        const friendly = err?.response?.data?.message || err?.message || t("errors.loadTasks");
        setError(new Error(friendly));
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [JSON.stringify(resolvedParams), t]);

  return { tasks, loading, error };
}
