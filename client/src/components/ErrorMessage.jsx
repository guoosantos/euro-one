import React from "react";

export default function ErrorMessage({ error, fallback = "Não foi possível carregar os dados.", className = "" }) {
  if (!error) return null;
  const message = error?.message || fallback;
  return (
    <div className={`flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-100 ${className}`}>
      <span aria-hidden="true">⚠️</span>
      <span>{message}</span>
    </div>
  );
}
