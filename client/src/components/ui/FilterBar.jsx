import React from "react";

export default function FilterBar({ left, right, className = "" }) {
  return (
    <div className={`flex flex-col gap-3 md:flex-row md:items-center md:justify-between ${className}`}>
      <div className="flex flex-1 flex-wrap items-center gap-3">{left}</div>
      {right && <div className="flex flex-wrap items-center gap-2">{right}</div>}
    </div>
  );
}
