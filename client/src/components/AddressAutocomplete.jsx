import React, { useEffect } from "react";

import AddressSearchInput, { useAddressSearchState } from "./shared/AddressSearchInput.jsx";

export default function AddressAutocomplete({
  label = "Endereço",
  placeholder = "Digite um endereço",
  initialValue = "",
  value,
  onSelect,
  onClear,
  variant = "toolbar",
  containerClassName = "",
  portalSuggestions = false,
}) {
  const state = useAddressSearchState({ initialValue: value ?? initialValue });

  useEffect(() => {
    if (value === undefined || value === state.query) return;
    state.setQuery(value);
  }, [state, value]);

  return (
    <div className={containerClassName ? `space-y-2 ${containerClassName}` : "space-y-2"}>
      {label ? <span className="block text-xs uppercase tracking-wide text-white/60">{label}</span> : null}
      <AddressSearchInput
        state={state}
        onSelect={onSelect}
        onClear={onClear}
        placeholder={placeholder}
        variant={variant}
        containerClassName="w-full"
        portalSuggestions={portalSuggestions}
      />
    </div>
  );
}
