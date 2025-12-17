const XML_HEADER = '<?xml version="1.0" encoding="UTF-8"?>';

function buildDocument(placemarks = []) {
  return [XML_HEADER, '<kml xmlns="http://www.opengis.net/kml/2.2">', "<Document>", ...placemarks, "</Document>", "</kml>"].join("");
}

function formatCoordinates(points = []) {
  return points
    .filter((pair) => Array.isArray(pair) && pair.length >= 2)
    .map(([lat, lon]) => `${Number(lon).toFixed(6)},${Number(lat).toFixed(6)},0`)
    .join(" ");
}

function closePolygon(points = []) {
  if (!points.length) return points;
  const [firstLat, firstLon] = points[0];
  const [lastLat, lastLon] = points[points.length - 1];
  if (firstLat === lastLat && firstLon === lastLon) return points;
  return [...points, [firstLat, firstLon]];
}

export function approximateCirclePoints(center, radiusMeters, segments = 48) {
  if (!Array.isArray(center) || center.length < 2 || !radiusMeters) return [];
  const [lat, lon] = center;
  const earthRadius = 6_371_000; // metros
  const angularDistance = radiusMeters / earthRadius;
  const points = [];

  for (let i = 0; i < segments; i += 1) {
    const bearing = (2 * Math.PI * i) / segments;
    const latRad = (lat * Math.PI) / 180;
    const lonRad = (lon * Math.PI) / 180;
    const pointLat =
      Math.asin(
        Math.sin(latRad) * Math.cos(angularDistance) +
          Math.cos(latRad) * Math.sin(angularDistance) * Math.cos(bearing),
      ) *
      (180 / Math.PI);
    const pointLon =
      (lonRad +
        Math.atan2(
          Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(latRad),
          Math.cos(angularDistance) - Math.sin(latRad) * Math.sin(pointLat * (Math.PI / 180)),
        )) *
      (180 / Math.PI);
    points.push([pointLat, pointLon]);
  }

  return closePolygon(points);
}

export function buildGeofencesKml(geofences = []) {
  const placemarks = geofences.map((fence, index) => {
    const name = fence?.name || `Geofence ${index + 1}`;
    const description = fence?.description || "";
    let polygonPoints = [];

    if (fence?.type === "circle" && fence?.radius && fence?.latitude != null && fence?.longitude != null) {
      polygonPoints = approximateCirclePoints([Number(fence.latitude), Number(fence.longitude)], Number(fence.radius));
    } else {
      polygonPoints = closePolygon(fence?.points || []);
    }

    const coordinates = formatCoordinates(polygonPoints);
    return `
      <Placemark>
        <name>${name}</name>
        <description>${description}</description>
        <Polygon>
          <outerBoundaryIs>
            <LinearRing>
              <coordinates>${coordinates}</coordinates>
            </LinearRing>
          </outerBoundaryIs>
        </Polygon>
      </Placemark>
    `;
  });

  return buildDocument(placemarks);
}

export function buildRoutesKml(routes = []) {
  const placemarks = routes.map((route, index) => {
    const name = route?.name || `Rota ${index + 1}`;
    const coordinates = formatCoordinates(route?.points || []);
    return `
      <Placemark>
        <name>${name}</name>
        <LineString>
          <coordinates>${coordinates}</coordinates>
        </LineString>
      </Placemark>
    `;
  });

  return buildDocument(placemarks);
}

function parseCoordinates(rawText = "") {
  if (!rawText) return [];
  return rawText
    .trim()
    .split(/\s+/)
    .map((chunk) => chunk.split(",").slice(0, 2).map((value) => Number(value)))
    .filter((pair) => pair.length === 2 && pair.every((v) => Number.isFinite(v)))
    .map(([lon, lat]) => [lat, lon]);
}

function extractPlacemarks(kmlText = "") {
  if (!kmlText) return [];
  const matches = Array.from(kmlText.matchAll(/<Placemark[\s\S]*?<\/Placemark>/gi));
  return matches.map((match) => match[0]);
}

function extractTagContent(block, tagName) {
  const regex = new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)<\\/${tagName}>`, "i");
  const match = block.match(regex);
  if (!match) return null;
  return match[1].trim();
}

export function parseGeofencePlacemarks(kmlText = "") {
  return extractPlacemarks(kmlText)
    .map((block, index) => {
      const name = extractTagContent(block, "name") || `Elemento ${index + 1}`;
      const polygonBlock = block.match(/<Polygon[\s\S]*?<\/Polygon>/i);
      if (!polygonBlock) return null;
      const coordinates = extractTagContent(polygonBlock[0], "coordinates") || "";
      const points = parseCoordinates(coordinates);
      if (!points.length) return null;
      return { name, points };
    })
    .filter(Boolean);
}

export function parseRoutePlacemarks(kmlText = "") {
  return extractPlacemarks(kmlText)
    .map((block, index) => {
      const name = extractTagContent(block, "name") || `Rota ${index + 1}`;
      const lineBlock = block.match(/<LineString[\s\S]*?<\/LineString>/i);
      if (!lineBlock) return null;
      const coordinates = extractTagContent(lineBlock[0], "coordinates") || "";
      const points = parseCoordinates(coordinates);
      if (!points.length) return null;
      return { name, points };
    })
    .filter(Boolean);
}
