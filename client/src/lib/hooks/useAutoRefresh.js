import { useMemo } from "react";
import { useLocation } from "react-router-dom";
import { useUI } from "../store.js";

export default function useAutoRefresh({
  enabled = true,
  intervalMs = 60_000,
  pauseWhenOverlayOpen = false,
  allowedRoutes = ["/monitoring", "/monitoramento"],
} = {}) {
  const location = useLocation();
  const overlayCount = useUI((state) => state.overlayCount);

  const isRouteAllowed = useMemo(() => {
    if (!allowedRoutes || allowedRoutes.length === 0) return true;
    return allowedRoutes.some((route) => location.pathname.startsWith(route));
  }, [allowedRoutes, location.pathname]);

  const isPaused = pauseWhenOverlayOpen && overlayCount > 0;
  const resolvedInterval = isRouteAllowed ? intervalMs : null;
  const isEnabled = Boolean(enabled && !isPaused);

  return useMemo(
    () => ({
      enabled: isEnabled,
      intervalMs: resolvedInterval,
      paused: isPaused,
      isRouteAllowed,
    }),
    [isEnabled, resolvedInterval, isPaused, isRouteAllowed],
  );
}
