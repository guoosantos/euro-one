export function extractCoordinates(event = {}) {
  const latCandidates = [
    event.lat,
    event.latitude,
    event?.position?.lat,
    event?.position?.latitude,
    event?.attributes?.lat,
    event?.attributes?.latitude,
    event?.geofence?.latitude,
    event?.geofence?.lat,
    event?.geofence?.center?.lat,
  ];
  const lonCandidates = [
    event.lon,
    event.lng,
    event.longitude,
    event?.position?.lon,
    event?.position?.lng,
    event?.position?.longitude,
    event?.attributes?.lon,
    event?.attributes?.lng,
    event?.attributes?.longitude,
    event?.geofence?.longitude,
    event?.geofence?.lng,
    event?.geofence?.center?.lng,
  ];

  const lat = latCandidates.find((v) => Number.isFinite(Number(v)));
  const lng = lonCandidates.find((v) => Number.isFinite(Number(v)));
  if (lat === undefined || lng === undefined) return null;

  return {
    lat: Number(lat),
    lng: Number(lng),
  };
}

export function aggregateHeatmapEvents(events = [], { precision = 5 } = {}) {
  const buckets = new Map();
  events.forEach((event) => {
    const coords = extractCoordinates(event);
    if (!coords) return;
    const key = `${coords.lat.toFixed(precision)},${coords.lng.toFixed(precision)}`;
    const current = buckets.get(key) ?? { ...coords, count: 0 };
    current.count += 1;
    buckets.set(key, current);
  });
  return Array.from(buckets.values());
}

export function rankHeatmapZones(points = [], limit = 10) {
  return [...points]
    .sort((a, b) => (b.count || 0) - (a.count || 0))
    .slice(0, limit);
}
