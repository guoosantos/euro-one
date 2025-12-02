import React, { useEffect } from "react";

import Sidebar from "../components/Sidebar";
import { Topbar } from "../components/Topbar";
import ErrorBoundary from "../components/ErrorBoundary";
import DeviceModalGlobal from "../components/DeviceModalGlobal";
import { useUI } from "../lib/store";
import { useTenant } from "../lib/tenant-context";

export default function Layout({ children, title, hideTitle = false }) {
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

  const sidebarWidthClass = sidebarCollapsed ? "md:w-16" : "md:w-72";

  const rootStyle = accentColor
    ? {
        "--accent-color": accentColor,
        "--primary": accentColor,
      }
    : undefined;

  return (
    <div className="app-shell flex min-h-screen text-text" style={rootStyle}>
      {sidebarOpen && (
        <button
          type="button"
          aria-label="Fechar menu"
          className="fixed inset-0 z-30 bg-black/60 md:hidden"
          onClick={toggleSidebar}
        />
      )}

      <div
        role="complementary"
        data-collapsed={sidebarCollapsed ? "true" : "false"}
        className={`fixed inset-y-0 left-0 z-40 w-72 transform border-r border-[#1f2430] bg-[#0f141c] transition-transform md:static md:h-screen md:flex-shrink-0 md:translate-x-0 ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"
        } ${sidebarWidthClass}`}
      >
        <Sidebar />
      </div>

      <div className="flex flex-1 flex-col">
        <Topbar title={title} />

        <main className="flex flex-1 flex-col overflow-hidden">
          <div className="flex-1 overflow-y-auto">
            <div className="flex h-full w-full flex-col px-4 py-6">
              <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
                {title && !hideTitle && <h1 className="text-3xl font-semibold text-white">{title}</h1>}

                <ErrorBoundary>{children}</ErrorBoundary>
              </div>
            </div>
          </div>
        </main>
      </div>

      <DeviceModalGlobal />
    </div>
  );
}
