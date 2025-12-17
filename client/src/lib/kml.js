const XML_HEADER = '<?xml version="1.0" encoding="UTF-8"?>';

function buildKmlDocument(placemarks) {
  return [
    XML_HEADER,
    '<kml xmlns="http://www.opengis.net/kml/2.2">',
    '<Document>',
    ...placemarks,
    '</Document>',
    '</kml>',
  ].join('');
}

function formatCoordinates(points) {
  return points
    .map(([lat, lon]) => `${Number(lon).toFixed(6)},${Number(lat).toFixed(6)},0`)
    .join(' ');
}

function closePolygon(points) {
  if (!points.length) return points;
  const [firstLat, firstLon] = points[0];
  const [lastLat, lastLon] = points[points.length - 1];
  if (firstLat === lastLat && firstLon === lastLon) return points;
  return [...points, [firstLat, firstLon]];
}

export function approximateCirclePoints(center, radiusMeters, segments = 36) {
  const [lat, lon] = center;
  const earthRadius = 6371000; // meters
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
      ) * (180 / Math.PI);
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

function parseCoordinates(textContent) {
  if (!textContent) return [];
  return textContent
    .trim()
    .split(/\s+/)
    .map((raw) => raw.split(',').slice(0, 2).map((value) => Number(value)))
    .filter((pair) => pair.length === 2 && pair.every((v) => Number.isFinite(v)))
    .map(([lon, lat]) => [lat, lon]);
}

function readExtendedData(placemark) {
  const entries = Array.from(placemark.getElementsByTagName('Data'));
  const payload = {};
  entries.forEach((dataNode) => {
    const name = dataNode.getAttribute('name');
    const value = dataNode.getElementsByTagName('value')[0]?.textContent ?? dataNode.textContent;
    if (name) {
      payload[name] = value;
    }
  });
  return payload;
}

export function parseKmlPlacemarks(kmlText) {
  const parser = new DOMParser();
  const xml = parser.parseFromString(kmlText, 'text/xml');
  const placemarks = Array.from(xml.getElementsByTagName('Placemark'));

  return placemarks
    .map((placemark, index) => {
      const name = placemark.getElementsByTagName('name')[0]?.textContent || `Elemento ${index + 1}`;
      const polygon = placemark.getElementsByTagName('Polygon')[0];
      const lineString = placemark.getElementsByTagName('LineString')[0];
      const point = placemark.getElementsByTagName('Point')[0];
      const extendedData = readExtendedData(placemark);
      const rawType = extendedData.type?.toLowerCase?.() || null;

      if (polygon) {
        const coordinates = polygon.getElementsByTagName('coordinates')[0]?.textContent || '';
        const points = parseCoordinates(coordinates);
        if (rawType === 'circle') {
          const centerLat = Number(extendedData.centerLat ?? extendedData.lat);
          const centerLng = Number(extendedData.centerLng ?? extendedData.lon);
          const radius = Number(extendedData.radius);
          if (Number.isFinite(centerLat) && Number.isFinite(centerLng) && Number.isFinite(radius) && radius > 0) {
            return {
              id: `kml-${index}`,
              name,
              type: 'circle',
              center: [centerLat, centerLng],
              radius,
            };
          }
        }
        return { id: `kml-${index}`, name, type: 'polygon', points };
      }

      if (lineString) {
        const coordinates = lineString.getElementsByTagName('coordinates')[0]?.textContent || '';
        const points = parseCoordinates(coordinates);
        return { id: `kml-${index}`, name, type: 'polyline', points };
      }

      if (point) {
        const coordinates = point.getElementsByTagName('coordinates')[0]?.textContent || '';
        const [[lat, lng] = []] = parseCoordinates(coordinates);
        if (rawType === 'circle') {
          const radius = Number(extendedData.radius);
          if (Number.isFinite(radius) && Number.isFinite(lat) && Number.isFinite(lng)) {
            return { id: `kml-${index}`, name, type: 'circle', center: [lat, lng], radius };
          }
        }
        if (Number.isFinite(lat) && Number.isFinite(lng)) {
          return { id: `kml-${index}`, name, type: 'point', center: [lat, lng] };
        }
      }

      return null;
    })
    .filter(Boolean);
}

export function exportRoutesToKml(routes) {
  const placemarks = (routes || []).map((route, idx) => {
    const name = route.name || `Rota ${idx + 1}`;
    const coordinates = formatCoordinates(route.points || []);
    return `
      <Placemark>
        <name>${name}</name>
        <LineString>
          <coordinates>${coordinates}</coordinates>
        </LineString>
      </Placemark>
    `;
  });

  return buildKmlDocument(placemarks);
}

export function downloadKml(filename, kmlText) {
  const blob = new Blob([kmlText], { type: 'application/vnd.google-earth.kml+xml' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function simplifyPath(points, tolerance = 0.0001) {
  if (!Array.isArray(points) || points.length <= 2) return points || [];

  const sqTolerance = tolerance * tolerance;

  function getSqDist(p1, p2) {
    const dx = p1[0] - p2[0];
    const dy = p1[1] - p2[1];
    return dx * dx + dy * dy;
  }

  function simplifyDPStep(pointsList, first, last, simplified) {
    let maxSqDist = sqTolerance;
    let index;
    for (let i = first + 1; i < last; i += 1) {
      const sqDist = getSqSegDist(pointsList[i], pointsList[first], pointsList[last]);
      if (sqDist > maxSqDist) {
        index = i;
        maxSqDist = sqDist;
      }
    }

    if (maxSqDist > sqTolerance) {
      if (index - first > 1) simplifyDPStep(pointsList, first, index, simplified);
      simplified.push(pointsList[index]);
      if (last - index > 1) simplifyDPStep(pointsList, index, last, simplified);
    }
  }

  function getSqSegDist(p, p1, p2) {
    let x = p1[0];
    let y = p1[1];
    let dx = p2[0] - x;
    let dy = p2[1] - y;

    if (dx !== 0 || dy !== 0) {
      const t = ((p[0] - x) * dx + (p[1] - y) * dy) / (dx * dx + dy * dy);
      if (t > 1) {
        x = p2[0];
        y = p2[1];
      } else if (t > 0) {
        x += dx * t;
        y += dy * t;
      }
    }

    dx = p[0] - x;
    dy = p[1] - y;

    return dx * dx + dy * dy;
  }

  const simplified = [points[0]];
  simplifyDPStep(points, 0, points.length - 1, simplified);
  simplified.push(points[points.length - 1]);
  return simplified;
}

export function deduplicatePath(points) {
  if (!Array.isArray(points)) return [];
  const unique = [];
  let last = null;
  points.forEach((point) => {
    if (!Array.isArray(point) || point.length < 2) return;
    if (!last || last[0] !== point[0] || last[1] !== point[1]) {
      unique.push(point);
      last = point;
    }
  });
  return unique;
}

function buildGeofencePlacemark(geofence) {
  const type = (geofence.type || 'polygon').toLowerCase();
  const name = geofence.name || 'Geofence';
  const description = geofence.description || '';
  const radius = Number(geofence.radius ?? 0);
  const center = Array.isArray(geofence.center) && geofence.center.length === 2 ? geofence.center : null;
  const coordinates =
    type === 'circle' && center && Number.isFinite(radius) && radius > 0
      ? closePolygon(approximateCirclePoints(center, radius, 48))
      : closePolygon(geofence.points || geofence.coordinates || []);

  const extended =
    type === 'circle' && center && Number.isFinite(radius) && radius > 0
      ? `
        <ExtendedData>
          <Data name="type"><value>circle</value></Data>
          <Data name="radius"><value>${radius}</value></Data>
          <Data name="centerLat"><value>${center[0]}</value></Data>
          <Data name="centerLng"><value>${center[1]}</value></Data>
          ${geofence.color ? `<Data name="color"><value>${geofence.color}</value></Data>` : ''}
        </ExtendedData>`
      : `
        <ExtendedData>
          <Data name="type"><value>polygon</value></Data>
          ${geofence.color ? `<Data name="color"><value>${geofence.color}</value></Data>` : ''}
        </ExtendedData>`;

  return `
    <Placemark>
      <name>${name}</name>
      <description>${description}</description>
      ${extended}
      <Polygon>
        <outerBoundaryIs>
          <LinearRing>
            <coordinates>${formatCoordinates(coordinates)}</coordinates>
          </LinearRing>
        </outerBoundaryIs>
      </Polygon>
    </Placemark>
  `;
}

export function geofencesToKml(geofences) {
  const placemarks = (geofences || []).map((geofence) => buildGeofencePlacemark(geofence));
  return buildKmlDocument(placemarks);
}

export function exportGeofencesToKml(geofences) {
  return geofencesToKml(geofences);
}

export function kmlToGeofences(kmlText) {
  return parseKmlPlacemarks(kmlText).map((item) => {
    const base = { id: item.id, name: item.name, color: item.color || null };
    if (item.type === 'circle' && item.center && item.radius) {
      return { ...base, type: 'circle', center: item.center, radius: item.radius, points: [] };
    }
    return { ...base, type: 'polygon', points: item.points || [] };
  });
}
