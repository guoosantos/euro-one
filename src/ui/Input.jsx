import React from "react";

export default function Input({ icon: Icon, className = "", ...props }) {
  const paddingClass = Icon ? "pl-9" : "pl-3";
  const mergedClassName = `w-full bg-card/60 border border-stroke rounded-xl px-3 py-2 ${paddingClass} focus:outline-none focus:ring-2 focus:ring-primary/30 ${className}`.trim();
  return (
    <div className="relative">
      {Icon && (
        <div className="absolute left-3 top-1/2 -translate-y-1/2 opacity-60">
          <Icon size={16} />
        </div>
      )}
      <input {...props} className={mergedClassName} />
    </div>
  );
}
