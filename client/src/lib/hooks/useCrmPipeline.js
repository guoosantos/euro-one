import { useCallback, useEffect, useMemo, useState } from "react";

import { CoreApi } from "../coreApi.js";
import { logCrmError } from "./useCrmClients.js";

export default function useCrmPipeline(params = null) {
  const [stages, setStages] = useState([]);
  const [deals, setDeals] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const viewParams = useMemo(() => params || {}, [params]);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await CoreApi.listCrmPipeline(viewParams);
      setStages(Array.isArray(data?.stages) ? data.stages : []);
      setDeals(Array.isArray(data?.deals) ? data.deals : []);
    } catch (err) {
      logCrmError("pipeline", err);
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [viewParams]);

  const moveDeal = useCallback(
    async (dealId, stageId) => {
      if (!dealId || !stageId) return null;
      const previous = deals;
      setDeals((current) => current.map((deal) => (deal.id === dealId ? { ...deal, stageId } : deal)));
      try {
        const { deal } = await CoreApi.moveDealStage(dealId, { stageId });
        if (deal) {
          setDeals((current) => current.map((item) => (item.id === deal.id ? { ...item, ...deal } : item)));
        }
        return deal;
      } catch (err) {
        logCrmError("pipeline-move", err);
        setDeals(previous);
        setError(err);
        return null;
      }
    },
    [deals],
  );

  const createDeal = useCallback(async (payload) => {
    try {
      const { deal } = await CoreApi.createDeal(payload);
      setDeals((current) => [...current, deal]);
      return deal;
    } catch (err) {
      logCrmError("pipeline-create", err);
      setError(err);
      return null;
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return {
    stages,
    deals,
    loading,
    error,
    refresh,
    moveDeal,
    createDeal,
  };
}
