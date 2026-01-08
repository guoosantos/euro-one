import { useCallback, useState } from "react";
import safeApi from "../safe-api.js";
import API_ROUTES from "../api-routes.js";

function normalizePositionsPayload(payload) {
  if (!payload) return { positions: [], meta: null };
  const data = Array.isArray(payload?.data) ? payload.data : Array.isArray(payload?.positions) ? payload.positions : [];
  const meta = payload?.meta || payload?.__meta || null;
  return { positions: data, meta };
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

const EXPORT_POLL_INTERVAL_MS = 2000;
const EXPORT_MAX_WAIT_MS = 20 * 60 * 1000;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export default function usePositionsReport() {
  const [data, setData] = useState({ positions: [], meta: null });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const fetchPage = useCallback(async (params) => {
    const { data: payload, error: requestError } = await safeApi.get(API_ROUTES.reports.positions, { params });
    if (requestError) throw requestError;
    return normalizePositionsPayload(payload);
  }, []);

  const generate = useCallback(async (params) => {
    setLoading(true);
    setError(null);
    try {
      const normalized = await fetchPage(params);
      setData(normalized);
      return normalized;
    } catch (requestError) {
      setError(requestError);
      throw requestError;
    } finally {
      setLoading(false);
    }
  }, [fetchPage]);

  const startExportJob = useCallback(async (format, payload) => {
    const { data, error: requestError } = await safeApi.post(
      API_ROUTES.reports.positionsExport,
      { ...payload, format },
    );
    if (requestError) {
      throw requestError;
    }
    return data;
  }, []);

  const waitForExportJob = useCallback(async (jobId) => {
    const startedAt = Date.now();
    while (Date.now() - startedAt < EXPORT_MAX_WAIT_MS) {
      const { data, error: requestError } = await safeApi.get(API_ROUTES.reports.positionsExportStatus(jobId));
      if (requestError) {
        throw requestError;
      }
      if (data?.status === "ready") return data;
      if (data?.status === "error") {
        const error = new Error(data?.error?.message || "Falha ao exportar relatório.");
        error.code = data?.error?.code;
        throw error;
      }
      await delay(EXPORT_POLL_INTERVAL_MS);
    }
    const timeoutError = new Error("Tempo excedido ao exportar. Tente novamente.");
    timeoutError.name = "TimeoutError";
    throw timeoutError;
  }, []);

  const downloadExportJob = useCallback(async (jobId) => {
    const { data, error: requestError, status, response } = await safeApi.get(
      API_ROUTES.reports.positionsExportDownload(jobId),
      {
        responseType: "blob",
        timeout: 120_000,
      },
    );

    if (requestError) {
      const parsedMessage = await resolveBlobErrorMessage(requestError);
      const friendlyError = new Error(parsedMessage || requestError?.message || "Falha ao baixar exportação.");
      if (requestError?.status) friendlyError.status = requestError.status;
      friendlyError.response = requestError?.response;
      throw friendlyError;
    }

    if (!(data instanceof Blob) || data.size === 0) {
      const invalidError = new Error("Exportação não disponível no momento. Tente novamente em instantes.");
      invalidError.response = response || null;
      invalidError.status = status ?? null;
      throw invalidError;
    }

    return data;
  }, []);

  const exportWithJob = useCallback(
    async (format, payload, timeoutMessage) => {
      const start = await startExportJob(format, payload);
      const jobId = start?.jobId;
      if (!jobId) {
        throw new Error("Falha ao iniciar exportação. Tente novamente.");
      }
      try {
        await waitForExportJob(jobId);
      } catch (error) {
        if (error?.name === "TimeoutError") {
          const abortError = new Error(timeoutMessage);
          abortError.name = "TimeoutError";
          abortError.aborted = true;
          throw abortError;
        }
        throw error;
      }
      return downloadExportJob(jobId);
    },
    [downloadExportJob, startExportJob, waitForExportJob],
  );

  const exportPdf = useCallback(
    (payload) => exportWithJob("pdf", payload, "Tempo excedido ao exportar PDF. Tente novamente."),
    [exportWithJob],
  );

  const exportXlsx = useCallback(
    (payload) => exportWithJob("xlsx", payload, "Tempo excedido ao exportar Excel. Tente novamente."),
    [exportWithJob],
  );

  const exportCsv = useCallback(
    (payload) => exportWithJob("csv", payload, "Tempo excedido ao exportar CSV. Tente novamente."),
    [exportWithJob],
  );

  return { data, loading, error, generate, exportPdf, exportXlsx, exportCsv, fetchPage };
}
