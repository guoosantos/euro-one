export function buildGeofencePayload({ name, shapeType, radius, center, points }) {
  if (shapeType === "polygon" && Array.isArray(points) && points.length >= 3) {
    return {
      name,
      type: "polygon",
      area: points.map((point) => point.join(" ")).join(","),
    };
  }
  const [latitude, longitude] = center || [];
  return {
    name,
    type: "circle",
    radius,
    latitude,
    longitude,
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
