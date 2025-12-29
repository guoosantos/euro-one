import React, { useCallback, useEffect, useMemo, useState } from "react";

import useGeocodeSearch from "../../lib/hooks/useGeocodeSearch.js";
import LocationSearch from "../map/LocationSearch.jsx";

export function useAddressSearchState({ initialValue = "Brasil", mapPreferences = null } = {}) {
  const [query, setQuery] = useState(initialValue);
  const [hasInteracted, setHasInteracted] = useState(false);
  const { suggestions, isSearching, searchRegion, clearSuggestions, previewSuggestions, error } = useGeocodeSearch(mapPreferences);

  const handleChange = useCallback((eventOrValue) => {
    const nextValue = eventOrValue?.target?.value ?? eventOrValue ?? "";
    setQuery(String(nextValue));
    setHasInteracted(true);
  }, []);

  const handleSelectSuggestion = useCallback((option) => {
    if (!option) return null;
    setQuery(option.concise || option.label || option.address || "");
    setHasInteracted(true);
    return option;
  }, []);

  const handleSubmit = useCallback(async () => {
    const term = query?.trim();
    if (!term) return null;
    setHasInteracted(true);
    const result = await searchRegion(term);
    if (result) {
      setQuery(result.concise || result.label || term);
    }
    return result;
  }, [query, searchRegion]);

  const handleClear = useCallback(() => {
    setQuery("");
    clearSuggestions();
    setHasInteracted(true);
  }, [clearSuggestions]);

  useEffect(() => {
    if (!hasInteracted) return;
    if (query.trim()) {
      previewSuggestions(query);
    } else {
      clearSuggestions();
    }
  }, [clearSuggestions, hasInteracted, previewSuggestions, query]);

  return useMemo(() => ({
    query,
    setQuery,
    suggestions,
    isSearching,
    error,
    onChange: handleChange,
    onSubmit: handleSubmit,
    onSelectSuggestion: handleSelectSuggestion,
    onClear: handleClear,
  }), [error, handleChange, handleClear, handleSelectSuggestion, handleSubmit, isSearching, query, suggestions]);
}

export default function AddressSearchInput({
  state,
  onSelect,
  onClear,
  placeholder = "Buscar endereço ou coordenada",
  containerClassName = "",
  floating = false,
  variant = "map",
}) {
  const handleSelect = useCallback(
    (option) => {
      const selected = state?.onSelectSuggestion?.(option) ?? option;
      if (selected) {
        onSelect?.(selected);
      }
    },
    [onSelect, state],
  );

  const handleSubmit = useCallback(async () => {
    const result = await state?.onSubmit?.();
    if (result) {
      onSelect?.(result);
    }
  }, [onSelect, state]);

  const handleClear = useCallback(() => {
    state?.onClear?.();
    onClear?.();
  }, [onClear, state]);

  if (!state) return null;

  return (
    <LocationSearch
      value={state.query}
      onChange={state.onChange}
      onSubmit={handleSubmit}
      suggestions={state.suggestions}
      onSelectSuggestion={handleSelect}
      isSearching={state.isSearching}
      errorMessage={state.error?.message}
      placeholder={placeholder}
      containerClassName={containerClassName}
      floating={floating}
      variant={variant}
      onClear={handleClear}
    />
  );
}
