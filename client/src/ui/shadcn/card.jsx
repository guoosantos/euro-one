import React from "react";
import { cn } from "./utils";

export function Card({ className, children, ...props }) {
  return (
    <div
      className={cn(
        "relative rounded-2xl border border-white/10 bg-card/80 bg-[radial-gradient(circle_at_20%_20%,rgba(255,255,255,0.08),transparent),radial-gradient(circle_at_80%_0%,rgba(255,255,255,0.06),transparent)] p-5 text-white shadow-glass backdrop-blur-md",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export function CardHeader({ className, children, ...props }) {
  return (
    <div className={cn("mb-3 flex items-start justify-between gap-3", className)} {...props}>
      {children}
    </div>
  );
}

export function CardTitle({ className, children, ...props }) {
  return (
    <h2 className={cn("text-lg font-semibold leading-tight", className)} {...props}>
      {children}
    </h2>
  );
}

export function CardDescription({ className, children, ...props }) {
  return (
    <p className={cn("text-sm text-white/70", className)} {...props}>
      {children}
    </p>
  );
}

export function CardContent({ className, children, ...props }) {
  return (
    <div className={cn("space-y-3", className)} {...props}>
      {children}
    </div>
  );
}
