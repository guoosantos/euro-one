import React from "react";
import { cn } from "./utils";

const variants = {
  default: "bg-[var(--accent-color,_var(--primary))] text-white",
  muted: "bg-white/10 text-white/80",
  outline: "border border-white/15 text-white",
};

export function Badge({ variant = "default", className, children, ...props }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium backdrop-blur-md shadow-soft",
        variants[variant],
        className,
      )}
      {...props}
    >
      {children}
    </span>
  );
}
