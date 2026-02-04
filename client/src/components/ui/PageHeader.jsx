import React, { useEffect } from "react";
import { usePageMeta } from "../../lib/page-meta";

export default function PageHeader({
  kicker,
  title,
  subtitle,
  description,
  overline,
  eyebrow,
  actions,
  rightControls,
  rightSlot,
  right,
  className = "",
  titleClassName = "",
}) {
  const meta = usePageMeta();
  const resolvedSubtitle = subtitle ?? description ?? meta?.subtitle ?? null;
  const resolvedKicker = kicker ?? overline ?? eyebrow ?? meta?.kicker ?? null;
  const resolvedTitle = title ?? meta?.title ?? "";
  const resolvedRightSlot = rightControls ?? rightSlot ?? right ?? null;
  const normalizedTitle = String(resolvedTitle || "").trim();
  const normalizedKicker = String(resolvedKicker || "").trim();
  const shouldRenderKicker =
    normalizedKicker && normalizedTitle && normalizedKicker.toLowerCase() !== normalizedTitle.toLowerCase();

  useEffect(() => {
    if (!normalizedTitle || typeof document === "undefined") return;
    const previous = document.body?.getAttribute("data-page-title-override");
    document.body?.setAttribute("data-page-title-override", normalizedTitle);
    document.title = `EURO ONE • ${normalizedTitle}`;
    return () => {
      if (document.body?.getAttribute("data-page-title-override") === normalizedTitle) {
        if (previous) {
          document.body?.setAttribute("data-page-title-override", previous);
        } else {
          document.body?.removeAttribute("data-page-title-override");
        }
      }
    };
  }, [normalizedTitle]);

  return (
    <div className={`page-header ${className}`.trim()}>
      <div className="page-header__stack">
        {shouldRenderKicker && <div className="page-header__overline">{resolvedKicker}</div>}
        {normalizedTitle && <h1 className={`page-header__title ${titleClassName}`.trim()}>{resolvedTitle}</h1>}
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
