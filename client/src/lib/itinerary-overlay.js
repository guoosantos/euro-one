const METERS_PER_LAT = 111320;

function normalizeGeoJsonGeometry(input) {
  if (!input) return null;
  if (input.type === "Feature" && input.geometry) return input.geometry;
  if (input.geometry && input.type) return input.geometry;
  if (input.type && input.coordinates) return input;
  return null;
}

function normalizeGeoJsonProperties(input) {
  if (!input) return {};
  if (input.type === "Feature") return input.properties || {};
  return input.properties || {};
}

function toLatLngPairs(coordinates = []) {
  return coordinates
    .map((pair) => {
      if (!Array.isArray(pair) || pair.length < 2) return null;
      const lng = Number(pair[0]);
      const lat = Number(pair[1]);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
      return [lat, lng];
    })
    .filter(Boolean);
}

export function extractLineLatLngs(input) {
  const geometry = normalizeGeoJsonGeometry(input);
  if (!geometry) return [];
  if (geometry.type === "LineString") {
    return [toLatLngPairs(geometry.coordinates)];
  }
  if (geometry.type === "MultiLineString") {
    return geometry.coordinates.map((line) => toLatLngPairs(line)).filter((line) => line.length);
  }
  return [];
}

export function extractPolygonLatLngs(input) {
  const geometry = normalizeGeoJsonGeometry(input);
  if (!geometry) return [];
  if (geometry.type === "Polygon") {
    const ring = geometry.coordinates?.[0] || [];
    const parsed = toLatLngPairs(ring);
    return parsed.length ? [parsed] : [];
  }
  if (geometry.type === "MultiPolygon") {
    return geometry.coordinates
      .map((polygon) => toLatLngPairs(polygon?.[0] || []))
      .filter((ring) => ring.length);
  }
  return [];
}

function toMeters(point, referenceLat) {
  const lat = Number(point?.[0]);
  const lng = Number(point?.[1]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const metersPerLon = METERS_PER_LAT * Math.cos((referenceLat * Math.PI) / 180);
  return { x: lng * metersPerLon, y: lat * METERS_PER_LAT };
}

function fromMeters(point, referenceLat) {
  const x = Number(point?.x);
  const y = Number(point?.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const metersPerLon = METERS_PER_LAT * Math.cos((referenceLat * Math.PI) / 180);
  if (!Number.isFinite(metersPerLon) || metersPerLon === 0) return null;
  return [y / METERS_PER_LAT, x / metersPerLon];
}

function normalizeVector(vector) {
  const x = Number(vector?.x);
  const y = Number(vector?.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const length = Math.hypot(x, y);
  if (!length) return null;
  return { x: x / length, y: y / length };
}

function buildCorridorForLine(line = [], bufferMeters) {
  if (!Array.isArray(line) || line.length < 2) return null;
  const meters = Number(bufferMeters);
  if (!Number.isFinite(meters) || meters <= 0) return null;
  const referenceLat = Number(line[0]?.[0]);
  if (!Number.isFinite(referenceLat)) return null;

  const points = line.map((point) => toMeters(point, referenceLat)).filter(Boolean);
  if (points.length < 2) return null;

  const segmentNormals = [];
  for (let i = 0; i < points.length - 1; i += 1) {
    const start = points[i];
    const end = points[i + 1];
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const dir = normalizeVector({ x: dx, y: dy });
    if (!dir) {
      segmentNormals.push(null);
      continue;
    }
    segmentNormals.push({ x: -dir.y, y: dir.x });
  }

  const leftSide = [];
  const rightSide = [];
  let lastNormal = null;

  for (let i = 0; i < points.length; i += 1) {
    let normal = null;
    if (i === 0) {
      normal = segmentNormals[0];
    } else if (i === points.length - 1) {
      normal = segmentNormals[segmentNormals.length - 1];
    } else {
      const prev = segmentNormals[i - 1];
      const next = segmentNormals[i];
      if (prev && next) {
        normal = normalizeVector({ x: prev.x + next.x, y: prev.y + next.y });
      } else {
        normal = prev || next || null;
      }
    }
    if (!normal) {
      normal = lastNormal;
    }
    if (!normal) {
      continue;
    }
    lastNormal = normal;
    const base = points[i];
    const left = { x: base.x + normal.x * meters, y: base.y + normal.y * meters };
    const right = { x: base.x - normal.x * meters, y: base.y - normal.y * meters };
    const leftLatLng = fromMeters(left, referenceLat);
    const rightLatLng = fromMeters(right, referenceLat);
    if (leftLatLng) leftSide.push(leftLatLng);
    if (rightLatLng) rightSide.push(rightLatLng);
  }

  if (leftSide.length < 2 || rightSide.length < 2) return null;
  return [...leftSide, ...rightSide.reverse()];
}

export function buildRouteCorridorPolygons(routeLines = [], bufferMeters) {
  const meters = Number(bufferMeters);
  if (!Number.isFinite(meters) || meters <= 0) return [];
  const polygons = [];
  (Array.isArray(routeLines) ? routeLines : []).forEach((line) => {
    const polygon = buildCorridorForLine(line, meters);
    if (polygon && polygon.length > 3) {
      polygons.push(polygon);
    }
  });
  return polygons;
}

function distanceToSegmentMeters(point, segmentStart, segmentEnd, referenceLat) {
  const p = toMeters(point, referenceLat);
  const a = toMeters(segmentStart, referenceLat);
  const b = toMeters(segmentEnd, referenceLat);
  if (!p || !a || !b) return Infinity;

  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (!dx && !dy) {
    return Math.hypot(p.x - a.x, p.y - a.y);
  }
  const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy);
  const clamped = Math.max(0, Math.min(1, t));
  const closestX = a.x + clamped * dx;
  const closestY = a.y + clamped * dy;
  return Math.hypot(p.x - closestX, p.y - closestY);
}

export function distanceToRouteMeters(point, lines = []) {
  if (!point) return Infinity;
  const referenceLat = Number(point[0]);
  if (!Number.isFinite(referenceLat)) return Infinity;
  let min = Infinity;
  lines.forEach((line) => {
    if (!Array.isArray(line) || line.length < 2) return;
    for (let i = 0; i < line.length - 1; i += 1) {
      const dist = distanceToSegmentMeters(point, line[i], line[i + 1], referenceLat);
      if (dist < min) min = dist;
    }
  });
  return min;
}

function isPointInRing(point, ring) {
  if (!Array.isArray(ring) || ring.length < 3) return false;
  const x = Number(point?.[1]);
  const y = Number(point?.[0]);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = Number(ring[i][1]);
    const yi = Number(ring[i][0]);
    const xj = Number(ring[j][1]);
    const yj = Number(ring[j][0]);
    if (!Number.isFinite(xi) || !Number.isFinite(yi) || !Number.isFinite(xj) || !Number.isFinite(yj)) continue;
    const intersects = (yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

export function buildOverlayShapes(overlay) {
  const routeLines = extractLineLatLngs(overlay?.route || null);
  const rawGeofences = Array.isArray(overlay?.geofences) ? overlay.geofences : [];
  const geofences = rawGeofences
    .map((item, index) => {
      const geometry = normalizeGeoJsonGeometry(item);
      const polygons = extractPolygonLatLngs(geometry);
      if (!polygons.length) return null;
      const properties = normalizeGeoJsonProperties(item);
      return {
        id: properties.id || item?.id || `geofence-${index + 1}`,
        name: properties.name || item?.name || `Cerca ${index + 1}`,
        polygons,
      };
    })
    .filter(Boolean);

  const checkpoints = Array.isArray(overlay?.checkpoints)
    ? overlay.checkpoints
        .map((checkpoint) => {
          const lat = Number(checkpoint?.lat);
          const lng = Number(checkpoint?.lng);
          if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
          return { name: checkpoint?.name || "Ponto", lat, lng };
        })
        .filter(Boolean)
    : [];

  return { routeLines, geofences, checkpoints };
}

export function findContainingGeofence(point, geofences = []) {
  if (!point || !Array.isArray(geofences)) return null;
  for (const geofence of geofences) {
    const polygons = geofence?.polygons || [];
    for (const ring of polygons) {
      if (isPointInRing(point, ring)) {
        return geofence;
      }
    }
  }
  return null;
}

export default {
  extractLineLatLngs,
  extractPolygonLatLngs,
  distanceToRouteMeters,
  buildOverlayShapes,
  buildRouteCorridorPolygons,
  findContainingGeofence,
};
