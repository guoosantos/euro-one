import React, { useEffect } from "react";

import Sidebar from "../components/Sidebar";
import { Topbar } from "../components/Topbar";
import ErrorBoundary from "../components/ErrorBoundary";
import DeviceModalGlobal from "../components/DeviceModalGlobal";
import { useUI } from "../lib/store";

export default function Layout({ children, title, hideTitle = false, fullBleed = false }) {
  const sidebarOpen = useUI((state) => state.sidebarOpen);
  const toggleSidebar = useUI((state) => state.toggle);

  useEffect(() => {
    if (!title) return;
    document.title = `${title} · Euro One`;
  }, [title]);

  return (
    <div className="min-h-screen bg-bg text-text">
      {sidebarOpen && (
        <button
          type="button"
          aria-label="Fechar menu"
          className="fixed inset-0 z-30 bg-black/60 md:hidden"
          onClick={toggleSidebar}
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-40 w-72 transform bg-[#0f141c] border-r border-[#1f2430] transition md:static md:translate-x-0 ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"
        }`}
      >
        <Sidebar />
      </aside>

      <div className="md:pl-72">
        <div className="min-h-screen flex flex-col">
          <Topbar title={title} />

          <main
            className={`flex-1 ${
              fullBleed
                ? "w-full px-4 py-6 md:px-6"
                : "mx-auto w-full max-w-7xl px-4 py-6"
            }`}
          >
            <div className="page-shell">
              {title && !hideTitle && (
                <div className="page-header">
                  <h1>{title}</h1>
                </div>
              )}

              <ErrorBoundary>
                <div className="page-content">{children}</div>
              </ErrorBoundary>
            </div>
          </main>
        </div>
      </div>

      <DeviceModalGlobal />
    </div>
  );
}
