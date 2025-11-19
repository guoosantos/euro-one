import { useEffect, useState } from "react";

import { CoreApi } from "../coreApi.js";

export default function useTasks(params = {}) {
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    CoreApi.listTasks(params)
      .then((data) => {
        if (cancelled) return;
        const list = Array.isArray(data?.tasks) ? data.tasks : Array.isArray(data) ? data : [];
        setTasks(list);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err);
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [JSON.stringify(params)]);

  return { tasks, loading, error };
}
