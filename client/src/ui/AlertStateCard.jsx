import React from "react";
import { AlertTriangle } from "lucide-react";

const toneStyles = {
  warning: {
    container: "border-amber-500/40 bg-amber-500/10",
    icon: "text-amber-200 bg-amber-500/20",
  },
  info: {
    container: "border-sky-500/30 bg-sky-500/10",
    icon: "text-sky-200 bg-sky-500/20",
  },
  neutral: {
    container: "border-white/10 bg-white/5",
    icon: "text-white/80 bg-white/10",
  },
};

export default function AlertStateCard({
  title,
  text,
  bullets = [],
  actions = null,
  icon: Icon = AlertTriangle,
  tone = "warning",
  className = "",
}) {
  const styles = toneStyles[tone] || toneStyles.neutral;

  return (
    <div
      className={`w-full max-w-2xl rounded-2xl border px-6 py-6 shadow-2xl ${styles.container} ${className}`.trim()}
    >
      <div className="flex items-start gap-4">
        <div className={`flex h-12 w-12 items-center justify-center rounded-2xl ${styles.icon}`.trim()}>
          <Icon size={22} />
        </div>
        <div className="flex-1 text-white">
          <h2 className="text-lg font-semibold">{title}</h2>
          {text ? <p className="mt-2 text-sm text-white/70">{text}</p> : null}
          {Array.isArray(bullets) && bullets.length > 0 ? (
            <ul className="mt-3 space-y-1 text-sm text-white/70">
              {bullets.map((bullet) => (
                <li key={bullet} className="flex items-start gap-2">
                  <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-white/50" />
                  <span>{bullet}</span>
                </li>
              ))}
            </ul>
          ) : null}
          {actions ? <div className="mt-5 flex flex-wrap items-center gap-2">{actions}</div> : null}
        </div>
      </div>
    </div>
  );
}
