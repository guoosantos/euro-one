import { useEffect } from "react";
import L from "leaflet";

export default function useMapDataRefresh(
  mapRef,
  { markers = [], layers = [], selectedMarkerId = null, markerRefs = null } = {},
) {
  useEffect(() => {
    const map = mapRef?.current;
    if (!map || !map._loaded || !map._mapPane) return;
    const container = map.getContainer?.();
    if (!container || container.isConnected === false) return;

    if (markerRefs?.current) {
      markers.forEach((marker) => {
        const id = marker?.id ?? marker?.deviceId ?? null;
        const lat = Number(marker?.lat);
        const lng = Number(marker?.lng);
        if (!id || !Number.isFinite(lat) || !Number.isFinite(lng)) return;
        const markerInstance = markerRefs.current.get(id);
        if (!markerInstance?.setLatLng) return;
        const nextLatLng = L.latLng(lat, lng);
        const currentLatLng = markerInstance.getLatLng?.();
        if (!currentLatLng || !currentLatLng.equals(nextLatLng)) {
          markerInstance.setLatLng(nextLatLng);
        }
      });
    }

    const selectedMarker = selectedMarkerId && markerRefs?.current?.get(selectedMarkerId);
    if (selectedMarker?.isPopupOpen?.() || selectedMarker?.isTooltipOpen?.()) {
      selectedMarker.update?.();
    }

    const size = map.getSize?.();
    if (size && (size.x === 0 || size.y === 0)) {
      const rafId = requestAnimationFrame(() => {
        if (mapRef?.current !== map) return;
        if (!map._loaded || !map._mapPane) return;
        const rect = container.getBoundingClientRect?.();
        if (!rect || rect.width <= 0 || rect.height <= 0) return;
        map.invalidateSize?.({ pan: false });
      });
      return () => cancelAnimationFrame(rafId);
    }
    return undefined;
  }, [mapRef, markers, layers, selectedMarkerId, markerRefs]);
}
