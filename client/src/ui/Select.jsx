import React, { useId } from "react";

export default function Select({ className = "", children, label, helper, id, ...props }) {
  const generatedId = useId();
  const selectId = id || (label ? generatedId : undefined);
  const merged = className
    ? `${className} bg-card/60 border border-stroke rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary/30`
    : "bg-card/60 border border-stroke rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary/30";
  const selectElement = (
    <select {...props} id={selectId} aria-label={label} className={merged}>
      {children}
    </select>
  );

  if (!label && !helper) {
    return selectElement;
  }

  return (
    <div className="flex flex-col gap-1">
      {label ? (
        <label htmlFor={selectId} className="text-xs uppercase tracking-[0.12em] text-white/60">
          {label}
          {props.required ? " *" : ""}
        </label>
      ) : null}
      {selectElement}
      {helper ? <span className="text-[11px] text-white/50">{helper}</span> : null}
    </div>
  );
}
