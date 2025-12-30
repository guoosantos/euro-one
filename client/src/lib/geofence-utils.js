export function buildGeofencePayload({ name, shapeType, radius, center, points, attributes, isTarget }) {
  if (shapeType === "polygon" && Array.isArray(points) && points.length >= 3) {
    return {
      name,
      type: "polygon",
      area: points.map((point) => point.join(" ")).join(","),
      isTarget: Boolean(isTarget),
      ...(attributes ? { attributes } : {}),
    };
  }
  const [latitude, longitude] = center || [];
  return {
    name,
    type: "circle",
    radius,
    latitude,
    longitude,
    isTarget: Boolean(isTarget),
    ...(attributes ? { attributes } : {}),
  };
}

export function decodeGeofencePolygon(area) {
  if (!area) return [];
  return area
    .split(",")
    .map((segment) => segment.trim().split(" "))
    .filter((parts) => parts.length === 2)
    .map(([lat, lon]) => [Number(lat), Number(lon)]);
}
