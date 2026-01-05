import React, { useMemo } from "react";
import { formatAddress } from "../lib/format-address.js";
import { FALLBACK_ADDRESS, useReverseGeocode } from "../lib/utils/geocode.js";
import AddressStatus from "./AddressStatus.jsx";

function normalizeCoordinate(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeAddressInput(value) {
  if (typeof value === "string") return value;
  if (value && typeof value === "object") {
    const candidate =
      value.shortAddress || value.formattedAddress || value.address || value.display_name || value.label || null;
    if (typeof candidate === "string") return candidate;
  }
  return "";
}

export default function AddressCell({
  address,
  lat,
  lng,
  loading: externalLoading = false,
  className = "",
  liveLookup = true,
}) {
  const normalizedInput = useMemo(() => normalizeAddressInput(address), [address]);
  const formattedAddress = useMemo(() => formatAddress(normalizedInput || address), [address, normalizedInput]);
  const safeLat = normalizeCoordinate(lat);
  const safeLng = normalizeCoordinate(lng);
  const isUnavailable =
    formattedAddress === "Endereço não disponível" ||
    formattedAddress === "Endereco nao disponivel" ||
    formattedAddress === FALLBACK_ADDRESS;
  const hasAddress = formattedAddress && formattedAddress !== "—" && !isUnavailable;
  const shouldReverse = liveLookup && !hasAddress && Number.isFinite(safeLat) && Number.isFinite(safeLng);

  const { address: reverseAddress, loading, retry } = useReverseGeocode(safeLat, safeLng, {
    enabled: shouldReverse && !externalLoading,
  });

  const fallbackText = shouldReverse ? "Resolvendo endereço..." : "Sem endereço";
  const resolved = hasAddress ? formattedAddress : reverseAddress || fallbackText;
  const shouldRetry = shouldReverse && resolved === FALLBACK_ADDRESS && !externalLoading;
  const displayLoading = externalLoading || (loading && shouldReverse);

  return (
    <AddressStatus
      address={resolved}
      loading={displayLoading}
      lat={safeLat}
      lng={safeLng}
      onRetry={shouldRetry ? retry : null}
      className={`min-w-0 ${className}`}
    />
  );
}
