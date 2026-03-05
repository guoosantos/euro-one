import React, { useId } from "react";

export default function Input({ icon: Icon, className = "", label, helper, id, ...props }) {
  const generatedId = useId();
  const inputId = id || (label ? generatedId : undefined);
  const paddingClass = Icon ? "pl-9" : "pl-3";
  const mergedClassName = `w-full bg-card/60 border border-stroke rounded-xl px-3 py-2 ${paddingClass} focus:outline-none focus:ring-2 focus:ring-primary/30 ${className}`.trim();
  const inputElement = (
    <div className="relative">
      {Icon && (
        <div className="absolute left-3 top-1/2 -translate-y-1/2 opacity-60">
          <Icon size={16} />
        </div>
      )}
      <input {...props} id={inputId} aria-label={label || props.placeholder} className={mergedClassName} />
    </div>
  );

  if (!label && !helper) {
    return inputElement;
  }

  return (
    <div className="flex flex-col gap-1">
      {label ? (
        <label htmlFor={inputId} className="text-xs uppercase tracking-[0.12em] text-white/60">
          {label}
          {props.required ? " *" : ""}
        </label>
      ) : null}
      {inputElement}
      {helper ? <span className="text-[11px] text-white/50">{helper}</span> : null}
    </div>
  );
}
