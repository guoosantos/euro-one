import React, { useEffect, useState } from "react";
import { useMap } from "react-leaflet";

export default function MapZoomControls({ variant = "classic", className = "" }) {
  const map = useMap();
  const [zoom, setZoom] = useState(map?.getZoom?.() ?? 0);

  useEffect(() => {
    if (!map) return undefined;
    const handleZoom = () => {
      setZoom(map.getZoom?.() ?? 0);
    };
    handleZoom();
    map.on("zoomend", handleZoom);
    return () => map.off("zoomend", handleZoom);
  }, [map]);

  const minZoom = map?.getMinZoom?.() ?? 0;
  const maxZoom = map?.getMaxZoom?.() ?? 22;
  const canZoomIn = zoom < maxZoom;
  const canZoomOut = zoom > minZoom;

  return (
    <div className={`map-zoom-controls map-zoom-controls--${variant} ${className}`.trim()}>
      <button
        type="button"
        className="map-tool-button map-zoom-button"
        onClick={() => map?.zoomIn?.()}
        disabled={!canZoomIn}
        title="Aproximar"
        aria-label="Aproximar"
      >
        +
      </button>
      <button
        type="button"
        className="map-tool-button map-zoom-button"
        onClick={() => map?.zoomOut?.()}
        disabled={!canZoomOut}
        title="Afastar"
        aria-label="Afastar"
      >
        −
      </button>
    </div>
  );
}
