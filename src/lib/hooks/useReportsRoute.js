import { useCallback, useState } from "react";
import api from "../api.js";
import { API_ROUTES } from "../api-routes.js";

export function useReportsRoute() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const generate = useCallback(async (params) => {
    setLoading(true);
    setError(null);
    try {
      const response = await api.get(API_ROUTES.reports.route, { params });
      setData(response?.data ?? null);
      return response?.data ?? null;
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError : new Error("Erro ao gerar relatório de rota"));
      throw requestError;
    } finally {
      setLoading(false);
    }
  }, []);

  return { data, loading, error, generate };
}

export default useReportsRoute;
