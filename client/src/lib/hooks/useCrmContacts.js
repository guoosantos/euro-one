import { useCallback, useEffect, useMemo, useState } from "react";

import { CoreApi } from "../coreApi.js";
import { useTranslation } from "../i18n.js";

/** @typedef {import("../../features/crm/types").CrmContact} CrmContact */

export function useCrmContacts(clientId, params = null) {
  const { t } = useTranslation();
  const [contacts, setContacts] = useState(/** @type {CrmContact[]} */ ([]));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const paramsKey = useMemo(() => JSON.stringify(params || {}), [params]);
  const resolvedParams = useMemo(() => ({ ...(params || {}) }), [paramsKey]);

  const load = useCallback(() => {
    if (!clientId) {
      setContacts([]);
      return () => {};
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    CoreApi.listCrmContacts(clientId, resolvedParams)
      .then((data) => {
        if (cancelled) return;
        const list = Array.isArray(data?.contacts) ? data.contacts : Array.isArray(data) ? data : [];
        setContacts(list);
      })
      .catch((err) => {
        if (cancelled) return;
        const friendly = err?.response?.data?.message || err?.message || t("errors.loadContacts");
        setError(new Error(friendly));
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [clientId, resolvedParams, paramsKey, t]);

  useEffect(() => load(), [load]);

  const addContact = useCallback(
    async (payload) => {
      if (!clientId) throw new Error("Cliente não selecionado");
      const response = await CoreApi.addCrmContact(clientId, payload);
      const created = response?.contact || response;
      setContacts((prev) => [...prev, created]);
      return created;
    },
    [clientId],
  );

  return { contacts, loading, error, refresh: load, addContact };
}

export default useCrmContacts;
