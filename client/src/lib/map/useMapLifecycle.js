import { useCallback, useEffect, useRef, useState } from "react";
import { MapLifecycleController } from "./MapLifecycleController.js";

export default function useMapLifecycle({ mapRef, containerRef, options } = {}) {
  const controllerRef = useRef(new MapLifecycleController(options));
  const [mapInstance, setMapInstance] = useState(null);
  const resolvedMap = mapRef?.current || mapInstance;

  useEffect(() => {
    if (!resolvedMap) return undefined;
    controllerRef.current.attach({
      map: resolvedMap,
      container: containerRef?.current || resolvedMap.getContainer?.(),
    });
    return () => controllerRef.current.detach();
  }, [resolvedMap, containerRef]);

  const onMapReady = useCallback((event) => {
    const map = event?.target || event;
    if (map) setMapInstance(map);
  }, []);

  const refreshMap = useCallback(() => {
    controllerRef.current.refresh();
  }, []);

  return { onMapReady, refreshMap, map: resolvedMap };
}
