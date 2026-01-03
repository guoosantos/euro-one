import { useCallback, useState } from "react";
import safeApi from "../safe-api.js";
import API_ROUTES from "../api-routes.js";

function normalizePositionsPayload(payload) {
  if (!payload) return { positions: [], meta: null };
  const data = Array.isArray(payload?.data) ? payload.data : Array.isArray(payload?.positions) ? payload.positions : [];
  return {
    positions: data,
    meta: payload?.meta || payload?.__meta || null,
  };
}

export default function usePositionsReport() {
  const [data, setData] = useState({ positions: [], meta: null });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const generate = useCallback(async (params) => {
    setLoading(true);
    setError(null);
    try {
      const { data: payload, error: requestError } = await safeApi.get(API_ROUTES.reports.positions, { params });
      if (requestError) throw requestError;
      const normalized = normalizePositionsPayload(payload);
      setData(normalized);
      return normalized;
    } catch (requestError) {
      setError(requestError);
      throw requestError;
    } finally {
      setLoading(false);
    }
  }, []);

  const exportPdf = useCallback(async (payload) => {
    const { data, error: requestError } = await safeApi.post(API_ROUTES.reports.positionsPdf, payload, {
      responseType: "blob",
    });
    if (requestError) throw requestError;
    return data;
  }, []);

  return { data, loading, error, generate, exportPdf };
}
