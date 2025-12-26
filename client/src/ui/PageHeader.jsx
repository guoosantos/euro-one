import React from "react";

export default function PageHeader({ title, description, subtitle, right = null, eyebrow = null }) {
  const resolvedDescription = description ?? subtitle ?? null;

  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div>
        {eyebrow && <div className="text-xs uppercase tracking-[0.2em] text-white/40">{eyebrow}</div>}
        <div className="text-2xl font-semibold text-white">{title}</div>
        {resolvedDescription && <div className="text-sm text-white/60">{resolvedDescription}</div>}
      </div>
      {right && <div className="flex flex-wrap items-center gap-2">{right}</div>}
    </div>
  );
}
