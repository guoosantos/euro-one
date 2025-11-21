import { useCallback, useEffect, useState } from "react";
import api from "../api.js";
import { API_ROUTES } from "../api-routes.js";

export function useReports() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [data, setData] = useState(null);

  const persistData = useCallback((value) => {
    setData(value);
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem("reports:trips:last", JSON.stringify(value));
    } catch (_error) {
      // Ignore persistence failures
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const cached = window.localStorage.getItem("reports:trips:last");
      if (cached) {
        setData(JSON.parse(cached));
      }
    } catch (_error) {
      // Ignore hydration failures
    }
  }, []);

  const generateTripsReport = useCallback(async ({ deviceId, from, to, type = "all" }) => {
    setLoading(true);
    setError(null);
    try {
      const payload = { deviceId, from, to, type };
      const response = await api.post(API_ROUTES.reports.trips, payload);
      const enriched =
        response?.data && typeof response.data === "object"
          ? { ...response.data, __meta: { generatedAt: new Date().toISOString(), params: payload } }
          : response?.data ?? null;
      persistData(enriched);
      return enriched;
    } catch (requestError) {
      setError(requestError);
      throw requestError;
    } finally {
      setLoading(false);
    }
  }, [persistData]);

  const downloadTripsCsv = useCallback(async ({ deviceId, from, to, type = "all" }) => {
    const payload = { deviceId, from, to, type, format: "csv" };
    const response = await api.post(API_ROUTES.reports.trips, payload, { responseType: "blob" });
    if (typeof document === "undefined") {
      return response?.data ?? null;
    }
    const blob = response?.data instanceof Blob ? response.data : new Blob([response?.data], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `trips-${deviceId}-${from}-${to}.csv`;
    anchor.click();
    setTimeout(() => {
      URL.revokeObjectURL(url);
    }, 2000);
    return blob;
  }, []);

  return { data, loading, error, generateTripsReport, downloadTripsCsv };
}

export default useReports;
