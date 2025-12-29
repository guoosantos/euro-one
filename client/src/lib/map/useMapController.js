import { useCallback } from "react";

import useLeafletFocus from "../hooks/useLeafletFocus.js";

export default function useMapController({ page } = {}) {
  const { registerMap, focusLatLng, focusGeometry, fitBounds } = useLeafletFocus({ page });

  const focusDevice = useCallback(
    (device, options = {}) => {
      if (!device) return false;
      const lat = Number(device.lat ?? device.latitude);
      const lng = Number(device.lng ?? device.lon ?? device.longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
      return focusLatLng({ lat, lng, zoom: options.zoom, animate: options.animate, reason: options.reason || "DEVICE_SELECT" });
    },
    [focusLatLng],
  );

  const focusBounds = useCallback(
    (bounds, options = {}, reason = "BOUNDS_SELECT") => fitBounds(bounds, options, reason),
    [fitBounds],
  );

  return {
    registerMap,
    focusDevice,
    focusGeometry,
    focusBounds,
  };
}
