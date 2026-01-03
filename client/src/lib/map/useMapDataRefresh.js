import { useEffect } from "react";
import L from "leaflet";

export default function useMapDataRefresh(
  mapRef,
  { markers = [], layers = [], selectedMarkerId = null, markerRefs = null } = {},
) {
  useEffect(() => {
    const map = mapRef?.current;
    if (!map) return;

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
      map.invalidateSize?.({ pan: false });
    }
  }, [mapRef, markers, layers, selectedMarkerId, markerRefs]);
}
