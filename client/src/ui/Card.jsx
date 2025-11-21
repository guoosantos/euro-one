import React from "react";

function cx(...classes) {
  return classes.filter(Boolean).join(" ");
}

export default function Card({
  title,
  subtitle,
  actions,
  children,
  className = "",
  contentClassName = "",
  padding = true,
  headerClassName = "",
  onClick,
  role,
}) {
  const hasHeader = Boolean(title || subtitle || actions);
  const cardClass = cx("card", padding !== false && "p-5 md:p-6", className);

  return (
    <div className={cardClass} onClick={onClick} role={onClick ? role || "button" : undefined}>
      {hasHeader && (
        <header className={cx("mb-4 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between", headerClassName)}>
          <div className="space-y-1">
            {title && <h2 className="text-lg font-semibold text-white">{title}</h2>}
            {subtitle && <p className="text-sm text-white/60">{subtitle}</p>}
          </div>
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </header>
      )}

      {contentClassName ? <div className={contentClassName}>{children}</div> : children}
    </div>
  );
}
