import React from "react";

export default function DataCard({ children, className = "" }) {
  return (
    <div className={`rounded-2xl border border-white/10 bg-white/5 p-4 shadow-lg ${className}`}>
      {children}
    </div>
  );
}
