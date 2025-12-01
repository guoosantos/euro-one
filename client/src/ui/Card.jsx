import React from "react";
import { Card as ShadCard, CardContent, CardDescription, CardHeader, CardTitle } from "./shadcn/card";

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
    <ShadCard className={cardClass} onClick={onClick} role={onClick ? role || "button" : undefined}>
      {hasHeader && (
        <CardHeader className={cx("mb-4 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between", headerClassName)}>
          <div className="space-y-1">
            {title && <CardTitle className="text-white">{title}</CardTitle>}
            {subtitle && <CardDescription className="text-white/70">{subtitle}</CardDescription>}
          </div>
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </CardHeader>
      )}

      {contentClassName ? <CardContent className={contentClassName}>{children}</CardContent> : <CardContent>{children}</CardContent>}
    </ShadCard>
  );
}
