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

function buildExtendedData(metadata = {}) {
  const entries = Object.entries(metadata).filter(
    ([, value]) => value !== undefined && value !== null && String(value).trim() !== "",
  );
  if (!entries.length) return "";
  const dataNodes = entries
    .map(([key, value]) => `<Data name="${key}"><value>${String(value)}</value></Data>`)
    .join("");
  return `<ExtendedData>${dataNodes}</ExtendedData>`;
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


export function exportGeofencesToKml(geofences) {
  const placemarks = (geofences || []).map((fence) => {
    const name = fence.name || 'Geofence';
    const description = fence.description || '';
    let coordinates = '';

    if (fence.type === 'circle' && fence.center && fence.radius) {
      const approximated = approximateCirclePoints(fence.center, fence.radius, 48);
      coordinates = formatCoordinates(closePolygon(approximated));
    } else {
      const points = closePolygon(fence.points || []);
      coordinates = formatCoordinates(points);
    }

    const metadata = {
      geofenceGroupIds: Array.isArray(fence.geofenceGroupIds) ? fence.geofenceGroupIds.join(',') : null,
      geofenceGroupNames: Array.isArray(fence.geofenceGroupNames) ? fence.geofenceGroupNames.join(',') : fence.geofenceGroupName,
    };

    return `
      <Placemark>
        <name>${name}</name>
        <description>${description}</description>
        ${buildExtendedData(metadata)}
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

  return buildKmlDocument(placemarks);
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


function parseExtendedData(placemark) {
  const metadata = {};
  const extended = placemark.getElementsByTagName('ExtendedData')[0];
  if (!extended) return metadata;

  const dataElements = Array.from(extended.getElementsByTagName('Data'));
  dataElements.forEach((dataNode) => {
    const key = dataNode.getAttribute('name');
    const valueNode = dataNode.getElementsByTagName('value')[0];
    const raw = valueNode?.textContent || dataNode.textContent || '';
    if (key) {
      metadata[key] = raw;
    }
  });
  return metadata;
}

function parseList(raw) {
  if (!raw) return [];
  return String(raw)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

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

      const metadata = parseExtendedData(placemark);
      const geofenceGroupIds = parseList(metadata.geofenceGroupIds || metadata.groupIds);
      const geofenceGroupNames = parseList(
        metadata.geofenceGroupNames || metadata.geofenceGroupName || metadata.groupNames || metadata.groupName,
      );


      if (polygon) {
        const coordinates = polygon.getElementsByTagName('coordinates')[0]?.textContent || '';
        const points = parseCoordinates(coordinates);

        return { id: `kml-${index}`, name, type: 'polygon', points, geofenceGroupIds, geofenceGroupNames, metadata };

      }

      if (lineString) {
        const coordinates = lineString.getElementsByTagName('coordinates')[0]?.textContent || '';
        const points = parseCoordinates(coordinates);
        return { id: `kml-${index}`, name, type: 'polyline', points, geofenceGroupIds, geofenceGroupNames, metadata };
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


