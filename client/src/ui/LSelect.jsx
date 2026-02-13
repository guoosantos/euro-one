import React from "react";

export default function LSelect({ label, className = "", children, ...props }) {
  return (
    <div className="lwrap">
      <select className={`lselect ${className}`} aria-label={label} {...props}>
        {children}
      </select>
      {label ? <span className="lhelp">{label}</span> : null}
    </div>
  );
}
