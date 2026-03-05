import React, { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { AppDataProviders } from "./contexts/AppDataProviders.jsx";
import { AppRoutes } from "./routes";
import { useTenant } from "./lib/tenant-context";
import { useUI } from "./lib/store";
import EagleLoaderOverlay from "./components/eagle/EagleLoaderOverlay";
import useEagleLoader from "./lib/hooks/useEagleLoader";

export default function App() {
  const { isAuthenticated, tenantId, mirrorContextMode, activeMirrorOwnerClientId } = useTenant();
  const theme = useUI((state) => state.theme);
  const locale = useUI((state) => state.locale);
  const location = useLocation();
  const { hide, register } = useEagleLoader();
  const routeStateRef = useRef({ first: true, cleanup: null, timer: null });
  const tenantKey = `${tenantId ?? "self"}:${mirrorContextMode ?? "self"}:${activeMirrorOwnerClientId ?? "none"}`;

  useEffect(() => {
    if (typeof document !== "undefined") {
      document.documentElement.dataset.theme = theme;
      document.documentElement.lang = locale || "pt-BR";
    }
  }, [theme, locale]);

  useEffect(() => {
    const handleLoad = () => {
      window.setTimeout(() => hide(), 180);
    };

    if (typeof document !== "undefined" && document.readyState === "complete") {
      handleLoad();
      return undefined;
    }

    window.addEventListener("load", handleLoad);
    return () => window.removeEventListener("load", handleLoad);
  }, [hide]);

  useEffect(() => {
    if (routeStateRef.current.first) {
      routeStateRef.current.first = false;
      return undefined;
    }

    if (routeStateRef.current.cleanup) {
      routeStateRef.current.cleanup();
      routeStateRef.current.cleanup = null;
    }

    routeStateRef.current.cleanup = register("Carregando...");

    if (routeStateRef.current.timer) {
      window.clearTimeout(routeStateRef.current.timer);
    }

    routeStateRef.current.timer = window.setTimeout(() => {
      if (routeStateRef.current.cleanup) {
        routeStateRef.current.cleanup();
        routeStateRef.current.cleanup = null;
      }
    }, 650);

    return () => {
      if (routeStateRef.current.timer) {
        window.clearTimeout(routeStateRef.current.timer);
      }
    };
  }, [location.key, register]);

  return (
    <>
      <EagleLoaderOverlay />
      {isAuthenticated ? (
        <AppDataProviders key={tenantKey}>
          <AppRoutes />
        </AppDataProviders>
      ) : (
        <AppRoutes />
      )}
    </>
  );
}
