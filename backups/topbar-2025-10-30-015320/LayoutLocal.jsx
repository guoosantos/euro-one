import React from "react";
import TopbarLocal from "./TopbarLocal";
import * as SidebarMod from "./Sidebar";
const SidebarComp = SidebarMod.default || SidebarMod.Sidebar || null;

export default function LayoutLocal({ children, title }) {
  return (
    <div className="min-h-screen bg-[#0c111a] text-white flex">
      {SidebarComp ? (
        <aside className="w-[240px] hidden md:block border-r border-white/5">
          {React.createElement(SidebarComp)}
        </aside>
      ) : null}
      <main className="flex-1 px-6 py-5">
        <TopbarLocal />
        {title ? <div className="text-xl font-semibold mb-2">{title}</div> : null}
        {children}
      </main>
    </div>
  );
}
