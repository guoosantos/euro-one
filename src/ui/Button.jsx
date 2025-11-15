import React from "react";

export default function Button({ children, className = "", ...props }) {
  const mergedClassName = className ? `btn ${className}` : "btn";
  return (
    <button {...props} className={mergedClassName}>
      {children}
    </button>
  );
}
