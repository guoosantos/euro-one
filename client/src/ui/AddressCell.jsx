import React, { useMemo } from "react";
import { formatAddress } from "../lib/format-address.js";
import { FALLBACK_ADDRESS, useReverseGeocode } from "../lib/utils/geocode.js";

function normalizeCoordinate(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export default function AddressCell({ address, lat, lng, className = "" }) {
  const formattedAddress = useMemo(() => formatAddress(address), [address]);
  const safeLat = normalizeCoordinate(lat);
  const safeLng = normalizeCoordinate(lng);
  const shouldReverse =
    formattedAddress === "—" &&
    Number.isFinite(safeLat) &&
    Number.isFinite(safeLng);

  const { address: reverseAddress, loading } = useReverseGeocode(safeLat, safeLng, {
    enabled: shouldReverse,
  });

  const resolved = formattedAddress !== "—" ? formattedAddress : reverseAddress || FALLBACK_ADDRESS;
  const display = loading && shouldReverse ? "Resolvendo endereço..." : resolved;
  const tooltip = display !== resolved ? resolved : undefined;

  return (
    <span className={className} title={tooltip}>
      {display}
    </span>
  );
}
