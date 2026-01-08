import { useCallback, useState } from "react";
import safeApi from "../safe-api.js";
import API_ROUTES from "../api-routes.js";

function normalizeAnalyticPayload(payload) {
  if (!payload) return { entries: [], positions: [], actions: [], meta: null };
  const payloadData = payload?.data ?? payload;
  const entries = Array.isArray(payloadData?.entries)
    ? payloadData.entries
    : Array.isArray(payloadData?.timeline)
      ? payloadData.timeline
      : Array.isArray(payload?.entries)
        ? payload.entries
        : [];
  const positions = Array.isArray(payloadData?.positions)
    ? payloadData.positions
    : Array.isArray(payload?.positions)
      ? payload.positions
      : [];
  const actions = Array.isArray(payloadData?.actions)
    ? payloadData.actions
    : Array.isArray(payload?.actions)
      ? payload.actions
      : [];
  const meta = payload?.meta || payloadData?.meta || payload?.__meta || null;
  return { entries, positions, actions, meta };
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

export default function useAnalyticReport() {
  const [data, setData] = useState({ entries: [], positions: [], actions: [], meta: null });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const fetchPage = useCallback(async (params) => {
    const { data: payload, error: requestError } = await safeApi.get(API_ROUTES.reports.analytic, { params });
    if (requestError) throw requestError;
    return normalizeAnalyticPayload(payload);
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
      API_ROUTES.reports.analyticExport,
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
      const { data, error: requestError } = await safeApi.get(API_ROUTES.reports.analyticExportStatus(jobId));
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
      API_ROUTES.reports.analyticExportDownload(jobId),
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

  return {
    data,
    loading,
    error,
    generate,
    fetchPage,
    exportPdf,
    exportXlsx,
    exportCsv,
  };
}
