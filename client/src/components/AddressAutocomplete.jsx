import React, { useEffect, useRef, useState } from "react";

import { loadGooglePlaces } from "../lib/google";

export default function AddressAutocomplete({
  label = "Endereço",
  onSelect,
  placeholder = "Digite um endereço",
}) {
  const [ready, setReady] = useState(false);
  const [query, setQuery] = useState("");
  const [items, setItems] = useState([]);
  const [highlightIndex, setHighlightIndex] = useState(-1);
  const serviceRef = useRef(null);
  const placesRef = useRef(null);
  const mapDiv = useRef(null);

  useEffect(() => {
    loadGooglePlaces().then((g) => {
      if (!g) return;
      serviceRef.current = new g.maps.places.AutocompleteService();
      const map = new g.maps.Map(mapDiv.current || document.createElement("div"));
      placesRef.current = new g.maps.places.PlacesService(map);
      setReady(true);
    });
  }, []);

  useEffect(() => {
    const service = serviceRef.current;
    if (!service || !query) {
      setItems([]);
      setHighlightIndex(-1);
      return;
    }
    service.getPlacePredictions(
      { input: query, componentRestrictions: { country: ["br"] } },
      (pred = []) => {
        setItems(pred);
        setHighlightIndex(-1);
      },
    );
  }, [query]);

  const pick = (item) => {
    const places = placesRef.current;
    if (!places) {
      setQuery(item.description);
      onSelect?.({ address: item.description, placeId: item.place_id });
      setItems([]);
      return;
    }
    places.getDetails(
      { placeId: item.place_id, fields: ["geometry", "formatted_address", "place_id"] },
      (details) => {
        if (!details?.formatted_address) return;
        const loc = details?.geometry?.location;
        onSelect?.({
          address: details.formatted_address,
          placeId: details.place_id || item.place_id,
          lat: loc?.lat?.(),
          lng: loc?.lng?.(),
        });
        setQuery(details.formatted_address);
        setItems([]);
        setHighlightIndex(-1);
      },
    );
  };

  const handleKeyDown = (event) => {
    if (!items.length) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlightIndex((prev) => Math.min(items.length - 1, prev < 0 ? 0 : prev + 1));
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlightIndex((prev) => (prev <= 0 ? -1 : prev - 1));
    }
    if (event.key === "Enter") {
      if (highlightIndex < 0) return;
      event.preventDefault();
      const selected = items[highlightIndex];
      if (selected) pick(selected);
    }
    if (event.key === "Escape") {
      setItems([]);
      setHighlightIndex(-1);
    }
  };

  return (
    <div className="lwrap relative">
      <span className="legend">{label}</span>
      <input
        className="linput"
        placeholder={placeholder}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={handleKeyDown}
      />
      {!!items.length && ready && (
        <div className="absolute left-0 right-0 z-30 mt-2 max-h-64 overflow-auto rounded-xl border border-stroke bg-bg">
          {items.map((item, index) => (
            <div
              key={item.place_id}
              className={`cursor-pointer px-3 py-2 text-sm hover:bg-card ${
                index === highlightIndex ? "bg-card" : ""
              }`}
              onMouseDown={() => pick(item)}
              onMouseEnter={() => setHighlightIndex(index)}
            >
              {item.description}
            </div>
          ))}
        </div>
      )}
      <div ref={mapDiv} style={{ display: "none" }} />
    </div>
  );
}
