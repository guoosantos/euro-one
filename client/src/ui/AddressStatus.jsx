import React from "react";
import { FALLBACK_ADDRESS } from "../lib/utils/geocode.js";

export default function AddressStatus({ address, loading, className = "" }) {
  const safeAddress = typeof address === "string" ? address.trim() : "";
  const resolvedAddress = safeAddress && safeAddress !== "—" ? safeAddress : "";
  const display = loading ? "Carregando…" : resolvedAddress || FALLBACK_ADDRESS;
  const title = !loading ? resolvedAddress || undefined : undefined;

  return (
    <span className={`flex min-w-0 items-center gap-2 overflow-hidden ${className}`} title={title}>
      <span className="min-w-0 truncate whitespace-nowrap">{display}</span>
    </span>
  );
}
