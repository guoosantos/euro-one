import React, { useEffect, useState } from "react";

export default function MapToolbar({ map, className = "", children, showZoom = true }) {
  const [zoom, setZoom] = useState(map?.getZoom?.() ?? 0);

  useEffect(() => {
    if (!map) return undefined;
    const handleZoom = () => setZoom(map.getZoom?.() ?? 0);
    handleZoom();
    map.on("zoomend", handleZoom);
    return () => map.off("zoomend", handleZoom);
  }, [map]);

  const minZoom = map?.getMinZoom?.() ?? 0;
  const maxZoom = map?.getMaxZoom?.() ?? 22;
  const canZoomIn = zoom < maxZoom;
  const canZoomOut = zoom > minZoom;

  return (
    <div className={`map-toolbar ${className}`.trim()}>
      {children}
      {showZoom && (
        <div className="map-toolbar-zoom">
          <button
            type="button"
            className="map-tool-button map-toolbar-zoom-button"
            onClick={() => map?.zoomIn?.()}
            disabled={!map || !canZoomIn}
            title="Aproximar"
            aria-label="Aproximar"
          >
            +
          </button>
          <button
            type="button"
            className="map-tool-button map-toolbar-zoom-button"
            onClick={() => map?.zoomOut?.()}
            disabled={!map || !canZoomOut}
            title="Afastar"
            aria-label="Afastar"
          >
            −
          </button>
        </div>
      )}
    </div>
  );
}
