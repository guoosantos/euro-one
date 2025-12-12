import React, { useRef } from "react";

const MIN_PERCENT = 20;
const MAX_PERCENT = 80;

export default function MapTableSplitter({ onResize, currentPercent }) {
  const dragRef = useRef(null);

  const handleMouseDown = (event) => {
    if (!dragRef.current) return;
    const container = dragRef.current.parentElement;
    if (!container) return;

    const containerRect = container.getBoundingClientRect();
    const startY = event.clientY;
    const startPercent = currentPercent ?? 60;
    const startHeightPx = (containerRect.height * startPercent) / 100;

    const handleMove = (moveEvent) => {
      const deltaY = moveEvent.clientY - startY;
      const nextHeightPx = startHeightPx + deltaY;
      const nextPercent = Math.min(
        MAX_PERCENT,
        Math.max(MIN_PERCENT, (nextHeightPx / containerRect.height) * 100),
      );
      onResize?.(Math.round(nextPercent));
    };

    const handleUp = () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };

    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
  };

  return (
    <div
      ref={dragRef}
      role="separator"
      onMouseDown={handleMouseDown}
      className="relative z-30 h-3 cursor-ns-resize select-none bg-gradient-to-b from-white/5 via-white/10 to-white/5"
    >
      <div className="absolute left-1/2 top-1/2 h-1.5 w-16 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/30" />
    </div>
  );
}
