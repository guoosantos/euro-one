import React from "react";
import { cn } from "./utils";

const variants = {
  default: "bg-[var(--accent-color,_var(--primary))] text-white shadow-glow hover:brightness-110",
  outline: "border border-white/20 text-white hover:bg-white/5",
  ghost: "text-white/80 hover:text-white hover:bg-white/5",
  secondary: "bg-white/10 text-white hover:bg-white/20",
};

const sizes = {
  sm: "h-8 px-3 text-xs",
  default: "h-10 px-4 text-sm",
  lg: "h-12 px-5 text-base",
};

export function Button({ variant = "default", size = "default", className, children, ...props }) {
  return (
    <button
      type="button"
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-xl font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60",
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}
