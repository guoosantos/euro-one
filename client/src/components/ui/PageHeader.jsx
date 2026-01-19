import React from "react";

export default function PageHeader({
  title,
  subtitle,
  description,
  overline,
  eyebrow,
  actions,
  rightSlot,
  right,
  className = "",
  titleClassName = "",
}) {
  const resolvedSubtitle = subtitle ?? description ?? null;
  const resolvedOverline = overline ?? eyebrow ?? null;
  const resolvedRightSlot = rightSlot ?? right ?? null;

  return (
    <div className={`page-header ${className}`.trim()}>
      <div className="page-header__stack">
        {resolvedOverline && <div className="page-header__overline">{resolvedOverline}</div>}
        <h1 className={`page-header__title ${titleClassName}`.trim()}>{title}</h1>
        {resolvedSubtitle && <p className="page-header__subtitle">{resolvedSubtitle}</p>}
      </div>
      {(resolvedRightSlot || actions) && (
        <div className="page-header__right">
          {resolvedRightSlot && <div className="page-header__right-slot">{resolvedRightSlot}</div>}
          {actions && <div className="page-header__actions">{actions}</div>}
        </div>
      )}
    </div>
  );
}
