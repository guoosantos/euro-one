import React, { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";

import Sidebar from "../components/Sidebar";
import { Topbar } from "../components/Topbar";
import ErrorBoundary from "../components/ErrorBoundary";
import DeviceModalGlobal from "../components/DeviceModalGlobal";
import { useUI } from "../lib/store";
import { useTenant } from "../lib/tenant-context";
import { usePageMeta } from "../lib/page-meta";

export default function Layout({ children, title, hideTitle = false }) {
  const location = useLocation();
  const pageMeta = usePageMeta();
  const resolvedTitle = pageMeta?.title ?? title ?? null;

  const isMonitoringPage = location.pathname.startsWith("/monitoring");
  const isGeofencesPage =
    location.pathname.startsWith("/geofences") ||
    location.pathname.startsWith("/targets") ||
    location.pathname.startsWith("/alvos");
  const isRoutesPage = location.pathname.startsWith("/routes");
  const isEventsPage = location.pathname.startsWith("/events");
  const isTripsPage = location.pathname.startsWith("/trips");
  // Rotas fullscreen (sem container / sem padding)
  const isFullWidthPage =
    isMonitoringPage ||
    isGeofencesPage ||
    isRoutesPage ||
    isEventsPage ||
    location.pathname.startsWith("/realtime");
  const isWidePage = isFullWidthPage || isTripsPage;

  const sidebarOpen = useUI((state) => state.sidebarOpen);
  const sidebarCollapsed = useUI((state) => state.sidebarCollapsed);
  const toggleSidebar = useUI((state) => state.toggle);
  const theme = useUI((state) => state.theme);
  const locale = useUI((state) => state.locale);
  const { tenant, isMirrorReceiver, mirrorModeEnabled, apiUnavailable } = useTenant();
  const accentColor = tenant?.brandColor;
  const showMonitoringTopbar = useUI((state) => state.monitoringTopbarVisible !== false);
  const showGeofencesTopbar = useUI((state) => state.geofencesTopbarVisible !== false);
  const showRoutesTopbar = useUI((state) => state.routesTopbarVisible !== false);
  const [buildInfo, setBuildInfo] = useState(null);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const overrideTitle = document.body?.getAttribute("data-page-title-override");
    const nextTitle = String(overrideTitle || resolvedTitle || "").trim();
    if (!nextTitle) return;
    document.title = `EURO ONE • ${nextTitle}`;
  }, [resolvedTitle]);

  useEffect(() => {
    let active = true;
    fetch("/version.json", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!active || !data) return;
        if (data.builtAt || data.gitSha) setBuildInfo(data);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

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
        className={`app-shell__sidebar border-r border-stroke bg-sidebar transition-transform ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"
        }`}
      >
        <Sidebar />
      </aside>

      {/* CONTEÚDO PRINCIPAL */}
      <main className="app-shell__main bg-surface">
        {/* No monitoring a própria página cuida do cabeçalho */}
        {((!isMonitoringPage && !isGeofencesPage && !isRoutesPage) ||
          (isMonitoringPage && showMonitoringTopbar) ||
          (isGeofencesPage && showGeofencesTopbar) ||
          (isRoutesPage && showRoutesTopbar)) && (
          <Topbar title={isFullWidthPage ? null : resolvedTitle} />
        )}

        <section className={`app-shell__content ${isWidePage ? "p-0" : "p-6"}`}>
          {apiUnavailable && (
            <div className={isFullWidthPage ? "px-6 pt-6" : undefined}>
              <div className="mb-4 rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-100 shadow-sm">
                API indisponível no momento. Verifique a conexão ou o endereço do backend.
              </div>
            </div>
          )}
          {isMirrorReceiver && mirrorModeEnabled === false && (
            <div className={isFullWidthPage ? "px-6 pt-6" : undefined}>
              <div className="mb-4 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-100 shadow-sm">
                Espelhamento desativado no servidor (MIRROR_MODE_ENABLED).
              </div>
            </div>
          )}
          {isWidePage ? (
            // 🔵 Páginas fullscreen (monitoring / realtime)
            <div className="flex min-h-0 w-full flex-1 flex-col bg-surface">
              <ErrorBoundary>{children}</ErrorBoundary>
            </div>
          ) : (
            // 🔹 Demais páginas com container centralizado
            <div className="mx-auto flex min-h-0 w-full max-w-7xl flex-1 flex-col gap-6">
              <ErrorBoundary>{children}</ErrorBoundary>
            </div>
          )}
        </section>
      </main>

      {buildInfo && (
        <div
          className="pointer-events-none fixed bottom-3 right-3 z-50 rounded-full border border-white/10 bg-black/60 px-3 py-1 text-[11px] text-white/70 shadow"
          title={
            buildInfo.builtAt
              ? `UTC: ${new Intl.DateTimeFormat("en-GB", {
                  timeZone: "UTC",
                  dateStyle: "short",
                  timeStyle: "medium",
                }).format(new Date(buildInfo.builtAt))}`
              : undefined
          }
        >
          Build (UTC-3):{" "}
          {buildInfo.builtAt
            ? new Intl.DateTimeFormat("pt-BR", {
                timeZone: "America/Sao_Paulo",
                dateStyle: "short",
                timeStyle: "medium",
              }).format(new Date(buildInfo.builtAt))
            : "unknown"}
        </div>
      )}
      <DeviceModalGlobal />
    </div>
  );
}
