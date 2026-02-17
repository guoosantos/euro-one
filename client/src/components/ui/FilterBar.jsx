import React from "react";

export default function FilterBar({ left, right, className = "" }) {
  return (
    <div className={`e-filter-bar flex flex-col gap-3 md:flex-row md:items-center md:justify-between ${className}`}>
      <div className="e-filter-bar__left flex flex-1 flex-wrap items-center gap-3">{left}</div>
      {right && <div className="e-filter-bar__right flex flex-wrap items-center gap-2">{right}</div>}
    </div>
  );
}
