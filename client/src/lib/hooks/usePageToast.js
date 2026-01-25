import { useCallback, useEffect, useRef, useState } from "react";

export function usePageToast(timeoutMs = 3500) {
  const [toast, setToast] = useState(null);
  const timerRef = useRef(null);

  const clearToast = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setToast(null);
  }, []);

  const showToast = useCallback(
    (message, type = "success") => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
      setToast({ message, type });
      timerRef.current = setTimeout(() => setToast(null), timeoutMs);
    },
    [timeoutMs],
  );

  useEffect(() => () => clearToast(), [clearToast]);

  return { toast, showToast, clearToast };
}

export default usePageToast;
