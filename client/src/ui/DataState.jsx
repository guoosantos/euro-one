import { AlertCircle, Inbox, Loader2, Sparkles } from "lucide-react";

function toneStyles(tone) {
  switch (tone) {
    case "error":
      return "bg-red-500/10 border-red-500/30 text-red-100";
    case "success":
      return "bg-emerald-500/10 border-emerald-500/30 text-emerald-100";
    case "muted":
      return "bg-white/5 border-white/10 text-white/70";
    default:
      return "bg-primary/5 border-primary/20 text-white";
  }
}

const defaultIcons = {
  loading: Loader2,
  empty: Inbox,
  error: AlertCircle,
  partial: Sparkles,
  info: Sparkles,
};

export default function DataState({
  tone = "muted",
  state = "info",
  title,
  description,
  action,
  compact = false,
  className = "",
}) {
  const Icon = defaultIcons[state] ?? defaultIcons.info;
  const styles = toneStyles(tone);

  return (
    <div
      className={`flex items-center gap-3 rounded-xl border px-3 py-3 ${styles} ${
        compact ? "text-xs" : "text-sm"
      } ${className}`}
    >
      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-black/10">
        <Icon className={`h-5 w-5 ${state === "loading" ? "animate-spin" : ""}`} />
      </div>
      <div className="flex-1">
        <div className="font-medium text-white">{title}</div>
        {description && <div className="text-xs text-white/60">{description}</div>}
        {action && <div className="mt-2 text-xs font-semibold text-primary">{action}</div>}
      </div>
    </div>
  );
}
