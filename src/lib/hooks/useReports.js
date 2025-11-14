import { useCallback, useState } from "react";
import api from "../api.js";

export function useReports() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [data, setData] = useState(null);

  const generateTripsReport = useCallback(async ({ deviceId, from, to, type = "all" }) => {
    setLoading(true);
    setError(null);
    try {
      const payload = { deviceId, from, to, type };
      const response = await api.post("/reports/trips", payload);
      setData(response?.data ?? null);
      return response?.data ?? null;
    } catch (requestError) {
      setError(requestError);
      setData(null);
      throw requestError;
    } finally {
      setLoading(false);
    }
  }, []);

  const downloadTripsCsv = useCallback(async ({ deviceId, from, to, type = "all" }) => {
    const payload = { deviceId, from, to, type, format: "csv" };
    const response = await api.post("/reports/trips", payload, { responseType: "blob" });
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
