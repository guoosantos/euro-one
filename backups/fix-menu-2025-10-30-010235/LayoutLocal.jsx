import React from "react";
import SidebarDefault, { Sidebar as SidebarNamed } from "./Sidebar";
const SidebarComp = SidebarDefault || SidebarNamed || null;

export default function LayoutLocal({ children, title }) {
  return (
    <div className="min-h-screen bg-[#0c111a] text-white flex">
      {SidebarComp ? (
        <aside className="w-[240px] hidden md:block border-r border-white/5">
          <SidebarComp />
        </aside>
      ) : null}
      <main className="flex-1 px-6 py-5">
        {title ? <div className="text-xl font-semibold mb-2">{title}</div> : null}
        {children}
      </main>
    </div>
  );
}
