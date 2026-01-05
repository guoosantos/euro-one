import React, { useMemo } from "react";
import { formatAddress } from "../lib/format-address.js";
import { FALLBACK_ADDRESS } from "../lib/utils/geocode.js";
import AddressStatus from "./AddressStatus.jsx";

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
  loading: externalLoading = false,
  className = "",
  geocodeStatus = null,
}) {
  const normalizedInput = useMemo(() => normalizeAddressInput(address), [address]);
  const formattedAddress = useMemo(() => formatAddress(normalizedInput || address), [address, normalizedInput]);
  const isUnavailable =
    formattedAddress === "Endereço não disponível" ||
    formattedAddress === "Endereco nao disponivel" ||
    formattedAddress === FALLBACK_ADDRESS;
  const hasAddress = formattedAddress && formattedAddress !== "—" && !isUnavailable;
  const isPending = geocodeStatus === "pending";
  const resolved = hasAddress ? formattedAddress : null;
  const displayLoading = externalLoading || isPending;

  return (
    <AddressStatus address={resolved} loading={displayLoading} className={`min-w-0 ${className}`} />
  );
}
