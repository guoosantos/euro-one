import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { CoreApi } from "../coreApi.js";
import { useTenant } from "../tenant-context.jsx";
import { useTranslation } from "../i18n.js";

/** @typedef {import("../../features/crm/types").CrmClient} CrmClient */

export function logCrmError(error, context) {
  if (!error) return;
  const label = context ? `[CRM] ${context}` : "[CRM]";
  // Log uma única vez por operação, para evitar inundar o console.
  console.error(label, error);
}

export function useCrmClients(params = {}) {
  const { tenantId } = useTenant();
  const { t } = useTranslation();
  const [clients, setClients] = useState(/** @type {CrmClient[]} */ ([]));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const requestIdRef = useRef(0);

  const paramsKey = useMemo(() => JSON.stringify(params || {}), [params]);

  const resolvedParams = useMemo(() => {
    const next = { ...(params || {}) };
    if (tenantId) next.clientId = tenantId;
    return next;
  }, [paramsKey, tenantId]);

  const load = useCallback(() => {
    const currentRequestId = ++requestIdRef.current;
    let cancelled = false;
    setLoading(true);
    setError(null);

    CoreApi.listCrmClients(resolvedParams)
      .then((data) => {
        if (cancelled || currentRequestId !== requestIdRef.current) return;
        const list = Array.isArray(data?.clients) ? data.clients : Array.isArray(data) ? data : [];
        setClients(list);
      })
      .catch((err) => {
        if (cancelled || currentRequestId !== requestIdRef.current) return;
        const friendly = err?.response?.data?.message || t("errors.loadClients") || "Não foi possível carregar clientes.";
        const normalisedError = new Error(friendly);
        setError(normalisedError);
        logCrmError(err, "listCrmClients");
      })
      .finally(() => {
        if (cancelled || currentRequestId !== requestIdRef.current) return;
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [resolvedParams, t]);

  useEffect(() => load(), [load]);

  const createClient = useCallback(
    async (payload) => {
      try {
        const response = await CoreApi.createCrmClient({ ...payload, clientId: tenantId || payload?.clientId });
        const created = response?.client || response;
        setClients((prev) => [...prev, created]);
        return created;
      } catch (error) {
        logCrmError(error, "createCrmClient");
        throw error;
      }
    },
    [tenantId],
  );

  const updateClient = useCallback(async (id, payload) => {
    try {
      const response = await CoreApi.updateCrmClient(id, payload);
      const updated = response?.client || response;
      setClients((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
      return updated;
    } catch (error) {
      logCrmError(error, "updateCrmClient");
      throw error;
    }
  }, []);

  return { clients, loading, error, refresh: load, createClient, updateClient };
}

export default useCrmClients;
