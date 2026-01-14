function normalizePointList(points = []) {
  return (Array.isArray(points) ? points : [])
    .map((pair) => {
      if (!Array.isArray(pair) || pair.length < 2) return null;
      const lat = Number(pair[0]);
      const lng = Number(pair[1]);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
      return [lat, lng];
    })
    .filter(Boolean);
}

function buildCirclePoints({ center, radiusMeters }) {
  if (!center || !Number.isFinite(radiusMeters) || radiusMeters <= 0) return [];
  const [lat, lng] = center;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return [];
  const latRadius = radiusMeters / 111320;
  const lngRadius = radiusMeters / (111320 * Math.cos((lat * Math.PI) / 180));
  const points = [];
  for (let angle = 0; angle <= 360; angle += 15) {
    const rad = (angle * Math.PI) / 180;
    points.push([lat + latRadius * Math.sin(rad), lng + lngRadius * Math.cos(rad)]);
  }
  return points;
}

function buildPreviewSvg(points = [], { stroke = "#38bdf8", fill = "rgba(56,189,248,0.2)", closePath = false } = {}) {
  const normalized = normalizePointList(points);
  if (!normalized.length) return null;
  const width = 160;
  const height = 96;
  const padding = 8;
  const lats = normalized.map((pair) => pair[0]);
  const lngs = normalized.map((pair) => pair[1]);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  const latSpan = maxLat - minLat || 0.0001;
  const lngSpan = maxLng - minLng || 0.0001;
  const scaleX = (width - padding * 2) / lngSpan;
  const scaleY = (height - padding * 2) / latSpan;
  const path = normalized
    .map(([lat, lng], index) => {
      const x = padding + (lng - minLng) * scaleX;
      const y = height - padding - (lat - minLat) * scaleY;
      return `${index === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");
  const closed = closePath ? `${path} Z` : path;
  return `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">
      <rect width="100%" height="100%" fill="#0f172a" />
      <path d="${closed}" fill="${fill}" stroke="${stroke}" stroke-width="2" />
    </svg>
  `.trim();
}

function resolveItemSizeBytes(payload) {
  if (!payload) return null;
  if (payload.kml) return Buffer.byteLength(String(payload.kml));
  if (payload.geometryJson) return Buffer.byteLength(JSON.stringify(payload.geometryJson));
  if (payload.area) return Buffer.byteLength(String(payload.area));
  if (payload.points) return Buffer.byteLength(JSON.stringify(payload.points));
  return null;
}

function resolveItemTypeLabel({ type, geofence }) {
  const isTarget = Boolean(geofence?.isTarget) || type === "target";
  if (type === "route") return "Rota";
  if (isTarget) return "Alvo";
  if (geofence?.config === "exit") return "Saída";
  if (geofence?.config === "entry") return "Entrada";
  return "Cerca";
}

export function buildItineraryItemSnapshots({ itinerary, geofencesById, routesById } = {}) {
  if (!itinerary) return [];
  const items = Array.isArray(itinerary.items) ? itinerary.items : [];
  return items
    .map((item) => {
      const type = item?.type || "";
      const id = item?.id ? String(item.id) : null;
      if (!type || !id) return null;
      const geofence = type === "geofence" || type === "target" ? geofencesById?.get(id) || null : null;
      const route = type === "route" ? routesById?.get(id) || null : null;
      const circleCenter =
        geofence?.type === "circle"
          ? [geofence.latitude ?? geofence.center?.[0], geofence.longitude ?? geofence.center?.[1]]
          : null;
      const circlePoints =
        geofence?.type === "circle"
          ? buildCirclePoints({
              center: circleCenter,
              radiusMeters: geofence?.radius,
            })
          : [];
      const points =
        type === "route"
          ? route?.points || []
          : geofence?.type === "circle"
            ? circlePoints
            : geofence?.points || [];
      const color = geofence?.color || route?.color || "#38bdf8";
      const previewSvg = buildPreviewSvg(points, {
        stroke: color,
        closePath: type !== "route",
      });
      return {
        id,
        type,
        name: geofence?.name || route?.name || "Item",
        typeLabel: resolveItemTypeLabel({ type, geofence }),
        sizeBytes: resolveItemSizeBytes(geofence || route),
        previewSvg,
        previewUrl: geofence?.previewUrl || route?.previewUrl || null,
        geometry: {
          points,
          center: geofence?.type === "circle" ? circleCenter : null,
          radiusMeters: geofence?.type === "circle" ? geofence?.radius || null : null,
          color,
          isRoute: type === "route",
        },
      };
    })
    .filter(Boolean);
}

export function buildItinerarySnapshot({ itinerary, geofencesById, routesById, payload, response, error, action, requestedByName } = {}) {
  if (!itinerary) return null;
  const items = buildItineraryItemSnapshots({ itinerary, geofencesById, routesById });
  return {
    createdAt: new Date().toISOString(),
    action: action || null,
    requestedByName: requestedByName || null,
    itinerary: {
      id: itinerary.id != null ? String(itinerary.id) : null,
      name: itinerary.name || null,
      description: itinerary.description || null,
      items: Array.isArray(itinerary.items) ? itinerary.items : [],
    },
    items,
    request: payload || null,
    response: response || null,
    error: error || null,
  };
}

export default {
  buildItineraryItemSnapshots,
  buildItinerarySnapshot,
};
