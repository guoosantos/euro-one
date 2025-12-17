import React from "react";

export default function Button({ children, className = "", variant = "primary", size, ...props }) {
  let baseClass = "btn";
  if (variant === "outline") {
    baseClass = "btn btn-outline";
  } else if (variant === "ghost") {
    baseClass = "btn btn-ghost";
  } else if (variant === "secondary") {
    baseClass = "btn btn-outline";
  } else {
    baseClass = "btn btn-primary";
  }

  const mergedClassName = [baseClass, className].filter(Boolean).join(" ");

  return (
    <button {...props} className={mergedClassName} data-size={size}>
      {children}
    </button>
  );
}
