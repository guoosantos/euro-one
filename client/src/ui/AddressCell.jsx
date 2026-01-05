import React, { useMemo } from "react";
import { formatAddress } from "../lib/format-address.js";
import { FALLBACK_ADDRESS, useReverseGeocode } from "../lib/utils/geocode.js";
import AddressStatus from "./AddressStatus.jsx";

function normalizeCoordinate(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export default function AddressCell({ address, lat, lng, loading: externalLoading = false, className = "" }) {
  const formattedAddress = useMemo(() => formatAddress(address), [address]);
  const safeLat = normalizeCoordinate(lat);
  const safeLng = normalizeCoordinate(lng);
  const isUnavailable =
    formattedAddress === "Endereço não disponível" ||
    formattedAddress === "Endereco nao disponivel" ||
    formattedAddress === FALLBACK_ADDRESS;
  const isMissingAddress = formattedAddress === "—" || isUnavailable;
  const shouldReverse = isMissingAddress && Number.isFinite(safeLat) && Number.isFinite(safeLng);

  const { address: reverseAddress, loading, retry } = useReverseGeocode(safeLat, safeLng, {
    enabled: shouldReverse && !externalLoading,
  });

  const resolved = !isMissingAddress ? formattedAddress : reverseAddress || "";
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
