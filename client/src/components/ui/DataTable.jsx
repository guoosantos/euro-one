import React from "react";

export default function DataTable({ children, className = "", tableClassName = "" }) {
  return (
    <div className={`overflow-x-auto ${className}`}>
      <table className={`min-w-full text-sm text-white ${tableClassName}`}>{children}</table>
    </div>
  );
}
