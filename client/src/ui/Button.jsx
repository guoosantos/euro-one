import React from "react";

export default function Button({ children, className = "", variant = "primary", ...props }) {
  let baseClass = "btn";
  if (variant === "outline") {
    baseClass = "btn btn-outline";
  } else if (variant === "ghost") {
    baseClass = "btn btn-ghost";
  } else {
    baseClass = "btn btn-primary";
  }
  const mergedClassName = className ? `${baseClass} ${className}` : baseClass;
  return (
    <button {...props} className={mergedClassName}>
      {children}
    </button>
  );
}
