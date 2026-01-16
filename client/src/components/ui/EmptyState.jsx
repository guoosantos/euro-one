import React from "react";

export default function EmptyState({ icon, title, subtitle, action }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-white/10 bg-black/30 px-6 py-10 text-center text-white/70">
      {icon && <div className="text-white/60">{icon}</div>}
      <div className="text-base font-semibold text-white">{title}</div>
      {subtitle && <p className="text-sm text-white/60">{subtitle}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
