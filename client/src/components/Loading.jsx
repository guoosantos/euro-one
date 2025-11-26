import React from "react";

export default function Loading({ message = "Carregando...", className = "" }) {
  return (
    <div className={`flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/70 ${className}`}>
      <span className="inline-block h-2 w-2 animate-ping rounded-full bg-sky-400" aria-hidden="true" />
      <span>{message}</span>
    </div>
  );
}
