import { useCallback, useEffect, useMemo, useState } from "react";

import { CoreApi } from "../coreApi.js";
import { useTranslation } from "../i18n.js";
import { useTenant } from "../tenant-context.jsx";

/** @typedef {import("../../features/crm/types").CrmClient} CrmClient */

export function useCrmClients(params = {}) {
  const { tenantId } = useTenant();
  const { t } = useTranslation();
  const [clients, setClients] = useState(/** @type {CrmClient[]} */ ([]));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const resolvedParams = useMemo(() => {
    const next = { ...params };
    if (tenantId) next.clientId = tenantId;
    return next;
  }, [params, tenantId]);

  const load = useCallback(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    CoreApi.listCrmClients(resolvedParams)
      .then((data) => {
        if (cancelled) return;
        const list = Array.isArray(data?.clients) ? data.clients : Array.isArray(data) ? data : [];
        setClients(list);
      })
      .catch((err) => {
        if (cancelled) return;
        const friendly = err?.response?.data?.message || err?.message || t("errors.loadClients");
        setError(new Error(friendly));
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [resolvedParams, t, tenantId]);

  useEffect(() => load(), [load]);

  const createClient = useCallback(
    async (payload) => {
      const response = await CoreApi.createCrmClient({ ...payload, clientId: tenantId || payload?.clientId });
      const created = response?.client || response;
      setClients((prev) => [...prev, created]);
      return created;
    },
    [tenantId],
  );

  const updateClient = useCallback(async (id, payload) => {
    const response = await CoreApi.updateCrmClient(id, payload);
    const updated = response?.client || response;
    setClients((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
    return updated;
  }, []);

  return { clients, loading, error, refresh: load, createClient, updateClient };
}

export default useCrmClients;
