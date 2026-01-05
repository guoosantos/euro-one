import React, { useMemo } from "react";
import { FALLBACK_ADDRESS } from "../lib/utils/geocode.js";

function formatCoords(lat, lng) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return "";
  return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
}

export default function AddressStatus({ address, loading, lat, lng, onRetry, className = "" }) {
  const coords = useMemo(() => formatCoords(lat, lng), [lat, lng]);
  const safeAddress = typeof address === "string" ? address : "";
  const resolvedAddress = safeAddress && safeAddress !== "—" ? safeAddress : "";
  const isFallback = !resolvedAddress || resolvedAddress === FALLBACK_ADDRESS;
  const display = loading
    ? "Resolvendo endereço..."
    : isFallback
      ? coords || FALLBACK_ADDRESS
      : resolvedAddress;
  const title = !loading ? (isFallback ? coords || FALLBACK_ADDRESS : resolvedAddress) : undefined;

  return (
    <span className={`flex min-w-0 items-center gap-2 ${className}`} title={title}>
      <span className="min-w-0 truncate">{display}</span>
      {onRetry && !loading && isFallback ? (
        <button
          type="button"
          className="shrink-0 text-[10px] font-semibold uppercase tracking-[0.08em] text-primary/80 hover:text-primary"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onRetry();
          }}
        >
          Tentar novamente
        </button>
      ) : null}
    </span>
  );
}
