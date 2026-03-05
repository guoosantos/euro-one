import { useCallback, useEffect, useState } from "react";

import { fetchRuntimeVersion } from "../runtime-version.js";

export default function useRuntimeVersion() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const payload = await fetchRuntimeVersion();
      setData(payload);
      return payload;
    } catch (requestError) {
      setError(requestError);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    refresh().then((payload) => {
      if (!active) return;
      if (payload) return;
      setData((current) => current || null);
    });
    return () => {
      active = false;
    };
  }, [refresh]);

  return { data, loading, error, refresh };
}

