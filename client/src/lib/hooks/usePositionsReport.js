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

async function resolveBlobErrorMessage(error) {
  const blob = error?.response?.data;
  if (!blob || typeof blob?.text !== "function") return null;
  try {
    const text = await blob.text();
    if (!text) return null;
    try {
      const parsed = JSON.parse(text);
      return parsed?.message || parsed?.error?.message || null;
    } catch (_parseError) {
      return text;
    }
  } catch (_error) {
    return null;
  }
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
    const { data, error: requestError, aborted, status, response } = await safeApi.post(
      API_ROUTES.reports.positionsPdf,
      payload,
      {
        responseType: "blob",
        timeout: 120_000,
      },
    );

    if (aborted) {
      const abortError = new Error("Tempo excedido ao exportar PDF. Tente novamente.");
      abortError.name = "TimeoutError";
      abortError.status = status ?? null;
      abortError.aborted = true;
      abortError.response = response || null;
      throw abortError;
    }

    if (requestError) {
      const parsedMessage = await resolveBlobErrorMessage(requestError);
      const friendlyError = new Error(parsedMessage || requestError?.message || "Falha ao exportar PDF.");
      if (requestError?.status) friendlyError.status = requestError.status;
      friendlyError.response = requestError?.response;
      throw friendlyError;
    }

    if (!(data instanceof Blob) || data.size === 0) {
      const invalidError = new Error("PDF não disponível no momento. Tente novamente em instantes.");
      invalidError.response = response || null;
      invalidError.status = status ?? null;
      throw invalidError;
    }

    return data;
  }, []);

  return { data, loading, error, generate, exportPdf };
}
