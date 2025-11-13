/**
 * LayoutLocal: Layout simples com Sidebar à esquerda.
 * Usa ../components/Sidebar.jsx (default ou named export).
 */
import React from "react";
let SidebarComp;
try {
  // tenta default export
  SidebarComp = require("./Sidebar").default || require("./Sidebar").Sidebar;
} catch (e) {
  SidebarComp = null;
}

export default function LayoutLocal({ children, title }) {
  return (
    <div className="min-h-screen bg-[#0c111a] text-white flex">
      {SidebarComp ? (
        <aside className="w-[240px] hidden md:block border-r border-white/5">
          {React.createElement(SidebarComp)}
        </aside>
      ) : null}
      <main className="flex-1 px-6 py-5">
        {title ? <div className="text-xl font-semibold mb-2">{title}</div> : null}
        {children}
      </main>
    </div>
  );
}
