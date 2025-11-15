import React, { useEffect } from "react";

import Sidebar from "../components/Sidebar";
import { Topbar } from "../components/Topbar";
import ErrorBoundary from "../components/ErrorBoundary";
import DeviceModalGlobal from "../components/DeviceModalGlobal";
import { useUI } from "../lib/store";

export default function Layout({ children, title, hideTitle = false }) {
  const sidebarOpen = useUI((state) => state.sidebarOpen);
  const sidebarCollapsed = useUI((state) => state.sidebarCollapsed);
  const toggleSidebar = useUI((state) => state.toggle);
  const theme = useUI((state) => state.theme);
  const locale = useUI((state) => state.locale);

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

  const desktopPadding = sidebarCollapsed ? "md:pl-16" : "md:pl-72";
  const desktopWidth = sidebarCollapsed ? "md:w-16" : "md:w-72";

  return (
    <div className="flex min-h-screen bg-bg text-text">
      {sidebarOpen && (
        <button
          type="button"
          aria-label="Fechar menu"
          className="fixed inset-0 z-30 bg-black/60 md:hidden"
          onClick={toggleSidebar}
        />
      )}

      <aside
        data-collapsed={sidebarCollapsed ? "true" : "false"}
        className={`fixed inset-y-0 left-0 z-40 w-72 transform bg-[#0f141c] border-r border-[#1f2430] transition md:static md:translate-x-0 ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"
        } ${desktopWidth}`}
      >
        <Sidebar />
      </aside>

      <div className={`flex flex-1 flex-col ${desktopPadding}`}>
        <Topbar title={title} />

        <main className="flex flex-1 flex-col overflow-hidden">
          <div className="flex-1 overflow-y-auto">
            <div className="mx-auto flex h-full w-full max-w-7xl flex-col gap-6 px-4 py-6">
              {title && !hideTitle && <h1 className="text-2xl font-semibold">{title}</h1>}

              <ErrorBoundary>{children}</ErrorBoundary>
            </div>
          </div>
        </main>
      </div>

      <DeviceModalGlobal />
    </div>
  );
}
