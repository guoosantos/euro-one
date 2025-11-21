import React from "react";

export default function Select({ className = "", children, ...props }) {
  const merged = className
    ? `${className} bg-card/60 border border-stroke rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary/30`
    : "bg-card/60 border border-stroke rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary/30";
  return (
    <select {...props} className={merged}>
      {children}
    </select>
  );
}
