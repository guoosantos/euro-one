import { useCallback, useEffect, useState } from "react";
import api from "../api.js";
import { API_ROUTES } from "../api-routes.js";
import { readCachedReport, writeCachedReport } from "./reportStorage.js";

const TRIPS_CACHE_KEY = "reports:trips:last";

export const normalizeTrips = (payload) => {
  if (!payload) return { trips: [] };
  const base = Array.isArray(payload)
    ? { trips: payload }
    : typeof payload === "object"
      ? { ...payload }
      : {};

  const trips = Array.isArray(base.trips)
    ? base.trips
    : Array.isArray(base.data)
      ? base.data
      : [];

  return { ...base, trips: trips.filter(Boolean) };
};

export function useReports() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [data, setData] = useState(null);

  const persistData = useCallback((value) => {
    setData(value);
    writeCachedReport(TRIPS_CACHE_KEY, value);
  }, []);

  useEffect(() => {
    const cached = readCachedReport(TRIPS_CACHE_KEY, normalizeTrips);
    if (cached) {
      persistData(cached);
    }
  }, [persistData]);

  const generateTripsReport = useCallback(async ({ deviceId, from, to, type = "all" }) => {
    setLoading(true);
    setError(null);
    try {
      const payload = { deviceId, from, to, type };
      const response = await api.post(API_ROUTES.reports.trips, payload);
      const enriched = {
        ...normalizeTrips(response?.data),
        __meta: { generatedAt: new Date().toISOString(), params: payload },
      };
      persistData(enriched);
      return enriched;
    } catch (requestError) {
      const friendlyMessage = "Não foi possível carregar as viagens. Verifique o período ou tente novamente.";
      const fallbackError =
        requestError instanceof Error ? new Error(friendlyMessage, { cause: requestError }) : new Error(friendlyMessage);
      setError(fallbackError);
      throw fallbackError;
    } finally {
      setLoading(false);
    }
  }, [normalizeTrips, persistData]);

  const downloadTripsCsv = useCallback(async ({ deviceId, from, to, type = "all" }) => {
    if (!deviceId) {
      throw new Error("Selecione um dispositivo para exportar o relatório.");
    }
    if (!from || !to) {
      throw new Error("Informe as datas de início e fim para exportar o relatório.");
    }
    const payload = { deviceId, from, to, type, format: "csv" };
    const response = await api.post(API_ROUTES.reports.trips, payload, { responseType: "blob" });
    if (typeof document === "undefined") {
      return response?.data ?? null;
    }
    const blob = response?.data instanceof Blob ? response.data : new Blob([response?.data ?? ""], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    const fromLabel = new Date(from).toISOString();
    const toLabel = new Date(to).toISOString();
    const fileDevice = String(deviceId || "device").replace(/[^a-zA-Z0-9-_]/g, "-");
    const sanitize = (value) => String(value).replace(/[:\s]/g, "-").replace(/[^a-zA-Z0-9-_.]/g, "-");
    anchor.download = `trips-${fileDevice}-${sanitize(fromLabel)}-${sanitize(toLabel)}.csv`;
    anchor.click();
    setTimeout(() => {
      URL.revokeObjectURL(url);
    }, 2000);
    return blob;
  }, []);

  return { data, loading, error, generateTripsReport, downloadTripsCsv };
}

export default useReports;
