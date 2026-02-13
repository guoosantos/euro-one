import React from "react";

export default function LInput({ label, className = "", placeholder, ...props }) {
  const resolvedPlaceholder = placeholder ?? label ?? "";
  const showHelper = Boolean(label && placeholder && placeholder !== label);
  return (
    <div className="lwrap">
      <input
        className={`linput ${className}`}
        placeholder={resolvedPlaceholder}
        aria-label={label || placeholder}
        {...props}
      />
      {showHelper ? <span className="lhelp">{label}</span> : null}
    </div>
  );
}
