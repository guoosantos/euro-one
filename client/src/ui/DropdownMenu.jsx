import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

const OFFSET = 8;

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

export default function DropdownMenu({
  open,
  anchorRef,
  onClose,
  align = "end",
  minWidth = 200,
  children,
}) {
  const menuRef = useRef(null);
  const [style, setStyle] = useState({ opacity: 0, pointerEvents: "none" });

  const alignValue = useMemo(() => (align === "start" ? "start" : "end"), [align]);

  useLayoutEffect(() => {
    if (!open) return;
    const anchor = anchorRef?.current;
    const menu = menuRef.current;
    if (!anchor || !menu) return;

    const anchorRect = anchor.getBoundingClientRect();
    const menuRect = menu.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    const preferredLeft =
      alignValue === "start" ? anchorRect.left : anchorRect.right - menuRect.width;
    const left = clamp(preferredLeft, OFFSET, viewportWidth - menuRect.width - OFFSET);

    const preferredTop = anchorRect.bottom + OFFSET;
    const shouldFlip = preferredTop + menuRect.height > viewportHeight - OFFSET;
    const top = shouldFlip
      ? clamp(anchorRect.top - menuRect.height - OFFSET, OFFSET, viewportHeight - menuRect.height - OFFSET)
      : preferredTop;

    setStyle({
      top: Math.round(top),
      left: Math.round(left),
      minWidth,
      opacity: 1,
      pointerEvents: "auto",
    });
  }, [alignValue, anchorRef, minWidth, open]);

  useEffect(() => {
    if (!open) return;

    const handleClick = (event) => {
      if (
        menuRef.current?.contains(event.target) ||
        anchorRef?.current?.contains(event.target)
      ) {
        return;
      }
      onClose?.();
    };

    const handleKey = (event) => {
      if (event.key === "Escape") {
        onClose?.();
      }
    };

    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [anchorRef, onClose, open]);

  if (!open) return null;

  return createPortal(
    <div
      ref={menuRef}
      className="z-[9999] rounded-xl border border-white/10 bg-[#0f141c] shadow-2xl"
      style={{ position: "fixed", ...style }}
    >
      {children}
    </div>,
    document.body,
  );
}
