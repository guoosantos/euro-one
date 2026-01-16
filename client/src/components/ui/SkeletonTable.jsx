import React from "react";

export default function SkeletonTable({ rows = 6, columns = 6 }) {
  return (
    <div className="space-y-3" aria-hidden="true">
      {Array.from({ length: rows }).map((_, rowIndex) => (
        <div
          key={`skeleton-row-${rowIndex}`}
          className="grid gap-3"
          style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
        >
          {Array.from({ length: columns }).map((__, colIndex) => (
            <div
              key={`skeleton-cell-${rowIndex}-${colIndex}`}
              className="h-4 rounded-full bg-white/10"
            />
          ))}
        </div>
      ))}
    </div>
  );
}
