import React, { useEffect } from "react";
import { useLocation } from "react-router-dom";

import Sidebar from "../components/Sidebar";
import { Topbar } from "../components/Topbar";
import ErrorBoundary from "../components/ErrorBoundary";
import DeviceModalGlobal from "../components/DeviceModalGlobal";
import { useUI } from "../lib/store";
import { useTenant } from "../lib/tenant-context";

export default function Layout({ children, title, hideTitle = false }) {
  const location = useLocation();

  const isMonitoringPage = location.pathname.startsWith("/monitoring");
  const isGeofencesPage =
    location.pathname.startsWith("/geofences") ||
    location.pathname.startsWith("/targets") ||
    location.pathname.startsWith("/alvos");
  const isRoutesPage = location.pathname.startsWith("/routes");
  const isEventsPage = location.pathname.startsWith("/events");
  const isItinerariesPage = location.pathname.startsWith("/itineraries");
  // Rotas fullscreen (sem container / sem padding)
  const isFullWidthPage =
    isMonitoringPage ||
    isGeofencesPage ||
    isRoutesPage ||
    isEventsPage ||
    location.pathname.startsWith("/realtime");

  const sidebarOpen = useUI((state) => state.sidebarOpen);
  const sidebarCollapsed = useUI((state) => state.sidebarCollapsed);
  const toggleSidebar = useUI((state) => state.toggle);
  const theme = useUI((state) => state.theme);
  const locale = useUI((state) => state.locale);
  const { tenant } = useTenant();
  const accentColor = tenant?.brandColor;
  const showMonitoringTopbar = useUI((state) => state.monitoringTopbarVisible !== false);
  const showGeofencesTopbar = useUI((state) => state.geofencesTopbarVisible !== false);
  const showRoutesTopbar = useUI((state) => state.routesTopbarVisible !== false);

  useEffect(() => {
    if (!title) return;
    document.title = `${title} · Euro One`;
  }, [title]);

  useEffect(() => {
    if (typeof document !== "undefined") {
      document.documentElement.dataset.theme = theme;
      document.documentElement.lang = locale || "pt-BR";
    }
  }, [theme, locale]);

  const rootStyle = accentColor
    ? {
        "--accent-color": accentColor,
        "--primary": accentColor,
      }
    : undefined;

  const sidebarWidthVar = sidebarCollapsed
    ? "var(--e-sidebar-collapsed-w)"
    : "var(--e-sidebar-w)";

  return (
    <div
      className="app-shell text-text"
      style={{ ...rootStyle, "--app-sidebar-w": sidebarWidthVar }}
    >
      {/* backdrop mobile */}
      {sidebarOpen && (
        <button
          type="button"
          aria-label="Fechar menu"
          className="fixed inset-0 z-30 bg-black/60 md:hidden"
          onClick={toggleSidebar}
        />
      )}

      {/* SIDEBAR */}
      <aside
        role="complementary"
        data-collapsed={sidebarCollapsed ? "true" : "false"}
        className={`app-shell__sidebar border-r border-[#1f2430] bg-[#0f141c] transition-transform ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"
        }`}
      >
        <Sidebar />
      </aside>

      {/* CONTEÚDO PRINCIPAL */}
      <main className="app-shell__main bg-[#0b0f17]">
        {/* No monitoring a própria página cuida do cabeçalho */}
        {((!isMonitoringPage && !isGeofencesPage && !isRoutesPage) ||
          (isMonitoringPage && showMonitoringTopbar) ||
          (isGeofencesPage && showGeofencesTopbar) ||
          (isRoutesPage && showRoutesTopbar)) && <Topbar title={isFullWidthPage ? null : title} />}

        <section className={`app-shell__content ${isFullWidthPage ? "p-0" : "p-6"}`}>
          {isFullWidthPage ? (
            // 🔵 Páginas fullscreen (monitoring / realtime)
            <div className="flex min-h-0 w-full flex-1 flex-col bg-[#0b0f17]">
              <ErrorBoundary>{children}</ErrorBoundary>
            </div>
          ) : (
            // 🔹 Demais páginas com container centralizado
            <div className="mx-auto flex min-h-0 w-full max-w-7xl flex-1 flex-col gap-6">
              {title && !hideTitle && (
                <h1 className="text-3xl font-semibold text-white">{title}</h1>
              )}
              <ErrorBoundary>{children}</ErrorBoundary>
            </div>
          )}
        </section>
      </main>

      <DeviceModalGlobal />
    </div>
  );
}
