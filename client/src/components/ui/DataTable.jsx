import React from "react";

export default function DataTable({
  children,
  className = "",
  tableClassName = "",
  horizontalScroll = true,
}) {
  return (
    <div className={`${horizontalScroll ? "e-scroll-x overflow-x-auto" : "overflow-visible"} ${className}`.trim()}>
      <table className={`e-table min-w-full text-sm text-white ${tableClassName}`.trim()}>{children}</table>
    </div>
  );
}
