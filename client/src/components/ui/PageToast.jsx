import React from "react";

const TYPE_CLASSES = {
  success: "border-emerald-500/40 bg-emerald-500/10 text-emerald-100",
  error: "border-red-500/40 bg-red-500/10 text-red-100",
  warning: "border-amber-500/40 bg-amber-500/10 text-amber-100",
  info: "border-sky-500/40 bg-sky-500/10 text-sky-100",
};

export default function PageToast({ toast }) {
  if (!toast) return null;
  const className = TYPE_CLASSES[toast.type] || TYPE_CLASSES.success;
  return (
    <div className={`fixed bottom-6 right-6 z-[9999] rounded-xl border px-4 py-3 text-sm shadow-lg ${className}`}>
      {toast.message}
    </div>
  );
}
