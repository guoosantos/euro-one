import { useCallback, useEffect, useState } from "react";

import { CoreApi } from "../coreApi.js";
import { useTenant } from "../tenant-context.jsx";
import { useTranslation } from "../i18n.js";

function normaliseTag(tag) {
  if (!tag) return null;
  return {
    id: String(tag.id || ""),
    name: tag.name || String(tag.id || ""),
    color: tag.color || null,
  };
}

export default function useCrmTags() {
  const { tenantId } = useTenant();
  const { t } = useTranslation();
  const [tags, setTags] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    CoreApi.listCrmTags({ clientId: tenantId })
      .then((data) => {
        if (cancelled) return;
        const list = Array.isArray(data?.tags) ? data.tags : Array.isArray(data) ? data : [];
        setTags(list.map(normaliseTag).filter(Boolean));
      })
      .catch((err) => {
        if (cancelled) return;
        const friendly = err?.response?.data?.message || t("errors.loadTags") || "Erro ao carregar tags";
        setError(new Error(friendly));
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tenantId, t]);

  useEffect(() => {
    const cancel = load();
    return cancel;
  }, [load]);

  const createTag = useCallback(
    async (payload) => {
      const response = await CoreApi.createCrmTag({ ...payload, clientId: tenantId });
      const created = normaliseTag(response?.tag || response);
      if (!created) return null;
      setTags((prev) => {
        const existingIds = new Set(prev.map((tag) => tag.id));
        if (existingIds.has(created.id)) return prev;
        return [...prev, created];
      });
      return created;
    },
    [tenantId],
  );

  const deleteTag = useCallback(async (id) => {
    await CoreApi.deleteCrmTag(id);
    setTags((prev) => prev.filter((tag) => tag.id !== id));
  }, []);

  return { tags, loading, error, refresh: load, createTag, deleteTag };
}
