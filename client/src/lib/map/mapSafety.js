export function canInteractWithMap(map, containerOverride = null) {
  if (!map || !map._loaded || !map._mapPane) return false;
  const container = containerOverride || map.getContainer?.();
  if (!container || container.isConnected === false) return false;
  const rect = container.getBoundingClientRect?.();
  if (!rect || rect.width <= 0 || rect.height <= 0) return false;
  return true;
}

export function resolveMapContainer(map, containerOverride = null) {
  return containerOverride || map?.getContainer?.() || null;
}
