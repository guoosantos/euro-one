import { useCallback, useState } from "react";

export default function useApiMutation() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const mutate = useCallback(async (mutationFn) => {
    if (typeof mutationFn !== "function") {
      throw new Error("useApiMutation requer uma função de mutação");
    }
    setLoading(true);
    setError(null);
    try {
      return await mutationFn();
    } catch (mutationError) {
      setError(mutationError);
      throw mutationError;
    } finally {
      setLoading(false);
    }
  }, []);

  const resetError = useCallback(() => setError(null), []);

  return { mutate, loading, error, resetError };
}
