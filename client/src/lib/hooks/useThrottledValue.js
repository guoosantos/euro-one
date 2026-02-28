import { useEffect, useRef, useState } from "react";

export default function useThrottledValue(value, waitMs = 150) {
  const [throttledValue, setThrottledValue] = useState(value);
  const stateRef = useRef({
    timeoutId: null,
    lastCommitAt: 0,
    pendingValue: value,
  });

  useEffect(() => {
    const now = Date.now();
    const wait = Math.max(0, Number(waitMs) || 0);
    const elapsed = now - stateRef.current.lastCommitAt;

    stateRef.current.pendingValue = value;

    if (wait === 0 || elapsed >= wait) {
      if (stateRef.current.timeoutId) {
        clearTimeout(stateRef.current.timeoutId);
        stateRef.current.timeoutId = null;
      }
      stateRef.current.lastCommitAt = now;
      setThrottledValue(value);
      return undefined;
    }

    if (stateRef.current.timeoutId) return undefined;

    stateRef.current.timeoutId = setTimeout(() => {
      stateRef.current.timeoutId = null;
      stateRef.current.lastCommitAt = Date.now();
      setThrottledValue(stateRef.current.pendingValue);
    }, wait - elapsed);

    return undefined;
  }, [value, waitMs]);

  useEffect(() => () => {
    if (stateRef.current.timeoutId) {
      clearTimeout(stateRef.current.timeoutId);
      stateRef.current.timeoutId = null;
    }
  }, []);

  return throttledValue;
}
