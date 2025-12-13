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
  // Rotas fullscreen (sem container / sem padding)
  const isFullWidthPage =
    isMonitoringPage || location.pathname.startsWith("/realtime");

  const sidebarOpen = useUI((state) => state.sidebarOpen);
  const sidebarCollapsed = useUI((state) => state.sidebarCollapsed);
  const toggleSidebar = useUI((state) => state.toggle);
  const theme = useUI((state) => state.theme);
  const locale = useUI((state) => state.locale);
  const { tenant } = useTenant();
  const accentColor = tenant?.brandColor;

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

  return (
    <div className="app-shell flex min-h-screen text-text" style={rootStyle}>
      {/* backdrop mobile */}
      {sidebarOpen && (
        <button
          type="button"
          aria-label="Fechar menu"
          className="fixed inset-0 z-30 bg-black/60 md:hidden"
          onClick={toggleSidebar}
        />
      )}

      {/* SIDEBAR WRAPPER
          >>> IMPORTANTE: SEM w-72 / w-16 AQUI <<<
          A largura agora é 100% controlada pelo motion.aside
          dentro de Sidebar.jsx (82px colapsado, ~292px expandido)
      */}
      <div
        role="complementary"
        data-collapsed={sidebarCollapsed ? "true" : "false"}
        className={`fixed inset-y-0 left-0 z-40 transform overflow-hidden border-r border-[#1f2430] bg-[#0f141c] transition-transform md:static md:h-screen md:flex-shrink-0 md:translate-x-0 ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"
        }`}
      >
        <Sidebar />
      </div>

      {/* CONTEÚDO PRINCIPAL */}
      <div className="flex min-h-0 flex-1 min-w-0 flex-col">
        {/* No monitoring a própria página cuida do cabeçalho */}
        <Topbar title={isFullWidthPage ? null : title} />

        <main
          className={`flex min-h-0 flex-1 min-w-0 flex-col bg-[#0b0f17] ${
            isMonitoringPage
              ? "h-full w-full max-w-none overflow-y-auto p-0"
              : "overflow-hidden p-6"
          }`}
        >
          {isFullWidthPage ? (
            // 🔵 Páginas fullscreen (monitoring / realtime)
            <div className="flex min-h-0 flex-1 overflow-hidden bg-[#0b0f17]">
              <ErrorBoundary>{children}</ErrorBoundary>
            </div>
          ) : (
            // 🔹 Demais páginas com container centralizado
            <div className="flex-1 overflow-y-auto">
              <div className="mx-auto flex min-h-full w-full max-w-7xl flex-col gap-6">
                {title && !hideTitle && (
                  <h1 className="text-3xl font-semibold text-white">{title}</h1>
                )}
                <ErrorBoundary>{children}</ErrorBoundary>
              </div>
            </div>
          )}
        </main>
      </div>

      <DeviceModalGlobal />
    </div>
  );
}
