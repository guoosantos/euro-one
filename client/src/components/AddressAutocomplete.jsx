import React, { useCallback, useEffect, useMemo, useState } from "react";

import useGeocodeSearch from "../lib/hooks/useGeocodeSearch.js";
import { formatSuggestion, toAddressValue } from "../lib/address/autocomplete.js";
import LocationSearch from "./map/LocationSearch.jsx";

const EMPTY_RESULTS_MESSAGE = "Nenhum resultado encontrado.";
const FRIENDLY_ERROR_MESSAGE = "Não foi possível buscar endereço. Tente novamente.";

function resolveQuery(value, fallback = "") {
  if (value === null || value === undefined) return fallback;
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (typeof value === "object") {
    if (typeof value.formattedAddress === "string") return value.formattedAddress;
    if (typeof value.formatted_address === "string") return value.formatted_address;
  }
  return formatSuggestion(value, fallback);
}

function resolveErrorMessage(error, externalError) {
  if (externalError) {
    if (typeof externalError === "string") return externalError;
    return FRIENDLY_ERROR_MESSAGE;
  }
  if (!error) return "";
  if (error?.message === EMPTY_RESULTS_MESSAGE) return "";
  return FRIENDLY_ERROR_MESSAGE;
}

function resolveEmptyMessage(error) {
  if (error?.message === EMPTY_RESULTS_MESSAGE) return EMPTY_RESULTS_MESSAGE;
  return "";
}

export default function AddressAutocomplete({
  value,
  onChange,
  onSelect,
  onClear,
  label = "Endereço",
  placeholder = "Buscar endereço",
  disabled = false,
  error = null,
  helperText = "",
  country,
  debounceMs = 320,
  mapPreferences = null,
  variant = "toolbar",
  floating = false,
  containerClassName = "",
  portalSuggestions = true,
  inputClassName = "",
}) {
  const [query, setQuery] = useState(() => resolveQuery(value, ""));
  const [hasInteracted, setHasInteracted] = useState(false);
  const { suggestions, isSearching, searchRegion, clearSuggestions, previewSuggestions, error: searchError } =
    useGeocodeSearch(mapPreferences, { debounceMs, country });

  useEffect(() => {
    const resolved = resolveQuery(value, "");
    if (resolved === query) return;
    setQuery(resolved);
  }, [query, value]);

  useEffect(() => {
    if (disabled) return;
    if (!hasInteracted) return;
    if (query.trim()) {
      previewSuggestions(query);
    } else {
      clearSuggestions();
    }
  }, [clearSuggestions, disabled, hasInteracted, previewSuggestions, query]);

  useEffect(() => {
    if (!searchError || searchError?.message === EMPTY_RESULTS_MESSAGE) return;
    console.warn("[address-autocomplete] search error", searchError);
  }, [searchError]);

  const handleChange = useCallback(
    (eventOrValue) => {
      const nextValue = eventOrValue?.target?.value ?? eventOrValue ?? "";
      const nextQuery = String(nextValue);
      setQuery(nextQuery);
      setHasInteracted(true);
      // Preserve typed spaces while editing; normalization happens on selection.
      onChange?.({ formattedAddress: nextQuery });
    },
    [onChange],
  );

  const handleSelectSuggestion = useCallback(
    (option) => {
      if (!option) return;
      const next = toAddressValue(option);
      setQuery(next.formattedAddress || "");
      setHasInteracted(true);
      onChange?.(next);
      onSelect?.(next);
    },
    [onChange, onSelect],
  );

  const handleSubmit = useCallback(async () => {
    const result = await searchRegion(query);
    if (result) {
      handleSelectSuggestion(result);
    }
  }, [handleSelectSuggestion, query, searchRegion]);

  const handleClear = useCallback(() => {
    setQuery("");
    clearSuggestions();
    setHasInteracted(true);
    onChange?.({ formattedAddress: "" });
    onClear?.();
  }, [clearSuggestions, onChange, onClear]);

  const resolvedErrorMessage = useMemo(
    () => resolveErrorMessage(searchError, error),
    [error, searchError],
  );
  const emptyMessage = useMemo(() => resolveEmptyMessage(searchError), [searchError]);

  const wrapperClassName = containerClassName ? `space-y-2 ${containerClassName}` : "space-y-2";
  const inputContainerClassName = containerClassName || "w-full";

  return (
    <div className={wrapperClassName}>
      {label ? <span className="block text-xs uppercase tracking-wide text-white/60">{label}</span> : null}
      <LocationSearch
        value={query}
        onChange={handleChange}
        onSubmit={handleSubmit}
        suggestions={suggestions}
        onSelectSuggestion={handleSelectSuggestion}
        isSearching={isSearching}
        errorMessage={resolvedErrorMessage}
        emptyMessage={emptyMessage}
        placeholder={placeholder}
        variant={variant}
        floating={floating}
        containerClassName={inputContainerClassName}
        portalSuggestions={portalSuggestions}
        onClear={handleClear}
        inputClassName={inputClassName}
        disabled={disabled}
      />
      {helperText && !resolvedErrorMessage ? (
        <span className="text-[11px] text-white/50">{helperText}</span>
      ) : null}
    </div>
  );
}
