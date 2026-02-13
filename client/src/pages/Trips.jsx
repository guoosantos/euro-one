import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { MapContainer, Marker, Polygon, Polyline, TileLayer, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

import useVehicles, { normalizeVehicleDevices } from "../lib/hooks/useVehicles.js";
import { useTranslation } from "../lib/i18n.js";
import useReportsRoute from "../lib/hooks/useReportsRoute";
import { useReports } from "../lib/hooks/useReports";
import { formatDateTime, pickCoordinate, pickSpeed } from "../lib/monitoring-helpers.js";
import { formatAddress } from "../lib/format-address.js";
import { resolveEventDefinitionFromPayload, translateEventType } from "../lib/event-translations.js";
import { buildParams as buildEventParams } from "../lib/hooks/events-helpers.js";
import safeApi from "../lib/safe-api.js";
import { API_ROUTES } from "../lib/api-routes.js";
import { buildOverlayShapes, buildRouteCorridorPolygons } from "../lib/itinerary-overlay.js";
import { isEmbarkedConfirmedStatus, translateItineraryStatusLabel } from "../lib/itinerary-status.js";
import {
  DEFAULT_MAP_LAYER_KEY,
  ENABLED_MAP_LAYERS,
  MAP_LAYER_FALLBACK,
  MAP_LAYER_STORAGE_KEYS,
  getValidMapLayer,
} from "../lib/mapLayers.js";
import { toDeviceKey } from "../lib/hooks/useDevices.helpers.js";
import useVehicleSelection from "../lib/hooks/useVehicleSelection.js";
import { createVehicleMarkerIcon, resolveMarkerIconType } from "../lib/map/vehicleMarkerIcon.js";
import AddressStatus from "../ui/AddressStatus.jsx";
import Button from "../ui/Button.jsx";
import useMapLifecycle from "../lib/map/useMapLifecycle.js";
import { canInteractWithMap } from "../lib/map/mapSafety.js";
import { resolveMirrorHeaders } from "../lib/mirror-params.js";
import { useTenant } from "../lib/tenant-context.jsx";
import { resolveTelemetryDescriptor } from "../../../shared/telemetryDictionary.js";
import PageHeader from "../components/ui/PageHeader.jsx";
import AutocompleteSelect from "../components/ui/AutocompleteSelect.jsx";

// Discovery note (Epic B): this page will receive map layer selection,
// improved replay rendering, and event navigation for trip playback.

const DEFAULT_CENTER = [-19.9167, -43.9345];
const DEFAULT_ZOOM = 15;
const DEFAULT_FROM = () => new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 16);
const DEFAULT_TO = () => new Date().toISOString().slice(0, 16);
const FALLBACK_CENTER = [-15.793889, -47.882778];
const FALLBACK_ZOOM = 5;
const REPLAY_SPEEDS = [0.5, 1, 2, 4, 8, 16];
const MAP_LAYER_STORAGE_KEY = MAP_LAYER_STORAGE_KEYS.trips;
const MAX_INTERPOLATION_METERS = 120;
const EVENT_OFFSET_METERS = 70;
const REPLAY_SLIDER_RESOLUTION = 1000;
const MAP_MATCH_MAX_POINTS = 240;
const MAP_MATCH_CHUNK_SIZE = 90;
const MAP_MATCH_PROFILE = "driving";
const LOGICAL_ROUTE_PROFILE = "driving";
const ROUTE_COLOR = "#2563eb";
const ROUTE_OPACITY = 0.85;
const ROUTE_WEIGHT = 8;
const MAX_DRAWER_ROWS = 300;

const TRIP_EVENT_TRANSLATIONS = {
  "position registered": "Posição",
  position: "Posição",
  overspeed: "Excesso de velocidade",
  "harsh braking": "Frenagem brusca",
  "harsh-braking": "Frenagem brusca",
  "harsh acceleration": "Aceleração brusca",
  "harsh-acceleration": "Aceleração brusca",
  "ignition on": "Ignição ligada",
  "ignition off": "Ignição desligada",
};

const SEVERITY_LABELS = {
  info: "Informativa",
  informativa: "Informativa",
  warning: "Alerta",
  alerta: "Alerta",
  low: "Baixa",
  baixa: "Baixa",
  medium: "Moderada",
  moderate: "Moderada",
  moderada: "Moderada",
  media: "Moderada",
  "média": "Moderada",
  high: "Alta",
  alta: "Alta",
  critical: "Crítica",
  critica: "Crítica",
  "crítica": "Crítica",
};
const CRITICAL_EVENT_TYPES = new Set(["deviceoffline", "deviceinactive", "deviceunknown", "powercut", "powerdisconnected"]);
const MODERATE_EVENT_TYPES = new Set([
  "ignitionon",
  "ignitionoff",
  "devicemoving",
  "devicestopped",
  "tripstart",
  "tripstop",
]);
const LOW_EVENT_TYPES = new Set(["deviceonline"]);

const COLUMN_STORAGE_KEY = "tripsReplayColumns:v1";
const DEFAULT_COLUMN_PRESET = ["time", "event", "speed", "address"];
const ADDRESS_PLACEHOLDERS = new Set(["endereço indisponível", "endereço não disponível"]);

function translateTripEvent(eventType) {
  if (!eventType) return "";
  const normalized = String(eventType).trim();
  const simplified = normalized.replace(/[_]+/g, " ").toLowerCase();
  return TRIP_EVENT_TRANSLATIONS[simplified] || normalized;
}

function toFiniteNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isValidLatLng(lat, lng) {
  const normalizedLat = toFiniteNumber(lat);
  const normalizedLng = toFiniteNumber(lng);
  if (normalizedLat === null || normalizedLng === null) return false;
  return normalizedLat >= -90 && normalizedLat <= 90 && normalizedLng >= -180 && normalizedLng <= 180;
}

function buildCoordKey(lat, lng, precision = 5) {
  const normalizedLat = toFiniteNumber(lat);
  const normalizedLng = toFiniteNumber(lng);
  if (normalizedLat === null || normalizedLng === null) return null;
  const factor = 10 ** precision;
  return `${Math.round(normalizedLat * factor) / factor},${Math.round(normalizedLng * factor) / factor}`;
}

function findIndexForTime(targetTime, times, hintIndex = 0) {
  if (!Array.isArray(times) || !times.length) return 0;
  const clampedHint = Math.min(Math.max(hintIndex, 0), times.length - 1);
  if (targetTime <= times[clampedHint]) {
    let low = 0;
    let high = clampedHint;
    while (low < high) {
      const mid = Math.floor((low + high) / 2);
      if (times[mid] <= targetTime) {
        low = mid + 1;
      } else {
        high = mid;
      }
    }
    return Math.max(0, low - 1);
  }

  let low = clampedHint;
  let high = times.length - 1;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (times[mid] <= targetTime) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }
  return low;
}

function normalizeLatLng(point) {
  if (!point) return null;
  const rawLat = point.lat ?? point.latitude;
  const rawLng = point.lng ?? point.lon ?? point.longitude;
  const lat = toFiniteNumber(rawLat);
  const lng = toFiniteNumber(rawLng);
  if (lat === null || lng === null) return null;
  if (!isValidLatLng(lat, lng)) return null;
  return { lat, lng };
}

function parseDate(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function normalizeQueryId(value) {
  if (value === null || value === undefined || value === "") return "";
  return String(value);
}

function asLocalInput(value, fallbackFactory) {
  if (value) {
    const parsed = parseDate(value);
    if (parsed) return parsed.toISOString().slice(0, 16);
  }
  return fallbackFactory ? fallbackFactory() : "";
}

function formatDuration(seconds) {
  if (!Number.isFinite(seconds)) return "—";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const parts = [hours, minutes, secs].map((value) => String(value).padStart(2, "0"));
  return `${parts[0]}:${parts[1]}:${parts[2]}`;
}

function formatDistance(distanceMeters) {
  if (!Number.isFinite(distanceMeters)) return "—";
  if (distanceMeters >= 1000) return `${(distanceMeters / 1000).toFixed(1)} km`;
  return `${Math.round(distanceMeters)} m`;
}

function formatSpeed(value) {
  if (!Number.isFinite(value)) return "—";
  return `${Math.round(value)} km/h`;
}

function buildTripItineraryOptions(history = []) {
  const map = new Map();
  (Array.isArray(history) ? history : []).forEach((entry) => {
    const id = entry?.itineraryId ?? entry?.itinerary?.id ?? null;
    if (!id) return;
    const key = String(id);
    const timeValue = entry?.sentAt || entry?.at || entry?.deviceConfirmedAt || entry?.receivedAt || entry?.createdAt || 0;
    const time = new Date(timeValue).getTime();
    const statusRaw = entry?.statusLabel || entry?.status || "";
    const confirmed = Boolean(entry?.deviceConfirmedAt) || isEmbarkedConfirmedStatus(statusRaw);
    const statusLabel = translateItineraryStatusLabel(statusRaw, { style: "title", fallback: "" });
    const option = {
      id: key,
      name: entry?.itineraryName || entry?.itinerary?.name || key,
      confirmed,
      statusLabel,
      _time: Number.isFinite(time) ? time : 0,
    };
    const existing = map.get(key);
    if (!existing || option._time > existing._time) {
      map.set(key, option);
    }
  });
  return Array.from(map.values())
    .sort((a, b) => b._time - a._time)
    .map(({ _time, ...rest }) => rest);
}

function resolveTripTimeValue(trip, type) {
  if (!trip) return null;
  if (type === "start") {
    return trip.startTime || trip.start?.time || trip.start || trip.from || null;
  }
  return trip.endTime || trip.end?.time || trip.end || trip.to || null;
}

function resolveTripDistanceMeters(trip) {
  if (!trip) return null;
  const km = toFiniteNumber(trip.distanceKm ?? trip.distance_km);
  if (km !== null) return km * 1000;
  return toFiniteNumber(trip.distance ?? trip.distanceMeters ?? trip.distance_m ?? trip.distanceM);
}

function resolveTripDurationSeconds(trip) {
  if (!trip) return null;
  const seconds = toFiniteNumber(trip.duration ?? trip.durationSeconds ?? trip.duration_sec);
  if (seconds !== null) return seconds;
  const minutes = toFiniteNumber(trip.durationMinutes ?? trip.duration_min);
  return minutes !== null ? minutes * 60 : null;
}

function resolveTripAverageSpeed(trip) {
  return toFiniteNumber(trip?.averageSpeed ?? trip?.averageSpeedKmh ?? trip?.avgSpeed ?? trip?.avgSpeedKmh);
}

function resolveTripMaxSpeed(trip) {
  return toFiniteNumber(trip?.maxSpeed ?? trip?.maxSpeedKmh ?? trip?.maximumSpeed);
}

function resolveTripStopCount(trip) {
  return toFiniteNumber(trip?.stops ?? trip?.stopCount ?? trip?.stop_count ?? trip?.stopsCount);
}

function resolveTripSignalBadge(trip) {
  const raw = trip?.gpsQuality ?? trip?.quality ?? trip?.signalQuality ?? trip?.signal ?? null;
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "number") {
    if (raw >= 70) return { label: "Sinal bom", tone: "good" };
    if (raw >= 40) return { label: "Sinal médio", tone: "warn" };
    return { label: "Sinal ruim", tone: "bad" };
  }
  const value = String(raw).toLowerCase();
  if (value.includes("bom") || value.includes("good")) return { label: "Sinal bom", tone: "good" };
  if (value.includes("medio") || value.includes("médio") || value.includes("medium")) {
    return { label: "Sinal médio", tone: "warn" };
  }
  if (value.includes("ruim") || value.includes("bad")) return { label: "Sinal ruim", tone: "bad" };
  return null;
}

function resolveTripKey(trip) {
  if (!trip) return "";
  const device = trip.deviceId || trip.device_id || "";
  const start = resolveTripTimeValue(trip, "start") || "";
  const end = resolveTripTimeValue(trip, "end") || "";
  return `${device}:${trip.id || ""}:${start}:${end}`;
}

function toRadians(value) {
  return (value * Math.PI) / 180;
}

function haversineDistance(a, b) {
  if (!a || !b) return 0;
  const R = 6371000;
  const dLat = toRadians((b.lat || 0) - (a.lat || 0));
  const dLng = toRadians((b.lng || 0) - (a.lng || 0));
  const lat1 = toRadians(a.lat || 0);
  const lat2 = toRadians(b.lat || 0);
  const sinDLat = Math.sin(dLat / 2);
  const sinDLng = Math.sin(dLng / 2);
  const h = sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLng * sinDLng;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function computeHeading(from, to) {
  if (!from || !to) return 0;
  const lat1 = toRadians(from.lat || 0);
  const lat2 = toRadians(to.lat || 0);
  const dLng = toRadians((to.lng || 0) - (from.lng || 0));
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  const bearing = (Math.atan2(y, x) * 180) / Math.PI;
  return (bearing + 360) % 360;
}

function bearingDelta(a, b) {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  const diff = Math.abs(a - b) % 360;
  return diff > 180 ? 360 - diff : diff;
}

function offsetPoint(point, bearing, distanceMeters = EVENT_OFFSET_METERS) {
  if (!point || !Number.isFinite(point.lat) || !Number.isFinite(point.lng)) return null;
  const heading = Number.isFinite(bearing) ? bearing : 0;
  const angularDistance = distanceMeters / 6371000;
  const bearingRad = toRadians(heading);
  const latRad = toRadians(point.lat);
  const lngRad = toRadians(point.lng);

  const nextLat =
    Math.asin(
      Math.sin(latRad) * Math.cos(angularDistance) + Math.cos(latRad) * Math.sin(angularDistance) * Math.cos(bearingRad),
    ) || 0;
  const nextLng =
    lngRad +
      Math.atan2(
        Math.sin(bearingRad) * Math.sin(angularDistance) * Math.cos(latRad),
        Math.cos(angularDistance) - Math.sin(latRad) * Math.sin(nextLat),
      ) ||
    0;

  return { lat: (nextLat * 180) / Math.PI, lng: ((nextLng * 180) / Math.PI + 540) % 360 - 180 };
}

function normalizeMapMatchingResponse(payload) {
  const base = payload?.data ?? payload ?? {};
  const geometry = Array.isArray(base.geometry)
    ? base.geometry
    : Array.isArray(base.path)
      ? base.path
      : Array.isArray(base.coordinates)
        ? base.coordinates
        : [];
  const normalizedGeometry = geometry
    .map((point) => {
      const lat = toFiniteNumber(point?.lat ?? point?.latitude ?? point?.[1]);
      const lng = toFiniteNumber(point?.lng ?? point?.lon ?? point?.longitude ?? point?.[0]);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
      return { lat, lng };
    })
    .filter(Boolean);

  const tracepoints = Array.isArray(base.tracepoints) ? base.tracepoints.filter(Boolean) : [];
  return { ...base, geometry: normalizedGeometry, tracepoints };
}

function normalizeMapRouteResponse(payload) {
  const base = payload?.data ?? payload ?? {};
  const geometry = Array.isArray(base.geometry)
    ? base.geometry
    : Array.isArray(base.path)
      ? base.path
      : Array.isArray(base.coordinates)
        ? base.coordinates
        : [];
  const normalizedGeometry = geometry
    .map((point) => {
      const lat = toFiniteNumber(point?.lat ?? point?.latitude ?? point?.[1]);
      const lng = toFiniteNumber(point?.lng ?? point?.lon ?? point?.longitude ?? point?.[0]);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
      return { lat, lng };
    })
    .filter(Boolean);

  const provider = base.provider || base.data?.provider || null;
  const distance = toFiniteNumber(base.distance ?? base.data?.distance);
  const duration = toFiniteNumber(base.duration ?? base.data?.duration);
  return { ...base, geometry: normalizedGeometry, provider, distance, duration };
}

function sampleRouteForMatching(
  points = [],
  { maxPoints = 240, minDistanceMeters = 20, bearingDeltaThreshold = 35 } = {},
) {
  if (!Array.isArray(points) || points.length === 0) {
    return [];
  }

  const sampled = [];
  const priorityIndexes = new Set();
  let lastKept = null;
  let lastBearing = null;

  points.forEach((point, index) => {
    if (!point) return;
    const isFirst = index === 0;
    const isLast = index === points.length - 1;
    const hasEvent =
      Boolean(point.eventKey) ||
      (typeof point.ignition === "boolean" && point.ignition !== lastKept?.ignition) ||
      (typeof point.motion === "boolean" && point.motion !== lastKept?.motion);
    let keep = isFirst || isLast || hasEvent;

    if (!keep && lastKept) {
      const distance = haversineDistance(
        { lat: lastKept?.lat, lng: lastKept?.lng },
        { lat: point.lat, lng: point.lng },
      );
      if (!Number.isFinite(distance) || distance >= minDistanceMeters) {
        keep = true;
      }
    }

    if (!keep && lastKept) {
      const bearing = computeHeading(lastKept, point);
      if (bearingDelta(lastBearing ?? bearing, bearing) >= bearingDeltaThreshold) {
        keep = true;
      }
    }

    if (keep) {
      sampled.push(point);
      if (hasEvent) priorityIndexes.add(sampled.length - 1);
      const referenceBearing = Number.isFinite(point.heading)
        ? point.heading
        : lastKept
          ? computeHeading(lastKept, point)
          : null;
      if (Number.isFinite(referenceBearing)) {
        lastBearing = referenceBearing;
      }
      lastKept = point;
    }
  });

  if (sampled.length <= maxPoints) return sampled;

  const keepIndexes = new Set([0, sampled.length - 1, ...priorityIndexes]);
  const remaining = sampled.map((_, idx) => idx).filter((idx) => !keepIndexes.has(idx));
  const available = Math.max(0, maxPoints - keepIndexes.size);
  const step = Math.max(1, Math.ceil(remaining.length / Math.max(1, available)));
  remaining.forEach((idx, index) => {
    if (keepIndexes.size < maxPoints && index % step === 0) {
      keepIndexes.add(idx);
    }
  });

  return sampled.filter((_point, index) => keepIndexes.has(index));
}

function smoothRoute(points) {
  if (!Array.isArray(points)) return [];
  const validPoints = points.filter((point) => Number.isFinite(point?.lat) && Number.isFinite(point?.lng));
  return validPoints.map((point, index, array) => {
    const prev = array[Math.max(index - 1, 0)] || point;
    const next = array[Math.min(index + 1, array.length - 1)] || point;
    const lat = (prev.lat + point.lat + next.lat) / 3;
    const lng = (prev.lng + point.lng + next.lng) / 3;
    return { ...point, lat, lng };
  });
}

function densifyPath(points, maxDistanceMeters = MAX_INTERPOLATION_METERS) {
  if (!Array.isArray(points)) return [];
  const path = [];

  points.forEach((point, index) => {
    if (!Number.isFinite(point?.lat) || !Number.isFinite(point?.lng)) return;
    const current = { lat: point.lat, lng: point.lng };
    const next = points[index + 1];
    path.push(current);
    if (!next || !Number.isFinite(next.lat) || !Number.isFinite(next.lng)) return;
    const distance = haversineDistance(current, next);
    const steps = Math.max(1, Math.min(6, Math.ceil(distance / maxDistanceMeters)));
    for (let step = 1; step < steps; step += 1) {
      const ratio = step / steps;
      path.push({ lat: lerp(current.lat, next.lat, ratio), lng: lerp(current.lng, next.lng, ratio) });
    }
  });

  return path;
}

function computePathDistances(points = []) {
  if (!Array.isArray(points) || points.length === 0) return { distances: [], total: 0 };
  const distances = [0];
  let total = 0;

  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    const distance = haversineDistance(previous, current);
    total += Number.isFinite(distance) ? distance : 0;
    distances.push(total);
  }

  return { distances, total };
}

function interpolatePathAtDistance(path, cumulativeDistances, targetDistance) {
  if (!Array.isArray(path) || path.length === 0) return null;
  const total = cumulativeDistances[cumulativeDistances.length - 1] || 0;
  if (total === 0) return path[0];
  if (targetDistance <= 0) return path[0];
  if (targetDistance >= total) return path[path.length - 1];

  let startIndex = 0;
  while (startIndex < cumulativeDistances.length - 1 && cumulativeDistances[startIndex + 1] < targetDistance) {
    startIndex += 1;
  }

  const endIndex = Math.min(startIndex + 1, path.length - 1);
  const span = (cumulativeDistances[endIndex] - cumulativeDistances[startIndex]) || 1;
  const ratio = clamp((targetDistance - cumulativeDistances[startIndex]) / span, 0, 1);
  const start = path[startIndex];
  const end = path[endIndex];

  return {
    lat: lerp(start.lat, end.lat, ratio),
    lng: lerp(start.lng, end.lng, ratio),
  };
}

function alignPointsToPath(points = [], targetPath = []) {
  if (!Array.isArray(points) || points.length < 2) return points;
  const validPath = Array.isArray(targetPath)
    ? targetPath.filter((point) => Number.isFinite(point?.lat) && Number.isFinite(point?.lng))
    : [];
  if (validPath.length < 2) return points;

  const { distances, total } = computePathDistances(validPath);
  if (total <= 0) return points;

  const startTime = toFiniteNumber(points[0]?.t) ?? 0;
  const endTime = toFiniteNumber(points[points.length - 1]?.t) ?? startTime;
  const duration = endTime - startTime;

  return points.map((point, index) => {
    const progressFromTime =
      duration > 0 && Number.isFinite(point?.t)
        ? clamp((point.t - startTime) / duration, 0, 1)
        : points.length > 1
          ? clamp(index / (points.length - 1), 0, 1)
          : 0;
    const targetDistance = progressFromTime * total;
    const projected = interpolatePathAtDistance(validPath, distances, targetDistance) || point;
    return { ...point, lat: projected.lat, lng: projected.lng };
  });
}

function simplifyPath(points = [], toleranceMeters = 5) {
  if (!Array.isArray(points)) return [];
  if (points.length <= 2 || !Number.isFinite(toleranceMeters) || toleranceMeters <= 0) return points;
  const projector =
    L?.CRS?.EPSG3857?.project ||
    L?.Projection?.SphericalMercator?.project ||
    L?.CRS?.Earth?.project ||
    null;
  if (!projector || !L?.latLng) return points;

  const projected = points
    .map((point, index) => {
      if (!Number.isFinite(point?.lat) || !Number.isFinite(point?.lng)) return null;
      try {
        const proj = projector.call(
          L.CRS?.EPSG3857 || L.Projection?.SphericalMercator || L.CRS?.Earth,
          L.latLng(point.lat, point.lng),
        );
        if (!proj || !Number.isFinite(proj.x) || !Number.isFinite(proj.y)) return null;
        return { index, point, projected: proj };
      } catch (_error) {
        return null;
      }
    })
    .filter(Boolean);

  if (projected.length <= 2) return points;

  const sqTolerance = toleranceMeters * toleranceMeters;
  const markers = new Array(projected.length).fill(false);
  const stack = [[0, projected.length - 1]];
  markers[0] = true;
  markers[projected.length - 1] = true;

  const sqSegmentDistance = (p, p1, p2) => {
    let x = p1.x;
    let y = p1.y;
    let dx = p2.x - x;
    let dy = p2.y - y;

    if (dx !== 0 || dy !== 0) {
      const t = ((p.x - x) * dx + (p.y - y) * dy) / (dx * dx + dy * dy);
      if (t > 1) {
        x = p2.x;
        y = p2.y;
      } else if (t > 0) {
        x += dx * t;
        y += dy * t;
      }
    }

    dx = p.x - x;
    dy = p.y - y;
    return dx * dx + dy * dy;
  };

  while (stack.length) {
    const [first, last] = stack.pop();
    let maxSqDist = 0;
    let index = 0;

    for (let i = first + 1; i < last; i += 1) {
      const dist = sqSegmentDistance(projected[i].projected, projected[first].projected, projected[last].projected);
      if (dist > maxSqDist) {
        index = i;
        maxSqDist = dist;
      }
    }

    if (maxSqDist > sqTolerance) {
      markers[index] = true;
      stack.push([first, index]);
      stack.push([index, last]);
    }
  }

  const simplified = projected.filter((item, idx) => markers[idx]).map((item) => points[item.index]);
  return simplified.length ? simplified : points;
}

function runSimplifySelfCheck() {
  if (typeof process !== "undefined" && process.env?.NODE_ENV === "production") return;
  try {
    simplifyPath(
      [
        { lat: 0, lng: 0 },
        { lat: 0.0001, lng: 0.0001 },
        { lat: 0.0002, lng: 0.0002 },
      ],
      5,
    );
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn("[trips] simplifyPath self-check failed", error);
  }
}

runSimplifySelfCheck();

function normalizeTripEvent(point, helpers = {}) {
  const rawEvent =
    point?.event ||
    point?.type ||
    point?.attributes?.event ||
    point?.attributes?.alarm ||
    point?.attributes?.status ||
    point?.__label;
  const normalizedEvent = rawEvent ? String(rawEvent).trim() : "";
  const resolvedDefinition = resolveEventDefinitionFromPayload(point, helpers.locale, helpers.t);
  if (!resolvedDefinition) return null;
  if (resolvedDefinition?.suppressed) {
    return {
      type: resolvedDefinition?.type || "position",
      label: resolvedDefinition?.label || "Posição",
      icon: null,
      ignition: resolvedDefinition?.ignition,
      suppressed: true,
    };
  }
  const type = resolvedDefinition?.isNumeric
    ? resolvedDefinition.type
    : normalizedEvent
      ? normalizedEvent.toLowerCase()
      : resolvedDefinition?.type || "position";
  const resolvedLabel = resolvedDefinition?.isNumeric ? resolvedDefinition.label : null;
  return {
    type,
    label: translateTripEvent(resolvedLabel || point?.__label || normalizedEvent || resolvedDefinition?.label),
    icon: resolvedDefinition?.icon || null,
    ignition: resolvedDefinition?.ignition,
  };
}

function resolveTripEventFlags(point) {
  const attributes = point?.attributes || point?.__attributes || point?.position?.attributes || {};
  const eventActive =
    point?.eventActive ??
    attributes?.eventActive ??
    point?.position?.eventActive ??
    null;
  const eventRequiresHandling =
    point?.eventRequiresHandling ??
    attributes?.eventRequiresHandling ??
    point?.position?.eventRequiresHandling ??
    null;
  return { eventActive, eventRequiresHandling };
}

function isHandlingTripEvent(point) {
  const { eventActive, eventRequiresHandling } = resolveTripEventFlags(point);
  if (eventRequiresHandling !== true) return false;
  if (eventActive === false) return false;
  return true;
}

function normalizeSeverityFromPoint(point) {
  const raw = point?.alarm ?? point?.attributes?.alarm ?? point?.event ?? point?.attributes?.event ?? point?.type ?? "normal";
  const normalized = String(raw).toLowerCase();
  if (normalized.includes("crit")) return "critical";
  if (normalized.includes("high") || normalized.includes("alto") || normalized.includes("alerta")) return "high";
  if (normalized.includes("low") || normalized.includes("baixo")) return "low";
  if (normalized.includes("info")) return "info";
  return "normal";
}

function resolveEventSeverityLabel(rawSeverity, eventType) {
  const normalizedSeverity = String(rawSeverity || "").trim().toLowerCase();
  if (normalizedSeverity) {
    return SEVERITY_LABELS[normalizedSeverity] || normalizedSeverity;
  }

  const typeKey = String(eventType || "").trim().toLowerCase();
  if (CRITICAL_EVENT_TYPES.has(typeKey)) return "Crítica";
  if (MODERATE_EVENT_TYPES.has(typeKey)) return "Moderada";
  if (LOW_EVENT_TYPES.has(typeKey)) return "Baixa";
  return "Informativa";
}

const SECURITY_EVENT_HINTS = [
  "ignition",
  "ignição",
  "ignicao",
  "speed",
  "overspeed",
  "speeding",
  "excesso",
  "geofence",
  "cerca",
  "fence",
  "offline",
  "online",
  "sem sinal",
  "gps",
  "sat",
  "jammer",
  "jamming",
  "tamper",
  "viol",
  "panic",
  "sos",
  "power",
  "bateria",
  "battery",
  "porta",
  "door",
  "towing",
  "reboque",
  "theft",
  "assault",
  "crime",
  "crash",
  "colis",
  "harsh",
];

function inferEventCategory(rawType, rawLabel) {
  const haystack = `${rawType || ""} ${rawLabel || ""}`.toLowerCase();
  if (SECURITY_EVENT_HINTS.some((hint) => haystack.includes(hint))) return "security";
  if (haystack.includes("command") || haystack.includes("comando")) return "operation";
  if (haystack.includes("maintenance") || haystack.includes("manutenção")) return "operation";
  return "system";
}

function resolveEventTimestamp(event) {
  return parseDate(
    event?.serverTime ||
      event?.deviceTime ||
      event?.eventTime ||
      event?.time ||
      event?.timestamp ||
      event?.createdAt ||
      event?.attributes?.eventTime ||
      event?.attributes?.time,
  );
}

function resolveEventCoordinates(event) {
  const lat = pickCoordinate([
    event?.latitude,
    event?.lat,
    event?.position?.latitude,
    event?.position?.lat,
    event?.attributes?.latitude,
    event?.attributes?.lat,
  ]);
  const lng = pickCoordinate([
    event?.longitude,
    event?.lon,
    event?.lng,
    event?.position?.longitude,
    event?.position?.lon,
    event?.position?.lng,
    event?.attributes?.longitude,
    event?.attributes?.lon,
  ]);
  const coords = normalizeLatLng({ lat, lng });
  if (!coords) return { lat: null, lng: null };
  return coords;
}

function resolveEventAddress(event) {
  return (
    normalizeAddressCandidate(event?.address) ||
    normalizeAddressCandidate(event?.attributes?.address) ||
    normalizeAddressCandidate(event?.position?.address) ||
    normalizeAddressCandidate(event?.position?.attributes?.address) ||
    normalizeAddressCandidate(event?.attributes?.geofence) ||
    normalizeAddressCandidate(event?.geofence) ||
    null
  );
}

function findClosestIndexByTime(points = [], timeMs) {
  if (!points.length || !Number.isFinite(timeMs)) return 0;
  let bestIndex = 0;
  let bestDiff = Number.POSITIVE_INFINITY;
  points.forEach((point, idx) => {
    const pointTime = point.t ?? (point.__time instanceof Date ? point.__time.getTime() : null);
    if (!Number.isFinite(pointTime)) return;
    const diff = Math.abs(pointTime - timeMs);
    if (diff < bestDiff) {
      bestDiff = diff;
      bestIndex = Number.isFinite(point.index) ? point.index : idx;
    }
  });
  return bestIndex;
}

function normalizeAddressValue(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (ADDRESS_PLACEHOLDERS.has(trimmed.toLowerCase())) return null;
  return trimmed;
}

function normalizeAddressCandidate(value) {
  if (!value) return null;
  if (typeof value === "string") return normalizeAddressValue(value);
  if (typeof value === "object") {
    const formatted = normalizeAddressValue(formatAddress(value));
    if (formatted && formatted !== "—") return formatted;
    const name = normalizeAddressValue(value?.name);
    if (name) return name;
  }
  return null;
}

function formatPointAddress(point) {
  const candidates = [
    point?.address,
    point?.attributes?.address,
    point?.attributes?.formattedAddress,
    point?.attributes?.rawAddress,
    point?.geofence,
    point?.geofenceName,
    point?.attributes?.geofence,
    point?.attributes?.geofenceName,
  ];

  for (const candidate of candidates) {
    const normalizedString = normalizeAddressValue(candidate);
    if (normalizedString) return normalizedString;
    if (candidate && typeof candidate === "object") {
      const formatted = normalizeAddressValue(formatAddress(candidate));
      if (formatted && formatted !== "—") return formatted;
      const named = normalizeAddressValue(candidate.name);
      if (named) return named;
    }
  }

  return null;
}

function loadStoredColumns() {
  try {
    if (typeof localStorage === "undefined") return null;
    const raw = localStorage.getItem(COLUMN_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
    if (Array.isArray(parsed?.visible)) return parsed.visible;
    return null;
  } catch (_err) {
    return null;
  }
}

function persistColumns(columns) {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(COLUMN_STORAGE_KEY, JSON.stringify({ visible: columns }));
  } catch (_err) {
    // ignore persistence failure
  }
}

function formatAttributeLabel(key) {
  if (!key) return "Atributo";
  const descriptor = resolveTelemetryDescriptor(key);
  if (descriptor?.labelPt) return descriptor.labelPt;
  const spaced = String(key)
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_]+/g, " ")
    .trim();
  if (!spaced) return "Atributo";
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function validateRange({ deviceId, from, to }) {
  if (!deviceId) return "Selecione um veículo com equipamento vinculado para gerar o relatório.";
  const fromDate = parseDate(from);
  const toDate = parseDate(to);
  if (!fromDate || !toDate) return "Informe datas válidas para início e fim.";
  if (fromDate.getTime() >= toDate.getTime()) return "A data inicial deve ser antes da final.";
  return null;
}

function ReplayMap({
  points = [],
  activeIndex,
  animatedPoint,
  animatedLivePointRef,
  mapLayer,
  pathToRender,
  focusMode,
  isPlaying,
  manualCenter,
  tripKey,
  selectedVehicle = null,
  isActive = false,
  itineraryOverlay = null,
  itineraryConfirmed = false,
  layoutToken,
}) {
  const containerRef = useRef(null);
  const routePoints = useMemo(
    () =>
      points
        .map((point, index) => {
          const normalized = normalizeLatLng(point);
          if (!normalized) return null;
          return { ...point, ...normalized, index };
        })
        .filter(Boolean),
    [points],
  );

  const positions = useMemo(() => {
    const basePath = pathToRender?.length ? pathToRender : routePoints;
    return basePath.filter((point) => isValidLatLng(point.lat, point.lng)).map((point) => [point.lat, point.lng]);
  }, [pathToRender, routePoints]);
  const itineraryShapes = useMemo(() => buildOverlayShapes(itineraryOverlay), [itineraryOverlay]);
  const corridorBufferMeters = useMemo(() => {
    const raw = Number(itineraryOverlay?.bufferMeters);
    if (!Number.isFinite(raw) || raw <= 0) return null;
    return raw;
  }, [itineraryOverlay?.bufferMeters]);
  const itineraryCorridors = useMemo(
    () => buildRouteCorridorPolygons(itineraryShapes.routeLines, corridorBufferMeters),
    [corridorBufferMeters, itineraryShapes.routeLines],
  );
  const itineraryColor = itineraryConfirmed ? "#2563eb" : "#ef4444";
  const itineraryRouteStyle = useMemo(
    () => ({ color: itineraryColor, weight: 4, opacity: 0.9 }),
    [itineraryColor],
  );
  const itineraryCorridorStyle = useMemo(
    () => ({ color: itineraryColor, fillColor: itineraryColor, fillOpacity: 0.18, weight: 1 }),
    [itineraryColor],
  );
  const directionPathPoints = useMemo(() => {
    const basePath = pathToRender?.length ? pathToRender : routePoints;
    return basePath
      .map((point) => normalizeLatLng(point))
      .filter((point) => point && isValidLatLng(point.lat, point.lng))
      .map((point) => ({ lat: point.lat, lng: point.lng }));
  }, [pathToRender, routePoints]);
  const directionPathIndex = useMemo(() => {
    if (!directionPathPoints.length) return 0;
    const total = routePoints.length;
    if (total <= 1) return 0;
    const ratio = clamp(activeIndex / Math.max(total - 1, 1), 0, 1);
    return Math.round(ratio * Math.max(directionPathPoints.length - 1, 0));
  }, [activeIndex, directionPathPoints.length, routePoints.length]);
  const showDirectionMarkers = focusMode === "map" && (isPlaying || activeIndex > 0);

  const activePoint = routePoints[activeIndex] || routePoints[0] || null;
  const ignitionColor = useMemo(() => {
    const ignition = typeof activePoint?.__ignition === "boolean" ? activePoint.__ignition : null;
    if (ignition === true) return "#22c55e";
    if (ignition === false) return "#ef4444";
    return "#86efac";
  }, [activePoint?.__ignition]);
  const mergedVehicleAttributes = useMemo(
    () => ({
      ...(selectedVehicle?.attributes || {}),
      ...(selectedVehicle?.primaryDevice?.attributes || {}),
      ...(selectedVehicle?.device?.attributes || {}),
    }),
    [selectedVehicle?.attributes, selectedVehicle?.device?.attributes, selectedVehicle?.primaryDevice?.attributes],
  );
  const vehicleLabel = useMemo(
    () => selectedVehicle?.plate || selectedVehicle?.name || selectedVehicle?.alias || selectedVehicle?.identifier || "",
    [selectedVehicle?.alias, selectedVehicle?.identifier, selectedVehicle?.name, selectedVehicle?.plate],
  );
  const vehicleIcon = useMemo(() => {
    const iconType = resolveMarkerIconType(
      {
        iconType: selectedVehicle?.iconType || mergedVehicleAttributes.iconType,
        vehicleType: selectedVehicle?.vehicleType || selectedVehicle?.type || selectedVehicle?.category,
        type: selectedVehicle?.type,
        category: selectedVehicle?.category,
        attributes: mergedVehicleAttributes,
      },
      [
        mergedVehicleAttributes.vehicleType,
        selectedVehicle?.vehicleType,
        selectedVehicle?.type,
        selectedVehicle?.category,
      ],
    );

    const icon =
      createVehicleMarkerIcon({
        bearing: animatedPoint?.heading || 0,
        iconType,
        color: ignitionColor,
        label: vehicleLabel,
        plate: selectedVehicle?.plate,
      }) ||
      L.divIcon({
        className: "replay-vehicle",
        html: `<div style="width:18px;height:18px;border-radius:50%;background:${ignitionColor};"></div>`,
        iconSize: [20, 20],
        iconAnchor: [10, 10],
      });

    return icon;
  }, [
    animatedPoint?.heading,
    ignitionColor,
    mergedVehicleAttributes,
    selectedVehicle?.category,
    selectedVehicle?.iconType,
    selectedVehicle?.plate,
    selectedVehicle?.type,
    selectedVehicle?.vehicleType,
    vehicleLabel,
  ]);
  const markerRef = useRef(null);
  const markerAnimationRef = useRef(null);

  useEffect(() => {
    if (!animatedLivePointRef) return undefined;
    let cancelled = false;

    const animate = () => {
      if (cancelled) return;
      const next = animatedLivePointRef.current;
      if (next && markerRef.current?.setLatLng) {
        markerRef.current.setLatLng([next.lat, next.lng]);
      }
      markerAnimationRef.current = requestAnimationFrame(animate);
    };

    markerAnimationRef.current = requestAnimationFrame(animate);

    return () => {
      cancelled = true;
      if (markerAnimationRef.current) cancelAnimationFrame(markerAnimationRef.current);
    };
  }, [animatedLivePointRef]);
  const tileLayer = mapLayer || MAP_LAYER_FALLBACK;
  const resolvedSubdomains = tileLayer.subdomains ?? "abc";
  const resolvedMaxZoom = Number.isFinite(tileLayer.maxZoom) ? tileLayer.maxZoom : 19;
  const normalizedAnimatedPoint = useMemo(() => normalizeLatLng(animatedPoint), [animatedPoint]);
  const normalizedActivePoint = useMemo(() => normalizeLatLng(activePoint), [activePoint]);
  const animatedMarkerPosition = normalizedAnimatedPoint
    ? [normalizedAnimatedPoint.lat, normalizedAnimatedPoint.lng]
    : null;
  const initialCenter = useMemo(() => {
    if (normalizedAnimatedPoint) return [normalizedAnimatedPoint.lat, normalizedAnimatedPoint.lng];
    if (normalizedActivePoint) return [normalizedActivePoint.lat, normalizedActivePoint.lng];
    const normalizedDefault = normalizeLatLng({ lat: DEFAULT_CENTER[0], lng: DEFAULT_CENTER[1] });
    return normalizedDefault ? [normalizedDefault.lat, normalizedDefault.lng] : FALLBACK_CENTER;
  }, [normalizedActivePoint, normalizedAnimatedPoint]);
  const initialZoom = useMemo(() => (normalizedAnimatedPoint || normalizedActivePoint ? DEFAULT_ZOOM : FALLBACK_ZOOM), [
    normalizedActivePoint,
    normalizedAnimatedPoint,
  ]);
  const hasSelectedVehicle = Boolean(selectedVehicle);
  const mapRef = useRef(null);
  const { onMapReady, refreshMap, map } = useMapLifecycle({ mapRef, containerRef });

  useEffect(() => {
    if (!map || !containerRef.current) return undefined;
    let frame = null;
    const observer = new ResizeObserver(() => {
      if (frame) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (canInteractWithMap(map, containerRef.current) && typeof map.invalidateSize === "function") {
          map.invalidateSize({ animate: false });
        }
        refreshMap();
      });
    });
    observer.observe(containerRef.current);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [map, refreshMap]);

  useEffect(() => {
    if (!map || !isActive || focusMode !== "map") return undefined;
    const timeout = setTimeout(() => {
      if (!map) return;
      if (canInteractWithMap(map, containerRef.current) && typeof map.invalidateSize === "function") {
        map.invalidateSize({ animate: false });
      }
      refreshMap();
    }, 120);
    return () => clearTimeout(timeout);
  }, [focusMode, isActive, layoutToken, map, refreshMap, pathToRender?.length, selectedVehicle?.id]);

  if (!hasSelectedVehicle) {
    return (
      <div className="relative flex h-full w-full items-center justify-center rounded-xl border border-white/10 bg-[#0f141c] text-sm text-white/60">
        Selecione um veículo para visualizar o replay.
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="relative h-full w-full overflow-hidden rounded-xl border border-white/10 bg-[#0f141c]"
    >
      <MapContainer
        ref={mapRef}
        center={initialCenter}
        zoom={initialZoom}
        className="h-full w-full"
        whenReady={onMapReady}
      >
        <TileLayer
          key={tileLayer.key}
          attribution={tileLayer.attribution}
          url={tileLayer.url}
          subdomains={resolvedSubdomains}
          maxZoom={resolvedMaxZoom}
        />
        {itineraryCorridors.length > 0
          ? itineraryCorridors.map((polygon, index) => (
            <Polygon
              key={`itinerary-corridor-${index}`}
              positions={polygon}
              pathOptions={itineraryCorridorStyle}
            />
          ))
          : itineraryShapes.routeLines.map((line, index) => (
            <Polyline
              key={`itinerary-line-${index}`}
              positions={line}
              pathOptions={itineraryRouteStyle}
            />
          ))}
        {positions.length ? (
          <>
            <Polyline
              positions={positions}
              color="#1e40af"
              weight={ROUTE_WEIGHT + 4}
              opacity={0.28}
              lineCap="round"
              lineJoin="round"
            />
            <Polyline
              positions={positions}
              color={ROUTE_COLOR}
              weight={ROUTE_WEIGHT}
              opacity={ROUTE_OPACITY}
              lineCap="round"
              lineJoin="round"
            />
          </>
        ) : null}
        {animatedMarkerPosition ? <Marker ref={markerRef} position={animatedMarkerPosition} icon={vehicleIcon} /> : null}
        <DirectionMarkers
          pathPoints={directionPathPoints}
          activeIndex={directionPathIndex}
          isVisible={showDirectionMarkers}
        />
        <MapFocus point={activePoint} tripKey={tripKey} />
        <ReplayFollower point={normalizedAnimatedPoint} heading={animatedPoint?.heading} enabled={focusMode === "map" && isPlaying} />
        <ManualCenter target={manualCenter} />
        <MapResizeHandler />
      </MapContainer>
    </div>
  );
}

function DirectionMarkers({ pathPoints = [], activeIndex = 0, isVisible = false }) {
  const map = useMap();
  const layerRef = useRef(null);
  const lastUpdateRef = useRef(0);

  useEffect(() => {
    if (!map) return undefined;
    if (!layerRef.current) {
      layerRef.current = L.layerGroup().addTo(map);
    }
    return () => {
      if (layerRef.current) {
        layerRef.current.clearLayers();
        if (map.hasLayer(layerRef.current)) {
          map.removeLayer(layerRef.current);
        }
        layerRef.current = null;
      }
    };
  }, [map]);

  useEffect(() => {
    if (!layerRef.current) return;
    const now = Date.now();
    if (now - lastUpdateRef.current < 160) return;
    lastUpdateRef.current = now;
    layerRef.current.clearLayers();
    if (!isVisible || pathPoints.length < 2) return;
    if (typeof map?.getZoom === "function" && map.getZoom() < 14) return;

    const clampedIndex = Math.min(Math.max(activeIndex, 0), pathPoints.length - 2);
    const current = pathPoints[clampedIndex];
    if (!current) return;

    const radiusMeters = 280;
    const maxMarkers = 4;
    const maxAhead = 40;
    const minSpacing = 60;
    let added = 0;
    let lastMarkerPoint = current;

    for (let idx = clampedIndex + 1; idx <= Math.min(pathPoints.length - 2, clampedIndex + maxAhead); idx += 1) {
      const point = pathPoints[idx];
      const next = pathPoints[idx + 1];
      if (!point || !next) continue;
      const distanceFromCurrent = haversineDistance(current, point);
      if (!Number.isFinite(distanceFromCurrent) || distanceFromCurrent > radiusMeters) break;
      if (haversineDistance(lastMarkerPoint, point) < minSpacing) continue;

      const heading = computeHeading(point, next);
      const icon = L.divIcon({
        className: "trip-direction-marker",
        html: `
          <div style="width:16px;height:16px;transform: rotate(${heading}deg);opacity:0.78;">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="rgba(74,163,255,0.85)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M5 12h12" />
              <path d="M13 6l6 6-6 6" />
            </svg>
          </div>
        `,
        iconSize: [16, 16],
        iconAnchor: [8, 8],
      });
      L.marker([point.lat, point.lng], { icon, interactive: false, keyboard: false }).addTo(layerRef.current);
      lastMarkerPoint = point;
      added += 1;
      if (added >= maxMarkers) break;
    }
  }, [activeIndex, isVisible, pathPoints]);

  return null;
}

function MapFocus({ point, tripKey }) {
  const map = useMap();
  const lastViewRef = useRef(null);
  const retryRef = useRef(null);
  const attemptsRef = useRef(0);
  const tripKeyRef = useRef(null);

  useEffect(() => {
    if (!tripKey || tripKey === tripKeyRef.current) return;
    tripKeyRef.current = tripKey;
    lastViewRef.current = null;
  }, [tripKey]);

  useEffect(() => {
    if (!map) return undefined;

    let cancelled = false;

    const clearRetry = () => {
      if (retryRef.current) {
        clearTimeout(retryRef.current);
        retryRef.current = null;
      }
    };

    const applyView = () => {
      if (cancelled) return;
      if (!canInteractWithMap(map)) {
        clearRetry();
        if (attemptsRef.current >= 5) return;
        attemptsRef.current += 1;
        retryRef.current = setTimeout(() => {
          if (cancelled || !canInteractWithMap(map)) return;
          map.invalidateSize?.();
          applyView();
        }, 180);
        return;
      }
      const normalized = normalizeLatLng(point);
      const target = normalized ? [normalized.lat, normalized.lng] : FALLBACK_CENTER;
      const zoom = lastViewRef.current ? map.getZoom() : normalized ? DEFAULT_ZOOM : FALLBACK_ZOOM;
      const key = `${target[0]},${target[1]},${zoom}`;
      const shouldCenter = !lastViewRef.current || point?.index === 0;

      if (!shouldCenter || lastViewRef.current === key) return;

      const size = map.getSize();
      if (size.x === 0 || size.y === 0) {
        clearRetry();
        if (attemptsRef.current >= 5) return;
        attemptsRef.current += 1;
        retryRef.current = setTimeout(() => {
          if (cancelled) return;
          if (!canInteractWithMap(map)) return;
          map.invalidateSize?.();
          applyView();
        }, 180);
        return;
      }

      attemptsRef.current = 0;
      lastViewRef.current = key;
      if (!canInteractWithMap(map)) return;
      map.setView(target, zoom, { animate: false });
    };

    map.whenReady(applyView);

    return () => {
      cancelled = true;
      clearRetry();
    };
  }, [map, point]);
  return null;
}

function ReplayFollower({ point, heading, enabled }) {
  const map = useMap();
  const lastPanRef = useRef(0);
  const lastKeyRef = useRef(null);

  useEffect(() => {
    if (!map || !point || !enabled || !canInteractWithMap(map)) return undefined;

    const normalized = normalizeLatLng(point);
    if (!normalized) return undefined;

    const targetOffset = offsetPoint(normalized, heading, EVENT_OFFSET_METERS) || normalized;
    const key = `${normalized.lat.toFixed(5)},${normalized.lng.toFixed(5)}`;
    const now = Date.now();
    const alreadyViewed = lastKeyRef.current === key;
    const withinThrottle = now - lastPanRef.current < 350;

    if (alreadyViewed && withinThrottle) return undefined;

    lastKeyRef.current = key;
    lastPanRef.current = now;

    const currentCenter = map.getCenter();
    const distanceFromCenter = haversineDistance(
      { lat: currentCenter.lat, lng: currentCenter.lng },
      { lat: targetOffset.lat, lng: targetOffset.lng },
    );

    if (distanceFromCenter < 5) return undefined;

    if (!canInteractWithMap(map)) return undefined;
    map.panTo([targetOffset.lat, targetOffset.lng], { animate: true });

    return undefined;
  }, [enabled, heading, map, point]);

  return null;
}

function ManualCenter({ target }) {
  const map = useMap();
  const lastTsRef = useRef(null);

  useEffect(() => {
    if (!map || !target || !canInteractWithMap(map)) return undefined;
    if (!Number.isFinite(target.lat) || !Number.isFinite(target.lng)) return undefined;
    if (lastTsRef.current === target.ts) return undefined;
    lastTsRef.current = target.ts;

    if (!canInteractWithMap(map)) return undefined;
    const zoom = Number.isFinite(target.zoom) ? target.zoom : map.getZoom();
    map.flyTo([target.lat, target.lng], zoom, { animate: true });

    return undefined;
  }, [map, target]);

  return null;
}

function MapResizeHandler() {
  const map = useMap();
  const timeoutRef = useRef(null);

  useEffect(() => {
    if (!map) return undefined;

    const scheduleInvalidate = (delay = 200) => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => {
        if (!canInteractWithMap(map)) return;
        map.whenReady(() => {
          if (!canInteractWithMap(map)) return;
          map.invalidateSize?.();
        });
      }, delay);
    };

    scheduleInvalidate(200);

    const handleResize = () => scheduleInvalidate(250);

    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [map]);

  return null;
}

function TimelineTable({
  entries = [],
  activeIndex,
  onSelect,
  locale,
  columns = [],
  resolveAddress,
  focusMode,
  isPlaying,
}) {
  const rowRefs = useRef(new Map());

  useEffect(() => {
    rowRefs.current = new Map();
  }, [entries]);

  useEffect(() => {
    if (focusMode !== "table") return;
    const activeRow = rowRefs.current.get(activeIndex);
    if (!activeRow || typeof activeRow.scrollIntoView !== "function") return;
    activeRow.scrollIntoView({ behavior: isPlaying ? "smooth" : "auto", block: "nearest", inline: "nearest" });
  }, [activeIndex, entries, focusMode, isPlaying]);

  if (entries.length === 0) {
    return (
      <div className="rounded-md border border-white/10 bg-white/5 p-3 text-sm text-white/60">
        Nenhum ponto carregado para este trajeto.
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-white/10 bg-white/5">
      <div className="max-h-[460px] overflow-y-auto">
        <table className="min-w-full text-xs text-white/80">
          <thead className="sticky top-0 bg-slate-900/80 backdrop-blur">
            <tr>
              {columns.map((column) => {
                const alignment =
                  column.align === "right" ? "text-right" : column.align === "center" ? "text-center" : "text-left";
                return (
                  <th key={column.key} className={`px-3 py-2 font-semibold text-white ${alignment}`}>
                    {column.label}
                  </th>
                );
              })}
              <th className="px-3 py-2 text-right font-semibold text-white">Ação</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => {
              const isActive = entry.index === activeIndex;
              return (
                <tr
                  key={`${entry.index}-${entry.time?.toISOString?.() ?? entry.index}`}
                  ref={(node) => {
                    if (node) {
                      rowRefs.current.set(entry.index, node);
                    } else {
                      rowRefs.current.delete(entry.index);
                    }
                  }}
                  className={`cursor-pointer border-b border-white/5 transition ${
                    isActive ? "bg-primary/10 text-white" : "hover:bg-white/5"
                  }`}
                  onClick={() => onSelect?.(entry.index, { centerMap: true })}
                >
                  {columns.map((column) => {
                    const alignment =
                      column.align === "right" ? "text-right" : column.align === "center" ? "text-center" : "text-left";
                    const wrapClass = column.allowWrap ? "" : "whitespace-nowrap";
                    const rawContent =
                      column.key === "address"
                        ? resolveAddress?.(entry)
                        : column.render
                          ? column.render(entry)
                          : entry[column.key];
                    const content = normalizeTimelineCellValue(rawContent);
                    return (
                      <td key={`${entry.index}-${column.key}`} className={`px-3 py-2 text-white/80 ${alignment} ${wrapClass}`}>
                        {content}
                      </td>
                    );
                  })}
                  <td className="px-3 py-2 text-right">
                    <button
                      type="button"
                      className="rounded-md border border-white/15 bg-white/10 px-3 py-1 text-xs font-semibold text-white transition hover:border-primary/50 hover:bg-primary/20"
                      onClick={(event) => {
                        event.stopPropagation();
                        onSelect?.(entry.index, { centerMap: true });
                      }}
                    >
                      Ver/Ir
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function normalizeTimelineCellValue(value) {
  if (React.isValidElement(value)) return value;
  if (value === null || value === undefined) return "—";
  if (value instanceof Date) return value.toLocaleString();
  if (typeof value === "object") {
    const formatted = normalizeAddressCandidate(value);
    if (formatted) return formatted;
    if (value?.display_name) return String(value.display_name);
    if (value?.formattedAddress) return String(value.formattedAddress);
    if (value?.formatted) return String(value.formatted);
    try {
      return JSON.stringify(value);
    } catch (_error) {
      return String(value);
    }
  }
  return value;
}

function EventPanel({
  events = [],
  selectedType,
  onSelectType,
  totalTimeline = 0,
  currentLabel,
  eventIndex = 0,
  eventTotal = 0,
  onPrev,
  onNext,
  className = "",
}) {
  const hasEvents = events.length > 0;
  const totalCount = totalTimeline || events.reduce((sum, event) => sum + (event.count || 0), 0);
  const filters = [{ type: "all", label: "Todos", count: totalTimeline }, ...events];
  const resolvedEventTotal = Number.isFinite(eventTotal) ? eventTotal : totalCount;
  const resolvedEventIndex = Number.isFinite(eventIndex) ? eventIndex : 0;
  const showNav = resolvedEventTotal > 0;

  return (
    <div className={`flex min-h-0 flex-col rounded-xl border border-white/10 bg-white/5 p-3 ${className}`}>
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold text-white">Eventos do trajeto</div>
        <div className="text-xs text-white/60">{totalCount} ocorrência(s)</div>
      </div>

      <div className="mt-3 rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-xs text-white/70">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="text-[11px] text-white/50">Evento atual</div>
            <div className="truncate text-sm font-semibold text-white">{currentLabel || "Nenhum evento"}</div>
            <div className="text-[11px] text-white/40">
              {showNav ? `${resolvedEventIndex} / ${resolvedEventTotal}` : "—"}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="rounded-full border border-white/10 bg-white/5 px-2 py-1 text-xs text-white/80 transition hover:border-primary/50"
              onClick={() => onPrev?.()}
              disabled={!showNav}
              title="Evento anterior"
            >
              ◀
            </button>
            <button
              type="button"
              className="rounded-full border border-white/10 bg-white/5 px-2 py-1 text-xs text-white/80 transition hover:border-primary/50"
              onClick={() => onNext?.()}
              disabled={!showNav}
              title="Próximo evento"
            >
              ▶
            </button>
          </div>
        </div>
      </div>

      {hasEvents ? (
        <div className="mt-3 flex-1 min-h-0">
          <div className="h-full space-y-2 overflow-y-auto pr-1">
            {filters.map((event) => {
              const isAll = event.type === "all";
              const isActive = (!selectedType && isAll) || selectedType === event.type;
              return (
                <button
                  key={event.type}
                  type="button"
                  onClick={() => onSelectType?.(isAll ? "all" : event.type)}
                  className={`w-full rounded-lg border px-3 py-2 text-left text-sm transition ${
                    isActive
                      ? "border-primary/60 bg-primary/10 text-white"
                      : "border-white/10 bg-white/5 text-white/80 hover:border-primary/40"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-3">
                      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-white/5 text-base">
                        {isAll ? "•" : event.icon || "•"}
                      </div>
                      <div className="flex flex-col">
                        <span className="font-semibold">{isAll ? "Todos" : event.label}</span>
                        <span className="text-[11px] text-white/60">Clique para filtrar</span>
                      </div>
                    </div>
                    <span className="text-sm font-semibold text-white">({event.count ?? totalTimeline})</span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="mt-3 rounded-lg border border-white/10 bg-white/5 p-3 text-sm text-white/60">
          Nenhum evento identificado para este trajeto.
        </div>
      )}
    </div>
  );
}

export default function Trips() {
  const { locale, t } = useTranslation();
  const { mirrorContextMode, mirrorModeEnabled, activeMirror, activeMirrorOwnerClientId } = useTenant();
  const mirrorOwnerClientId = activeMirror?.ownerClientId ?? activeMirrorOwnerClientId;
  const mirrorHeaders = useMemo(
    () => resolveMirrorHeaders({ mirrorModeEnabled, mirrorOwnerClientId }),
    [mirrorModeEnabled, mirrorOwnerClientId],
  );
  const shouldWaitForMirror = mirrorContextMode === "target" && mirrorModeEnabled !== false && !mirrorHeaders;
  const location = useLocation();
  const navigate = useNavigate();
  const {
    vehicles,
    vehicleOptions,
    loading: loadingVehicles,
    error: vehiclesError,
  } = useVehicles({ includeTelemetry: false });
  const {
    selectedVehicleId: vehicleId,
    selectedTelemetryDeviceId: deviceIdFromStore,
    selectedVehicle,
    setVehicleSelection,
  } = useVehicleSelection({ syncQuery: true });
  const { data, loading, error, generateTripsReport, downloadTripsCsv } = useReports();
  const {
    data: routeData,
    loading: routeLoading,
    error: routeError,
    generate: generateRoute,
  } = useReportsRoute();

  const [from, setFrom] = useState(DEFAULT_FROM);
  const [to, setTo] = useState(DEFAULT_TO);
  const [formError, setFormError] = useState("");
  const [feedback, setFeedback] = useState(null);
  const [downloading, setDownloading] = useState(false);
  const [selectedTrip, setSelectedTrip] = useState(null);
  const [itineraryList, setItineraryList] = useState([]);
  const [itineraryListLoading, setItineraryListLoading] = useState(false);
  const [itineraryListError, setItineraryListError] = useState(null);
  const [tripItineraryHistory, setTripItineraryHistory] = useState([]);
  const [selectedItineraryId, setSelectedItineraryId] = useState("");
  const [itineraryOverlay, setItineraryOverlay] = useState(null);
  const [itineraryOverlayLoading, setItineraryOverlayLoading] = useState(false);
  const [itineraryOverlayError, setItineraryOverlayError] = useState(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackTimeMs, setPlaybackTimeMs] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [mapLayerKey, setMapLayerKey] = useState(DEFAULT_MAP_LAYER_KEY);
  const [selectedEventType, setSelectedEventType] = useState(null);
  const [eventCursor, setEventCursor] = useState(0);
  const [timelineFilter, setTimelineFilter] = useState("all");
  const [animatedPoint, setAnimatedPoint] = useState(null);
  const [focusMode, setFocusMode] = useState("map");
  const [columnPickerOpen, setColumnPickerOpen] = useState(false);
  const [manualCenter, setManualCenter] = useState(null);
  const [selectedColumns, setSelectedColumns] = useState(() => loadStoredColumns() || DEFAULT_COLUMN_PRESET);
  const [mapMatchingEnabled, setMapMatchingEnabled] = useState(true);
  const [mapMatchingLoading, setMapMatchingLoading] = useState(false);
  const [mapMatchingError, setMapMatchingError] = useState(null);
  const [mapMatchedPath, setMapMatchedPath] = useState(null);
  const [mapMatchingResult, setMapMatchingResult] = useState(null);
  const [mapMatchingNotice, setMapMatchingNotice] = useState(null);
  const [mapMatchingProvider, setMapMatchingProvider] = useState(null);
  const [logicalRouteEnabled, setLogicalRouteEnabled] = useState(false);
  const [logicalRouteLoading, setLogicalRouteLoading] = useState(false);
  const [logicalRouteError, setLogicalRouteError] = useState(null);
  const [logicalRoutePath, setLogicalRoutePath] = useState(null);
  const [logicalRouteProvider, setLogicalRouteProvider] = useState(null);
  const [activeTab, setActiveTab] = useState("replay");
  const [tripSearch, setTripSearch] = useState("");
  const [positionsSearch, setPositionsSearch] = useState("");
  const [auditSearch, setAuditSearch] = useState("");
  const [eventSearch, setEventSearch] = useState("");
  const [eventsReloadToken, setEventsReloadToken] = useState(0);
  const [drawerTab, setDrawerTab] = useState("events");
  const [expandedTripKey, setExpandedTripKey] = useState(null);
  const [tripEventsRaw, setTripEventsRaw] = useState([]);
  const [tripEventsLoading, setTripEventsLoading] = useState(false);
  const [tripEventsError, setTripEventsError] = useState(null);
  const [tripEventsLoaded, setTripEventsLoaded] = useState(false);
  const mapMatchingCacheRef = useRef(new Map());
  const logicalRouteCacheRef = useRef(new Map());
  const itineraryOverlayRequestRef = useRef(0);
  const lastAvailableColumnsRef = useRef("");
  const initialisedRef = useRef(false);
  const autoGenerateRef = useRef(false);
  const lastQuerySelectionRef = useRef({ vehicleId: "", deviceId: "" });
  const playbackTimeRef = useRef(0);
  const activeIndexRef = useRef(0);
  const playbackBoundsRef = useRef({ start: 0, end: 0 });
  const routePointsRef = useRef([]);
  const routeTimesRef = useRef([]);
  const speedRef = useRef(1);
  const rafRef = useRef(null);
  const lastFrameRef = useRef(null);
  const debugLogRef = useRef(0);
  const animatedLivePointRef = useRef(null);
  const playbackUiUpdateRef = useRef(0);
  const animatedUiUpdateRef = useRef(0);
  const lastItineraryVehicleRef = useRef("");
  const deviceId = deviceIdFromStore || selectedVehicle?.primaryDeviceId || "";
  const deviceUnavailable = Boolean(vehicleId) && !deviceId;
  const selectedTripRange = useMemo(() => {
    if (!selectedTrip) return null;
    const start = parseDate(resolveTripTimeValue(selectedTrip, "start"));
    const end = parseDate(resolveTripTimeValue(selectedTrip, "end"));
    if (!start || !end) return null;
    return { from: start.toISOString(), to: end.toISOString() };
  }, [selectedTrip]);
  const lastCenteredTripKeyRef = useRef("");
  const tripDeviceId = useMemo(
    () => selectedTrip?.deviceId || selectedTrip?.device_id || deviceId || null,
    [deviceId, selectedTrip?.deviceId, selectedTrip?.device_id],
  );

  useEffect(() => {
    const nextKey = vehicleId ? String(vehicleId) : "";
    if (lastItineraryVehicleRef.current !== nextKey) {
      setSelectedItineraryId("");
      setItineraryOverlay(null);
    }
    lastItineraryVehicleRef.current = nextKey;
  }, [vehicleId]);

  useEffect(() => {
    if (!vehicleId || !selectedTripRange || shouldWaitForMirror) {
      setTripItineraryHistory([]);
      setItineraryList([]);
      setItineraryListError(null);
      setSelectedItineraryId("");
      setItineraryOverlay(null);
      return;
    }
    let cancelled = false;
    setItineraryListLoading(true);
    setItineraryListError(null);
    safeApi
      .get(API_ROUTES.itineraryEmbarkVehicleHistory(vehicleId), {
        headers: mirrorHeaders,
        params: {
          from: selectedTripRange.from,
          to: selectedTripRange.to,
        },
        suppressForbidden: true,
        forbiddenFallbackData: [],
      })
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          setTripItineraryHistory([]);
          setItineraryList([]);
          setItineraryListError(error);
          return;
        }
        const history = Array.isArray(data?.data)
          ? data.data
          : Array.isArray(data?.history)
          ? data.history
          : Array.isArray(data)
          ? data
          : [];
        setTripItineraryHistory(history);
      })
      .catch((requestError) => {
        if (cancelled) return;
        setTripItineraryHistory([]);
        setItineraryList([]);
        setItineraryListError(requestError);
      })
      .finally(() => {
        if (!cancelled) setItineraryListLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [mirrorHeaders, selectedTripRange, shouldWaitForMirror, vehicleId]);

  useEffect(() => {
    if (!selectedItineraryId) {
      setItineraryOverlay(null);
      setItineraryOverlayError(null);
      setItineraryOverlayLoading(false);
      return;
    }
    if (shouldWaitForMirror) return;
    const requestId = itineraryOverlayRequestRef.current + 1;
    itineraryOverlayRequestRef.current = requestId;
    let cancelled = false;
    setItineraryOverlayLoading(true);
    setItineraryOverlayError(null);
    safeApi
      .get(API_ROUTES.itineraryOverlayById(selectedItineraryId), {
        headers: mirrorHeaders,
        suppressForbidden: true,
        forbiddenFallbackData: null,
      })
      .then(({ data, error }) => {
        if (cancelled || itineraryOverlayRequestRef.current !== requestId) return;
        if (error) {
          setItineraryOverlay(null);
          setItineraryOverlayError(error);
          return;
        }
        const payload = data?.data ?? data ?? null;
        setItineraryOverlay(payload);
      })
      .catch((requestError) => {
        if (cancelled || itineraryOverlayRequestRef.current !== requestId) return;
        setItineraryOverlay(null);
        setItineraryOverlayError(requestError);
      })
      .finally(() => {
        if (cancelled || itineraryOverlayRequestRef.current !== requestId) return;
        setItineraryOverlayLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [mirrorHeaders, selectedItineraryId, shouldWaitForMirror]);

  const itineraryOptions = useMemo(
    () => buildTripItineraryOptions(tripItineraryHistory),
    [tripItineraryHistory],
  );

  useEffect(() => {
    setItineraryList(itineraryOptions);
  }, [itineraryOptions]);

  useEffect(() => {
    if (!selectedItineraryId) return;
    const exists = itineraryList.some((item) => String(item?.id ?? "") === String(selectedItineraryId));
    if (!exists) {
      setSelectedItineraryId("");
    }
  }, [itineraryList, selectedItineraryId]);

  const selectedItineraryMeta = useMemo(
    () => itineraryList.find((item) => String(item?.id ?? "") === String(selectedItineraryId)) || null,
    [itineraryList, selectedItineraryId],
  );
  const itinerarySelectOptions = useMemo(
    () =>
      itineraryList.map((item) => ({
        value: String(item.id),
        label: item.name || item.id,
        description: item.statusLabel ? `Status: ${item.statusLabel}` : "",
      })),
    [itineraryList],
  );
  const itineraryConfirmed = Boolean(selectedItineraryMeta?.confirmed);
  const itineraryBufferLabel = useMemo(() => {
    const raw = Number(itineraryOverlay?.bufferMeters);
    if (!Number.isFinite(raw) || raw <= 0) return "—";
    return `${Math.round(raw)} m`;
  }, [itineraryOverlay?.bufferMeters]);
  const shouldShowItinerarySelector =
    itineraryListLoading || Boolean(itineraryListError) || itineraryList.length > 0;

  const vehicleByDeviceId = useMemo(() => {
    const map = new Map();
    vehicles.forEach((vehicle) => {
      normalizeVehicleDevices(vehicle).forEach((device) => {
        const key = toDeviceKey(device?.id ?? device?.deviceId ?? device?.uniqueId ?? device?.traccarId);
        if (key) map.set(String(key), vehicle);
      });
    });
    return map;
  }, [vehicles]);

  const trips = useMemo(
    () => (Array.isArray(data?.trips) ? data.trips : Array.isArray(data) ? data : []),
    [data],
  );

  const filteredTrips = useMemo(() => {
    const query = tripSearch.trim().toLowerCase();
    if (!query) return trips;
    return trips.filter((trip) => {
      const startValue = resolveTripTimeValue(trip, "start");
      const endValue = resolveTripTimeValue(trip, "end");
      const haystack = [
        trip.startAddress,
        trip.startShortAddress,
        trip.start?.address,
        trip.endAddress,
        trip.endShortAddress,
        trip.end?.address,
        startValue,
        endValue,
        resolveTripDistanceMeters(trip),
        resolveTripDurationSeconds(trip),
        resolveTripAverageSpeed(trip),
        resolveTripMaxSpeed(trip),
      ]
        .filter((value) => value !== null && value !== undefined)
        .join(" ")
        .toLowerCase();
      return haystack.includes(query);
    });
  }, [tripSearch, trips]);

  const rawRoutePoints = useMemo(() => {
    const positions = Array.isArray(routeData?.positions)
      ? routeData.positions
      : Array.isArray(routeData?.data)
        ? routeData.data
        : [];

    const normalized = positions
      .map((point, index) => {
        const lat = pickCoordinate([point.latitude, point.lat, point.lat_deg]);
        const lng = pickCoordinate([point.longitude, point.lon, point.lng]);
        const time = parseDate(point.fixTime || point.deviceTime || point.serverTime || point.time);
        const coords = normalizeLatLng({ lat, lng });

        if (!coords) return null;
        const resolvedTime = time ? time.getTime() : 0;

        const mappedEvent = normalizeTripEvent(point, { locale, t });
        const translatedLabel =
          mappedEvent?.label ||
          translateTripEvent(
            point.event ||
              point.type ||
              point.attributes?.event ||
              point.attributes?.alarm ||
              point.attributes?.status ||
              "Posição",
          );

        const heading = toFiniteNumber(
          point.course ?? point.heading ?? point.attributes?.course ?? point.attributes?.heading,
        );
        const reportedIgnition =
          typeof point.attributes?.ignition === "boolean"
            ? point.attributes.ignition
            : typeof point.ignition === "boolean"
              ? point.ignition
              : null;
        const odometer = toFiniteNumber(point.attributes?.odometer ?? point.odometer);
        const altitude = toFiniteNumber(point.altitude ?? point.attributes?.altitude);
        const satellites = toFiniteNumber(point.attributes?.sat ?? point.satellites);
        const battery = toFiniteNumber(
          point.attributes?.batteryLevel ?? point.attributes?.battery ?? point.batteryLevel ?? point.battery,
        );
        const motion =
          typeof point.attributes?.motion === "boolean"
            ? point.attributes.motion
            : typeof point.motion === "boolean"
              ? point.motion
              : null;
        const backendAddress = formatPointAddress(point);
        const addressKey = point.addressKey || buildCoordKey(coords.lat, coords.lng) || null;

        return {
          ...point,
          ...coords,
          __time: time,
          __severity: normalizeSeverityFromPoint(point),
          __address: backendAddress,
          __addressKey: addressKey,
          __geocodeStatus: point.geocodeStatus || null,
          __speed: pickSpeed(point),
          __label: translatedLabel,
          __event: mappedEvent,
          __index: index,
          __heading: heading,
          __reportedIgnition: reportedIgnition,
          __odometer: odometer,
          __altitude: altitude,
          __satellites: satellites,
          __battery: battery,
          __motion: motion,
          __attributes: point.attributes || {},
          t: resolvedTime,
        };
      })
      .filter(Boolean);

    const sorted = normalized.sort((a, b) => {
      const aTime = a.__time ? a.__time.getTime() : 0;
      const bTime = b.__time ? b.__time.getTime() : 0;
      if (aTime === bTime) return a.__index - b.__index;
      return aTime - bTime;
    });

    let lastIgnition = null;
    return sorted.map((point, index) => {
      const eventIgnition =
        typeof point.__event?.ignition === "boolean" ? point.__event.ignition : null;
      let persistentIgnition = lastIgnition;
      if (typeof eventIgnition === "boolean") {
        persistentIgnition = eventIgnition;
      } else if (persistentIgnition === null && typeof point.__reportedIgnition === "boolean") {
        persistentIgnition = point.__reportedIgnition;
      }
      if (typeof persistentIgnition === "boolean") {
        lastIgnition = persistentIgnition;
      }
      return {
        ...point,
        index,
        __ignition:
          typeof persistentIgnition === "boolean" ? persistentIgnition : point.__reportedIgnition,
      };
    });
  }, [locale, routeData, t]);

  const matchedRoutePoints = useMemo(() => {
    if (!mapMatchingEnabled) return null;
    const tracepoints = mapMatchingResult?.tracepoints || mapMatchingResult?.data?.tracepoints;
    if (!Array.isArray(tracepoints) || !tracepoints.length) return null;
    const matchByIndex = new Map();
    tracepoints.forEach((item) => {
      const idx = Number(item?.originalIndex);
      if (!Number.isInteger(idx)) return;
      const lat = toFiniteNumber(item?.lat ?? item?.latitude);
      const lng = toFiniteNumber(item?.lng ?? item?.lon ?? item?.longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
      matchByIndex.set(idx, { lat, lng });
    });
    if (!matchByIndex.size) return null;
    return rawRoutePoints.map((point, index) => {
      const matched = matchByIndex.get(index);
      if (!matched) return point;
      return { ...point, lat: matched.lat, lng: matched.lng, __matched: true };
    });
  }, [mapMatchingEnabled, mapMatchingResult?.data?.tracepoints, mapMatchingResult?.tracepoints, rawRoutePoints]);

  const baseRoutePoints = useMemo(
    () => (mapMatchingEnabled && matchedRoutePoints ? matchedRoutePoints : rawRoutePoints),
    [mapMatchingEnabled, matchedRoutePoints, rawRoutePoints],
  );

  const logicalRouteEndpoints = useMemo(() => {
    if (!logicalRouteEnabled) return null;
    const validPoints = rawRoutePoints.filter((point) => Number.isFinite(point?.lat) && Number.isFinite(point?.lng));
    if (validPoints.length < 2) return null;
    const start = validPoints[0];
    const end = validPoints[validPoints.length - 1];
    return [
      { lat: start.lat, lng: start.lng, t: start.t },
      { lat: end.lat, lng: end.lng, t: end.t },
    ];
  }, [logicalRouteEnabled, rawRoutePoints]);

  const preferredPath = useMemo(() => {
    if (mapMatchingEnabled && mapMatchedPath?.length) return mapMatchedPath;
    if (logicalRouteEnabled && logicalRoutePath?.length) return logicalRoutePath;
    return null;
  }, [logicalRouteEnabled, logicalRoutePath, mapMatchedPath, mapMatchingEnabled]);

  const routePoints = useMemo(() => {
    if (!preferredPath || baseRoutePoints.length < 2) return baseRoutePoints;
    return alignPointsToPath(baseRoutePoints, preferredPath);
  }, [baseRoutePoints, preferredPath]);

  const applyMapMatchingResult = useCallback((result) => {
    const normalized = normalizeMapMatchingResponse(result);
    const provider = normalized?.provider || normalized?.data?.provider || null;
    const providerKey = provider ? String(provider).toLowerCase() : null;
    const geometry = normalized?.geometry || [];
    const shouldUseGeometry = providerKey === "osrm" && geometry.length >= 2;
    const notice = normalized?.notice || normalized?.data?.notice || null;
    setMapMatchingProvider(providerKey);
    setMapMatchingResult(normalized);
    setMapMatchedPath(shouldUseGeometry ? geometry : null);
    if (providerKey === "passthrough") {
      setMapMatchingNotice(
        notice || "OSRM não configurado -> sem map matching. Configure OSRM_BASE_URL no backend.",
      );
    } else if (providerKey === "osrm") {
      setMapMatchingNotice("Rota ajustada via OSRM (provider=osrm).");
    } else if (providerKey) {
      setMapMatchingNotice(`Provider: ${providerKey}`);
    } else {
      setMapMatchingNotice(null);
    }
    if (shouldUseGeometry || providerKey === "passthrough") {
      setMapMatchingError(null);
    }
    return normalized;
  }, []);

  const applyLogicalRouteResult = useCallback((result) => {
    const normalized = normalizeMapRouteResponse(result);
    const providerKey = normalized?.provider ? String(normalized.provider).toLowerCase() : null;
    setLogicalRouteProvider(providerKey);
    setLogicalRoutePath(normalized?.geometry?.length ? normalized.geometry : null);
    if (providerKey === "passthrough" || providerKey === "osrm-route") {
      setLogicalRouteError(null);
    }
    return normalized;
  }, []);

  const mapMatchingCacheKey = useMemo(() => {
    if (!mapMatchingEnabled) return null;
    const tripKey = selectedTrip?.id || selectedTrip?.startTime || playbackBoundsRef.current?.start || "";
    const deviceKey = deviceId || vehicleId || "unknown";
    if (!tripKey && !rawRoutePoints.length) return null;
    return `${deviceKey}:${tripKey}:${rawRoutePoints.length}:${rawRoutePoints[0]?.t || 0}:${rawRoutePoints[rawRoutePoints.length - 1]?.t || 0}`;
  }, [deviceId, mapMatchingEnabled, rawRoutePoints, selectedTrip?.id, selectedTrip?.startTime, vehicleId]);

  const logicalRouteCacheKey = useMemo(() => {
    if (!logicalRouteEnabled) return null;
    if (!logicalRouteEndpoints || logicalRouteEndpoints.length < 2) return null;
    const [start, end] = logicalRouteEndpoints;
    const baseKey = selectedTrip?.id || playbackBoundsRef.current?.start || "route";
    return `${deviceId || vehicleId || "unknown"}:${baseKey}:${start.lat.toFixed(5)},${start.lng.toFixed(5)}:${end.lat.toFixed(5)},${end.lng.toFixed(5)}`;
  }, [deviceId, logicalRouteEnabled, logicalRouteEndpoints, selectedTrip?.id, vehicleId]);

  const playbackBounds = useMemo(() => {
    if (!routePoints.length) return { start: 0, end: 0 };
    return { start: routePoints[0].t || 0, end: routePoints[routePoints.length - 1].t || 0 };
  }, [routePoints]);

  useEffect(() => {
    routePointsRef.current = routePoints;
    routeTimesRef.current = routePoints.map((point) => point.t || 0);
  }, [routePoints]);

  useEffect(() => {
    if (!selectedTrip) return;
    if (!routePoints.length) return;
    const tripKey = resolveTripKey(selectedTrip);
    if (!tripKey || lastCenteredTripKeyRef.current === tripKey) return;
    if (selectedTripRange?.from && selectedTripRange?.to) {
      const startMs = new Date(selectedTripRange.from).getTime();
      const endMs = new Date(selectedTripRange.to).getTime();
      const firstTime = routePoints[0]?.t;
      if (Number.isFinite(firstTime)) {
        const margin = 5 * 60 * 1000;
        if (firstTime < startMs - margin || firstTime > endMs + margin) return;
      }
    }
    const firstPoint = routePoints[0];
    if (!firstPoint || !Number.isFinite(firstPoint.lat) || !Number.isFinite(firstPoint.lng)) return;
    lastCenteredTripKeyRef.current = tripKey;
    setManualCenter({ lat: firstPoint.lat, lng: firstPoint.lng, ts: Date.now(), zoom: DEFAULT_ZOOM });
  }, [routePoints, selectedTrip, selectedTripRange]);

  useEffect(() => {
    if (shouldWaitForMirror) {
      setTripEventsRaw([]);
      setTripEventsLoading(false);
      setTripEventsError(null);
      setTripEventsLoaded(false);
      return;
    }
    if (!tripDeviceId || !selectedTripRange?.from || !selectedTripRange?.to) {
      setTripEventsRaw([]);
      setTripEventsLoading(false);
      setTripEventsError(null);
      setTripEventsLoaded(false);
      return;
    }
    let isActive = true;
    setTripEventsLoading(true);
    setTripEventsError(null);
    setTripEventsLoaded(false);
    setTripEventsRaw([]);
    const params = buildEventParams({
      deviceId: tripDeviceId,
      from: selectedTripRange.from,
      to: selectedTripRange.to,
      limit: 2000,
    });
    params.reportEventScope = "all";
    if (process.env.NODE_ENV !== "production") {
      // eslint-disable-next-line no-console
      console.debug("[trips] fetch events", params);
    }
    safeApi
      .get(API_ROUTES.traccar.events, { params, headers: mirrorHeaders })
      .then(({ data, error }) => {
        if (!isActive) return;
        if (error) throw error;
        const list = Array.isArray(data?.events)
          ? data.events
          : Array.isArray(data?.data?.events)
            ? data.data.events
            : Array.isArray(data?.data)
              ? data.data
              : Array.isArray(data)
                ? data
                : [];
        setTripEventsRaw(list);
        if (process.env.NODE_ENV !== "production") {
          // eslint-disable-next-line no-console
          console.debug("[trips] events loaded", list.length);
        }
      })
      .catch((requestError) => {
        if (!isActive) return;
        setTripEventsError(requestError?.message || "Erro ao carregar eventos do trajeto.");
        setTripEventsRaw([]);
      })
      .finally(() => {
        if (isActive) {
          setTripEventsLoading(false);
          setTripEventsLoaded(true);
        }
      });
    return () => {
      isActive = false;
    };
  }, [
    eventsReloadToken,
    mirrorHeaders,
    selectedTripRange?.from,
    selectedTripRange?.to,
    shouldWaitForMirror,
    tripDeviceId,
  ]);

  useEffect(() => {
    if (!mapMatchingEnabled) {
      setMapMatchedPath(null);
      setMapMatchingResult(null);
      setMapMatchingError(null);
      setMapMatchingNotice(null);
      setMapMatchingProvider(null);
      setMapMatchingLoading(false);
      return;
    }
    if (!rawRoutePoints.length) {
      setMapMatchingProvider(null);
      setMapMatchingNotice(null);
      return;
    }
    const cacheKey = mapMatchingCacheKey;
    if (cacheKey && mapMatchingCacheRef.current.has(cacheKey)) {
      const cached = applyMapMatchingResult(mapMatchingCacheRef.current.get(cacheKey));
      mapMatchingCacheRef.current.set(cacheKey, cached);
      return;
    }

    const sampled = sampleRouteForMatching(
      rawRoutePoints
        .map((point, index) => ({
          lat: point.lat,
          lng: point.lng,
          timestamp: point.t,
          originalIndex: index,
          heading: point.__heading,
          ignition: point.__ignition,
          motion: point.__motion,
          eventKey: point.__event?.label || point.__event?.type || point.__event?.key || point.__event?.name,
        }))
        .filter((point) => Number.isFinite(point.lat) && Number.isFinite(point.lng)),
      { maxPoints: MAP_MATCH_MAX_POINTS, minDistanceMeters: 20, bearingDeltaThreshold: 35 },
    );
    if (sampled.length < 2) {
      return;
    }

    const abortController = new AbortController();
    setMapMatchingLoading(true);
    setMapMatchingError(null);
    safeApi
      .post(
        API_ROUTES.mapMatching,
        {
          points: sampled,
          cacheKey,
          maxPoints: MAP_MATCH_MAX_POINTS,
          chunkSize: MAP_MATCH_CHUNK_SIZE,
          profile: MAP_MATCH_PROFILE,
          minDistanceMeters: 20,
          bearingDeltaThreshold: 35,
        },
        {
          timeout: 25_000,
          signal: abortController.signal,
          skipMirrorClient: true,
          headers: { "X-Mirror-Mode": "self" },
        },
      )
      .then(({ data, error }) => {
        if (abortController.signal.aborted) return;
        if (error) {
          throw error;
        }
        const normalized = applyMapMatchingResult(data);
        mapMatchingCacheRef.current.set(cacheKey || `anon:${Date.now()}`, normalized);
      })
      .catch((error) => {
        if (abortController.signal.aborted) return;
        setMapMatchedPath(null);
        setMapMatchingResult(null);
        setMapMatchingNotice(null);
        setMapMatchingError(
          error?.message || "Não foi possível ajustar a rota pelas ruas. Continuando com a rota original.",
        );
      })
      .finally(() => {
        if (!abortController.signal.aborted) {
          setMapMatchingLoading(false);
        }
      });

    return () => abortController.abort();
  }, [applyMapMatchingResult, mapMatchingCacheKey, mapMatchingEnabled, rawRoutePoints]);

  useEffect(() => {
    if (!logicalRouteEnabled) {
      setLogicalRoutePath(null);
      setLogicalRouteProvider(null);
      setLogicalRouteError(null);
      setLogicalRouteLoading(false);
      return;
    }
    if (!logicalRouteEndpoints || logicalRouteEndpoints.length < 2) {
      setLogicalRoutePath(null);
      setLogicalRouteProvider(null);
      return;
    }
    const cacheKey = logicalRouteCacheKey;
    if (cacheKey && logicalRouteCacheRef.current.has(cacheKey)) {
      const cached = applyLogicalRouteResult(logicalRouteCacheRef.current.get(cacheKey));
      logicalRouteCacheRef.current.set(cacheKey, cached);
      return;
    }

    const abortController = new AbortController();
    setLogicalRouteLoading(true);
    setLogicalRouteError(null);

    safeApi
      .post(
        API_ROUTES.mapRoute,
        {
          points: logicalRouteEndpoints,
          cacheKey,
          profile: LOGICAL_ROUTE_PROFILE,
        },
        { timeout: 20_000, signal: abortController.signal },
      )
      .then(({ data, error }) => {
        if (abortController.signal.aborted) return;
        if (error) {
          throw error;
        }
        const normalized = applyLogicalRouteResult(data);
        logicalRouteCacheRef.current.set(cacheKey || `anon-route:${Date.now()}`, normalized);
      })
      .catch((error) => {
        if (abortController.signal.aborted) return;
        setLogicalRoutePath(null);
        setLogicalRouteProvider(null);
        setLogicalRouteError(error?.message || "Não foi possível calcular rota lógica pelas ruas.");
      })
      .finally(() => {
        if (!abortController.signal.aborted) {
          setLogicalRouteLoading(false);
        }
      });

    return () => abortController.abort();
  }, [applyLogicalRouteResult, logicalRouteCacheKey, logicalRouteEnabled, logicalRouteEndpoints]);

  useEffect(() => {
    playbackBoundsRef.current = playbackBounds;
  }, [playbackBounds]);

  useEffect(() => {
    speedRef.current = Number.isFinite(speed) && speed > 0 ? speed : 1;
    if (isPlaying) {
      lastFrameRef.current = null;
    }
  }, [isPlaying, speed]);

  useEffect(() => {
    activeIndexRef.current = activeIndex;
    const targetTime = routePoints[activeIndex]?.t;
    if (!isPlaying && Number.isFinite(targetTime)) {
      playbackTimeRef.current = targetTime;
      setPlaybackTimeMs((prev) => (prev === targetTime ? prev : targetTime));
      const current = routePoints[activeIndex];
      const next = routePoints[Math.min(activeIndex + 1, routePoints.length - 1)] || current;
      const previous = routePoints[Math.max(activeIndex - 1, 0)] || current;
      const heading = computeHeading(current, next !== current ? next : previous);
      animatedLivePointRef.current = current
        ? { lat: current.lat, lng: current.lng, heading, t: targetTime }
        : animatedLivePointRef.current;
    }
  }, [activeIndex, animatedLivePointRef, isPlaying, routePoints]);

  const activePoint = useMemo(() => routePoints[activeIndex] || routePoints[0] || null, [activeIndex, routePoints]);
  const smoothedRoute = useMemo(() => smoothRoute(routePoints), [routePoints]);
  const smoothedPath = useMemo(() => densifyPath(smoothedRoute), [smoothedRoute]);
  const pathToRender = useMemo(() => {
    const selected = preferredPath?.length ? preferredPath : smoothedPath;
    if (!selected || !selected.length) return [];
    if (selected.length > 1500) return simplifyPath(selected, 12);
    if (selected.length > 900) return simplifyPath(selected, 8);
    if (selected.length > 450) return simplifyPath(selected, 5);
    return selected;
  }, [preferredPath, smoothedPath]);
  const mapLayer = useMemo(
    () => ENABLED_MAP_LAYERS.find((item) => item.key === mapLayerKey) || MAP_LAYER_FALLBACK,
    [mapLayerKey],
  );
  const totalPoints = routePoints.length;
  const timelineMax = Math.max(totalPoints - 1, 0);

  const timelineEntries = useMemo(
    () =>
      routePoints.map((point, index) => ({
        index,
        time: point.__time,
        label: point.__label,
        eventType: point.__event?.type || null,
        severity: point.__severity,
        speed: point.__speed,
        backendAddress: point.__address,
        addressKey: point.__addressKey,
        geocodeStatus: point.__geocodeStatus,
        lat: point.lat,
        lng: point.lng,
        heading: point.__heading,
        ignition: point.__ignition,
        odometer: point.__odometer,
        altitude: point.__altitude,
        satellites: point.__satellites,
        battery: point.__battery,
        motion: point.__motion,
        attributes: point.__attributes,
      })),
    [routePoints],
  );
  const filteredTimelineEntries = useMemo(
    () =>
      timelineFilter === "all"
        ? timelineEntries
        : timelineEntries.filter((entry) => entry.eventType === timelineFilter),
    [timelineEntries, timelineFilter],
  );

  const filteredPositions = useMemo(() => {
    const query = positionsSearch.trim().toLowerCase();
    if (!query) return timelineEntries;
    return timelineEntries.filter((entry) => {
      const address = normalizeAddressCandidate(entry.backendAddress) || "";
      const timeLabel = entry.time instanceof Date ? entry.time.toLocaleString() : entry.time || "";
      const haystack = [
        timeLabel,
        entry.speed,
        entry.lat,
        entry.lng,
        address,
        entry.label,
      ]
        .filter((value) => value !== null && value !== undefined)
        .join(" ")
        .toLowerCase();
      return haystack.includes(query);
    });
  }, [positionsSearch, timelineEntries]);

  const filteredAuditEntries = useMemo(() => {
    const query = auditSearch.trim().toLowerCase();
    if (!query) return filteredTimelineEntries;
    return filteredTimelineEntries.filter((entry) => {
      const address = normalizeAddressCandidate(entry.backendAddress) || "";
      const timeLabel = entry.time instanceof Date ? entry.time.toLocaleString() : entry.time || "";
      const haystack = [
        timeLabel,
        entry.label,
        entry.eventType,
        entry.speed,
        entry.lat,
        entry.lng,
        address,
      ]
        .filter((value) => value !== null && value !== undefined)
        .join(" ")
        .toLowerCase();
      return haystack.includes(query);
    });
  }, [auditSearch, filteredTimelineEntries]);

  const timelineEntryByIndex = useMemo(() => {
    const map = new Map();
    timelineEntries.forEach((entry) => {
      map.set(entry.index, entry);
    });
    return map;
  }, [timelineEntries]);

  const limitedPositions = useMemo(
    () => (filteredPositions.length > MAX_DRAWER_ROWS ? filteredPositions.slice(0, MAX_DRAWER_ROWS) : filteredPositions),
    [filteredPositions],
  );
  const limitedAuditEntries = useMemo(
    () =>
      filteredAuditEntries.length > MAX_DRAWER_ROWS
        ? filteredAuditEntries.slice(0, MAX_DRAWER_ROWS)
        : filteredAuditEntries,
    [filteredAuditEntries],
  );

  const fallbackTripEvents = useMemo(() => {
    const entries = timelineEntries.filter((entry) => {
      if (!entry.eventType) return false;
      const normalizedType = String(entry.eventType).trim().toLowerCase();
      if (!normalizedType) return false;
      if (["position", "posicao", "posição", "generic"].includes(normalizedType)) return false;
      return true;
    });
    if (!entries.length) return [];
    return entries.map((entry) => {
      const type = String(entry.eventType || "event").toLowerCase();
      const label = entry.label || translateTripEvent(entry.eventType) || "Evento";
      const time = entry.time instanceof Date ? entry.time : entry.time ? new Date(entry.time) : null;
      const severity = resolveEventSeverityLabel(entry.severity, entry.eventType) || "Informativa";
      return {
        index: entry.index,
        type,
        label,
        icon: null,
        ignition: entry.ignition,
        time,
        lat: entry.lat,
        lng: entry.lng,
        __address: entry.backendAddress,
        __category: inferEventCategory(type, label),
        __severityLabel: severity,
        __raw: entry,
      };
    });
  }, [timelineEntries]);

  const tripEvents = useMemo(() => {
    if (!tripEventsLoaded) return [];
    if (!tripEventsRaw.length) return fallbackTripEvents;
    return tripEventsRaw
      .map((event) => {
        const definition = resolveEventDefinitionFromPayload(event, locale, t);
        const rawType =
          event?.type ||
          event?.attributes?.type ||
          event?.event ||
          event?.attributes?.event ||
          event?.alarm ||
          event?.attributes?.alarm ||
          event?.name;
        const type = definition?.type || (rawType ? String(rawType).toLowerCase() : "event");
        const protocol =
          event?.protocol ||
          event?.attributes?.protocol ||
          event?.device?.protocol ||
          event?.position?.protocol ||
          event?.position?.attributes?.protocol ||
          null;
        const label =
          translateEventType(rawType || type, locale, t, protocol, event) ||
          definition?.label ||
          translateTripEvent(rawType) ||
          "Evento";
        const severity =
          resolveEventSeverityLabel(
            event?.severity ??
              event?.attributes?.severity ??
              event?.criticality ??
              event?.attributes?.criticality ??
              null,
            rawType || type,
          ) || "Informativa";
        const time = resolveEventTimestamp(event);
        const coords = resolveEventCoordinates(event);
        const address = resolveEventAddress(event);
        const index = findClosestIndexByTime(routePoints, time ? time.getTime() : null);
        return {
          index,
          type,
          label,
          icon: definition?.icon || null,
          ignition: definition?.ignition,
          time,
          lat: coords.lat,
          lng: coords.lng,
          __address: address,
          __category: inferEventCategory(type, label),
          __severityLabel: severity,
          __raw: event,
        };
      })
      .filter(Boolean);
  }, [fallbackTripEvents, locale, routePoints, t, tripEventsLoaded, tripEventsRaw]);

  const filteredEventEntries = useMemo(() => {
    const query = eventSearch.trim().toLowerCase();
    if (!query) return tripEvents;
    return tripEvents.filter((event) => {
      const timeLabel = event.time instanceof Date ? event.time.toLocaleString() : event.time || "";
      const entry = timelineEntryByIndex.get(event.index);
      const address = (entry ? normalizeAddressCandidate(entry.backendAddress) : null) || event.__address || "";
      const haystack = [timeLabel, event.label, event.type, event.__category, event.__severityLabel, event.lat, event.lng, address]
        .filter((value) => value !== null && value !== undefined)
        .join(" ")
        .toLowerCase();
      return haystack.includes(query);
    });
  }, [eventSearch, timelineEntryByIndex, tripEvents]);

  const limitedEventEntries = useMemo(
    () =>
      filteredEventEntries.length > MAX_DRAWER_ROWS
        ? filteredEventEntries.slice(0, MAX_DRAWER_ROWS)
        : filteredEventEntries,
    [filteredEventEntries],
  );

  const eventSummaries = useMemo(() => {
    const accumulator = new Map();
    const normalizeLabel = (value) => translateTripEvent(typeof value === "string" ? value : value ?? "");

    tripEvents.forEach((event) => {
      if (!accumulator.has(event.type)) {
        accumulator.set(event.type, {
          type: event.type,
          label: normalizeLabel(event.label ?? event.type),
          icon: event.icon,
          occurrences: [],
        });
      }
      const current = accumulator.get(event.type);
      current.label = normalizeLabel(event.label ?? current.label);
      current.icon = current.icon || event.icon;
      current.occurrences.push(event.index);
    });

    return Array.from(accumulator.values())
      .map((item) => ({ ...item, count: item.occurrences.length }))
      .sort((a, b) => {
        const labelA = String(a?.label ?? "");
        const labelB = String(b?.label ?? "");
        return b.count - a.count || labelA.localeCompare(labelB, "pt-BR");
      });
  }, [tripEvents]);

  const activeFilterLabel = useMemo(() => {
    if (timelineFilter === "all") return "Todos";
    const summary = eventSummaries.find((item) => item.type === timelineFilter);
    return summary?.label || translateTripEvent(timelineFilter);
  }, [eventSummaries, timelineFilter]);

  const resolveEntryAddress = useCallback(
    (entry) => {
      if (!entry) return "—";
      const backend = normalizeAddressCandidate(entry?.backendAddress);
      if (backend) {
        return <AddressStatus address={backend} loading={false} />;
      }
      const isLoading = entry?.geocodeStatus === "pending";
      return <AddressStatus address={null} loading={isLoading} />;
    },
    [],
  );
  const resolveTripAddress = useCallback(
    (trip, type) => {
      if (!trip) return "—";
      const isStart = type === "start";
      const backend = isStart
        ? trip.startShortAddress || trip.startAddress
        : trip.endShortAddress || trip.endAddress;
      const normalizedBackend = normalizeAddressCandidate(backend);
      if (normalizedBackend) {
        return <AddressStatus address={normalizedBackend} loading={false} />;
      }
      return <AddressStatus address={null} loading={false} />;
    },
    [],
  );
  const resolveTripAddressValue = useCallback((trip, type) => {
    if (!trip) return "";
    const isStart = type === "start";
    const backend = isStart
      ? trip.startShortAddress || trip.startAddress
      : trip.endShortAddress || trip.endAddress;
    const normalizedBackend = normalizeAddressCandidate(backend);
    return normalizedBackend || "";
  }, []);
  const formatShortAddress = useCallback((rawAddress) => {
    if (!rawAddress) return "—";
    const normalized = String(rawAddress).replace(/\s+/g, " ").trim();
    if (!normalized) return "—";
    const parts = normalized
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);
    if (parts.length >= 2) {
      const last = parts[parts.length - 1];
      const secondLast = parts[parts.length - 2];
      if (secondLast && last && secondLast !== last) {
        return `${secondLast} • ${last}`;
      }
    }
    return parts[0] || normalized;
  }, []);
  const resolveTripShortAddress = useCallback(
    (trip, type) => {
      const full = resolveTripAddressValue(trip, type);
      return formatShortAddress(full);
    },
    [formatShortAddress, resolveTripAddressValue],
  );

  const dynamicAttributeKeys = useMemo(() => {
    const known = new Set([
      "address",
      "formattedAddress",
      "rawAddress",
      "geofence",
      "geofenceName",
      "ignition",
      "battery",
      "batteryLevel",
      "sat",
      "satellites",
      "odometer",
      "course",
      "heading",
      "motion",
    ]);

    const keys = new Set();
    timelineEntries.forEach((entry) => {
      Object.entries(entry.attributes || {}).forEach(([key, value]) => {
        if (value === undefined || value === null) return;
        if (known.has(key)) return;
        keys.add(key);
      });
    });

    return Array.from(keys).sort((a, b) => a.localeCompare(b, "pt-BR"));
  }, [timelineEntries]);

  const availableColumnDefs = useMemo(() => {
    const hasSpeed = timelineEntries.some((entry) => Number.isFinite(entry.speed));
    const hasLatLng = timelineEntries.some((entry) => Number.isFinite(entry.lat) && Number.isFinite(entry.lng));
    const hasHeading = timelineEntries.some((entry) => Number.isFinite(entry.heading));
    const hasIgnition = timelineEntries.some((entry) => typeof entry.ignition === "boolean");
    const hasOdometer = timelineEntries.some((entry) => Number.isFinite(entry.odometer));
    const hasAltitude = timelineEntries.some((entry) => Number.isFinite(entry.altitude));
    const hasSatellites = timelineEntries.some((entry) => Number.isFinite(entry.satellites));
    const hasBattery = timelineEntries.some((entry) => Number.isFinite(entry.battery));
    const hasMotion = timelineEntries.some((entry) => typeof entry.motion === "boolean");

    const baseColumns = [
      {
        key: "time",
        label: "Hora",
        defaultSelected: true,
        render: (entry) => (entry.time ? formatDateTime(entry.time, locale) : "Horário indisponível"),
      },
      { key: "event", label: "Evento", defaultSelected: true, render: (entry) => entry.label || "—" },
      {
        key: "speed",
        label: "Velocidade",
        defaultSelected: true,
        align: "right",
        isAvailable: hasSpeed,
        render: (entry) => (Number.isFinite(entry.speed) ? `${Math.round(entry.speed)} km/h` : "—"),
      },
      { key: "address", label: "Endereço / Local", defaultSelected: true, allowWrap: true },
      {
        key: "lat",
        label: "Latitude",
        align: "right",
        isAvailable: hasLatLng,
        render: (entry) => (Number.isFinite(entry.lat) ? entry.lat.toFixed(5) : "—"),
      },
      {
        key: "lng",
        label: "Longitude",
        align: "right",
        isAvailable: hasLatLng,
        render: (entry) => (Number.isFinite(entry.lng) ? entry.lng.toFixed(5) : "—"),
      },
      {
        key: "heading",
        label: "Curso / Direção",
        align: "right",
        isAvailable: hasHeading,
        render: (entry) => (Number.isFinite(entry.heading) ? `${Math.round(entry.heading)}°` : "—"),
      },
      {
        key: "ignition",
        label: "Ignição",
        isAvailable: hasIgnition,
        render: (entry) => (typeof entry.ignition === "boolean" ? (entry.ignition ? "Ligada" : "Desligada") : "—"),
      },
      {
        key: "odometer",
        label: "Odômetro",
        align: "right",
        isAvailable: hasOdometer,
        render: (entry) => (Number.isFinite(entry.odometer) ? `${(entry.odometer / 1000).toFixed(1)} km` : "—"),
      },
      {
        key: "altitude",
        label: "Altitude",
        align: "right",
        isAvailable: hasAltitude,
        render: (entry) => (Number.isFinite(entry.altitude) ? `${Math.round(entry.altitude)} m` : "—"),
      },
      {
        key: "satellites",
        label: "Satélites",
        align: "right",
        isAvailable: hasSatellites,
        render: (entry) => (Number.isFinite(entry.satellites) ? Math.round(entry.satellites) : "—"),
      },
      {
        key: "battery",
        label: "Bateria",
        align: "right",
        isAvailable: hasBattery,
        render: (entry) => (Number.isFinite(entry.battery) ? `${Math.round(entry.battery)}%` : "—"),
      },
      {
        key: "motion",
        label: "Movimento",
        isAvailable: hasMotion,
        render: (entry) => (typeof entry.motion === "boolean" ? (entry.motion ? "Em movimento" : "Parado") : "—"),
      },
    ];

    const dynamicColumns = dynamicAttributeKeys.map((attrKey) => ({
      key: `attr:${attrKey}`,
      label: formatAttributeLabel(attrKey),
      allowWrap: true,
      render: (entry) => {
        const value = entry?.attributes?.[attrKey];
        if (value === undefined || value === null) return "—";
        if (typeof value === "boolean") return value ? "Sim" : "Não";
        const numericValue = Number(value);
        if (Number.isFinite(numericValue)) return numericValue;
        return String(value);
      },
      isAvailable: true,
    }));

    return [...baseColumns, ...dynamicColumns].filter((column) => column.isAvailable !== false);
  }, [dynamicAttributeKeys, locale, timelineEntries]);

  const availableColumnKeys = useMemo(() => availableColumnDefs.map((column) => column.key), [availableColumnDefs]);
  const availableColumnSignature = useMemo(() => availableColumnKeys.join("|"), [availableColumnKeys]);

  useEffect(() => {
    if (lastAvailableColumnsRef.current === availableColumnSignature) return;
    lastAvailableColumnsRef.current = availableColumnSignature;
    const availableKeys = availableColumnKeys;
    setSelectedColumns((prev) => {
      const filtered = prev.filter((key) => availableKeys.includes(key));
      const next =
        filtered.length
          ? filtered
          : DEFAULT_COLUMN_PRESET.filter((key) => availableKeys.includes(key));
      const resolved = next.length ? next : availableKeys;
      if (resolved.length === prev.length && resolved.every((key, index) => key === prev[index])) {
        return prev;
      }
      return resolved;
    });
  }, [availableColumnKeys, availableColumnSignature]);

  useEffect(() => {
    persistColumns(selectedColumns);
  }, [selectedColumns]);

  const visibleColumns = useMemo(() => {
    const columnMap = new Map(availableColumnDefs.map((column) => [column.key, column]));
    return selectedColumns.map((key) => columnMap.get(key)).filter(Boolean);
  }, [availableColumnDefs, selectedColumns]);

  const handleToggleColumn = useCallback((key) => {
    setSelectedColumns((prev) => {
      const exists = prev.includes(key);
      if (exists) {
        if (prev.length <= 1) return prev;
        return prev.filter((item) => item !== key);
      }
      return [...prev, key];
    });
  }, []);

  const handleMoveColumn = useCallback((key, direction) => {
    setSelectedColumns((prev) => {
      const index = prev.indexOf(key);
      if (index === -1) return prev;
      const nextIndex = index + direction;
      if (nextIndex < 0 || nextIndex >= prev.length) return prev;
      const next = [...prev];
      const [item] = next.splice(index, 1);
      next.splice(nextIndex, 0, item);
      return next;
    });
  }, []);

  const applyColumnPreset = useCallback(
    (preset) => {
      if (preset === "all") {
        setSelectedColumns(availableColumnDefs.map((column) => column.key));
        return;
      }

      if (preset === "default") {
        const defaults = DEFAULT_COLUMN_PRESET.filter((key) =>
          availableColumnDefs.some((column) => column.key === key),
        );
        setSelectedColumns(defaults.length ? defaults : availableColumnDefs.map((column) => column.key));
      }
    },
    [availableColumnDefs],
  );

  const activeEvent = useMemo(() => tripEvents.find((event) => event.index === activeIndex) || null, [activeIndex, tripEvents]);
  const selectedEventSummary = useMemo(
    () => eventSummaries.find((item) => item.type === selectedEventType) || null,
    [eventSummaries, selectedEventType],
  );
  const totalEvents = tripEvents.length;
  const showTripEventsError = Boolean(tripEventsError) && !fallbackTripEvents.length;
  const currentEventLabel = tripEventsLoading
    ? "Carregando eventos..."
    : selectedEventSummary?.label || activeEvent?.label || (tripEventsLoaded ? "Nenhum evento" : "—");
  const activeEventPosition = useMemo(
    () => tripEvents.findIndex((event) => event.index === activeIndex),
    [activeIndex, tripEvents],
  );
  const eventNavTotal = selectedEventType ? selectedEventSummary?.count || 0 : totalEvents;
  const eventNavIndex = selectedEventType
    ? Math.min(eventCursor + 1, Math.max(eventNavTotal, 0))
    : activeEventPosition >= 0
      ? activeEventPosition + 1
      : 0;

  const cancelAnimation = useCallback(() => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  const stopPlayback = useCallback(() => {
    setIsPlaying((prev) => (prev ? false : prev));
    cancelAnimation();
    lastFrameRef.current = null;
  }, [cancelAnimation]);

  useEffect(() => {
    if (initialisedRef.current) return;
    const search = new URLSearchParams(location.search || "");
    const queryFrom = search.get("from");
    const queryTo = search.get("to");

    if (queryFrom) setFrom(asLocalInput(queryFrom, DEFAULT_FROM));
    if (queryTo) setTo(asLocalInput(queryTo, DEFAULT_TO));
    initialisedRef.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.search]);

  useEffect(() => {
    const search = new URLSearchParams(location.search || "");
    const pendingVehicleParam = search.get("vehicleId");
    const pendingDeviceParam = search.get("deviceId") || search.get("device");
    const currentVehicleId = normalizeQueryId(vehicleId);
    const currentDeviceId = normalizeQueryId(deviceIdFromStore);

    if (pendingVehicleParam) {
      return;
    }

    if (!vehicleId && !deviceIdFromStore) {
      return;
    }

    if (!pendingDeviceParam || vehicleId) return;
    const targetKey = toDeviceKey(pendingDeviceParam);
    if (!targetKey) return;
    const match = vehicleByDeviceId.get(String(targetKey));
    if (!match) return;

    const targetVehicleId = normalizeQueryId(match.id);
    const targetDeviceId = normalizeQueryId(pendingDeviceParam);
    const nextKey = { vehicleId: targetVehicleId, deviceId: targetDeviceId };
    if (
      lastQuerySelectionRef.current.vehicleId === nextKey.vehicleId &&
      lastQuerySelectionRef.current.deviceId === nextKey.deviceId
    ) {
      return;
    }
    if (currentVehicleId === targetVehicleId && currentDeviceId === targetDeviceId) {
      lastQuerySelectionRef.current = nextKey;
      return;
    }
    setVehicleSelection(targetVehicleId, pendingDeviceParam);
    lastQuerySelectionRef.current = nextKey;
  }, [location.search, setVehicleSelection, vehicleByDeviceId, vehicleId, deviceIdFromStore]);

  useEffect(() => {
    stopPlayback();
    setActiveIndex((prev) => (prev === 0 ? prev : 0));
    activeIndexRef.current = 0;
    setSelectedEventType(null);
    setEventCursor(0);
    setTimelineFilter("all");
    const firstPoint = routePoints[0] || null;
    if (!firstPoint) {
      setAnimatedPoint((prev) => (prev ? null : prev));
      playbackTimeRef.current = 0;
      setPlaybackTimeMs(0);
      return;
    }
    const secondPoint = routePoints[1] || firstPoint;
    const heading = computeHeading(firstPoint, secondPoint);
    playbackTimeRef.current = firstPoint.t || 0;
    setPlaybackTimeMs(firstPoint.t || 0);
    setAnimatedPoint((prev) => {
      if (prev && prev.lat === firstPoint.lat && prev.lng === firstPoint.lng && prev.heading === heading) {
        return prev;
      }
      return { lat: firstPoint.lat, lng: firstPoint.lng, heading, t: firstPoint.t };
    });
  }, [routePoints, stopPlayback]);

  useEffect(() => {
    if (!selectedEventType) return;
    const summary = eventSummaries.find((item) => item.type === selectedEventType);
    if (!summary) return;
    const occurrenceIndex = summary.occurrences.findIndex((value) => value === activeIndex);
    if (occurrenceIndex >= 0) {
      setEventCursor(occurrenceIndex);
    }
  }, [activeIndex, eventSummaries, selectedEventType]);

  useEffect(() => {
    try {
      const storedLayer = localStorage.getItem(MAP_LAYER_STORAGE_KEY);
      setMapLayerKey(getValidMapLayer(storedLayer));
    } catch (_error) {
      setMapLayerKey(DEFAULT_MAP_LAYER_KEY);
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(MAP_LAYER_STORAGE_KEY, mapLayerKey);
    } catch (_error) {
      // ignore persistence errors
    }
  }, [mapLayerKey]);

  const syncAnimatedPoint = useCallback(
    (index) => {
      if (!routePoints.length) return;
      const clamped = Math.max(0, Math.min(index, routePoints.length - 1));
      const current = routePoints[clamped];
      const next = routePoints[Math.min(clamped + 1, routePoints.length - 1)] || current;
      const previous = routePoints[Math.max(clamped - 1, 0)] || current;
      const heading = computeHeading(current, next !== current ? next : previous);

      activeIndexRef.current = clamped;
      setActiveIndex(clamped);
      const resolvedTime = current.t || 0;
      playbackTimeRef.current = resolvedTime;
      setPlaybackTimeMs(resolvedTime);
      animatedLivePointRef.current = { lat: current.lat, lng: current.lng, heading, t: resolvedTime };
      setAnimatedPoint((prev) => {
        if (prev && prev.lat === current.lat && prev.lng === current.lng && prev.heading === heading) return prev;
        return { lat: current.lat, lng: current.lng, heading, t: resolvedTime };
      });
    },
    [routePoints],
  );

  const updateAnimatedState = useCallback((nextTimeMs) => {
    const points = routePointsRef.current;
    const times = routeTimesRef.current;
    if (!points.length) return;
    const bounds = playbackBoundsRef.current;
    const start = bounds.start || 0;
    const end = bounds.end || start;
    const clampedTime = clamp(nextTimeMs, start, end);
    const now = typeof performance !== "undefined" && performance.now ? performance.now() : Date.now();
    playbackTimeRef.current = clampedTime;
    if (now - playbackUiUpdateRef.current >= 140) {
      playbackUiUpdateRef.current = now;
      setPlaybackTimeMs(clampedTime);
    }

    if (times.length <= 1) {
      activeIndexRef.current = 0;
      setActiveIndex(0);
      const first = points[0];
      const nextPoint = { lat: first.lat, lng: first.lng, heading: 0, t: clampedTime };
      animatedLivePointRef.current = nextPoint;
      setAnimatedPoint(nextPoint);
      return;
    }

    const baseIndex = findIndexForTime(clampedTime, times, activeIndexRef.current);
    const pointA = points[baseIndex] || points[0];
    const pointB = points[Math.min(baseIndex + 1, points.length - 1)] || pointA;
    const denom = (pointB.t - pointA.t) || 1;
    const frac = clamp((clampedTime - pointA.t) / denom, 0, 1);
    const lat = lerp(pointA.lat, pointB.lat, frac);
    const lng = lerp(pointA.lng, pointB.lng, frac);
    const previousPoint = points[Math.max(baseIndex - 1, 0)] || pointA;
    const heading = pointA === pointB ? computeHeading(previousPoint, pointA) : computeHeading(pointA, pointB);

    if (activeIndexRef.current !== baseIndex) {
      activeIndexRef.current = baseIndex;
      setActiveIndex(baseIndex);
    }

    const nextPoint = { lat, lng, heading, t: clampedTime };
    animatedLivePointRef.current = nextPoint;
    if (now - animatedUiUpdateRef.current >= 140) {
      animatedUiUpdateRef.current = now;
      setAnimatedPoint((prev) => {
        if (prev && prev.lat === lat && prev.lng === lng && prev.heading === heading && prev.t === clampedTime) {
          return prev;
        }
        return nextPoint;
      });
    }
  }, []);

  const updateAnimatedStateRef = useRef(updateAnimatedState);

  useEffect(() => {
    updateAnimatedStateRef.current = updateAnimatedState;
  }, [updateAnimatedState]);

  useEffect(() => {
    if (!isPlaying || routePoints.length <= 1) {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      lastFrameRef.current = null;
      return undefined;
    }

    let cancelled = false;
    let rafId = null;

    const tick = (timestamp) => {
      if (cancelled) return;
      if (lastFrameRef.current === null) {
        lastFrameRef.current = timestamp;
      }

      const delta = lastFrameRef.current === null ? 0 : timestamp - lastFrameRef.current;
      const speedMultiplier = speedRef.current || 1;
      const bounds = playbackBoundsRef.current;
      const nextTime = (playbackTimeRef.current || bounds.start || 0) + delta * speedMultiplier;
      lastFrameRef.current = timestamp;
      updateAnimatedStateRef.current(nextTime);

      const endTime = bounds.end || bounds.start || 0;
      const totalRoutePoints = routePointsRef.current.length;
      const reachedEnd =
        (Number.isFinite(endTime) && playbackTimeRef.current >= endTime) ||
        activeIndexRef.current >= Math.max(totalRoutePoints - 1, 0);
      if (reachedEnd) {
        updateAnimatedStateRef.current(endTime);
        setIsPlaying(false);
        lastFrameRef.current = null;
        return;
      }

      if (process.env.NODE_ENV !== "production") {
        const lastLog = debugLogRef.current || 0;
        if (!lastLog || timestamp - lastLog >= 1000) {
          debugLogRef.current = timestamp;
          // eslint-disable-next-line no-console
          console.debug("tick: playbackTimeMs=", playbackTimeRef.current, "activeIndex=", activeIndexRef.current, "routePointsLen=", totalRoutePoints);
        }
      }

      rafId = requestAnimationFrame(tick);
      rafRef.current = rafId;
    };

    rafId = requestAnimationFrame(tick);
    rafRef.current = rafId;

    return () => {
      cancelled = true;
      if (rafId) cancelAnimationFrame(rafId);
      rafRef.current = null;
      lastFrameRef.current = null;
    };
  }, [isPlaying, routePoints.length, selectedTrip?.id, speed]);

  const loadRouteForTrip = useCallback(
    async (trip) => {
      if (!trip) return;
      const tripDeviceId = trip.deviceId || trip.device_id || deviceId;
      const start = trip.startTime || trip.start || trip.from;
      const end = trip.endTime || trip.end || trip.to;
      const startDate = parseDate(start);
      const endDate = parseDate(end);
      if (!tripDeviceId || !startDate || !endDate) return;
      try {
        await generateRoute({
          deviceId: tripDeviceId,
          from: startDate.toISOString(),
          to: endDate.toISOString(),
        });
      } catch (_err) {
        // handled by hook state
      }
    },
    [deviceId, generateRoute],
  );

  const handleGenerate = useCallback(
    async (nextDeviceId, fromValue, toValue) => {
      setFeedback(null);
      const device = nextDeviceId || deviceId;
      const rangeFrom = fromValue || from;
      const rangeTo = toValue || to;
      const validation = validateRange({ deviceId: device, from: rangeFrom, to: rangeTo });
      if (validation) {
        setFormError(validation);
        return;
      }
      setFormError("");
      try {
        const response = await generateTripsReport({
          deviceId: device,
          vehicleId: vehicleId || vehicleByDeviceId.get(String(device))?.id,
          from: new Date(rangeFrom).toISOString(),
          to: new Date(rangeTo).toISOString(),
        });
        const nextTrip = Array.isArray(response?.trips) ? response.trips[0] : null;
        if (nextTrip) {
          setSelectedTrip(nextTrip);
          await loadRouteForTrip(nextTrip);
        }
        navigate(
          `/trips?vehicleId=${encodeURIComponent(
            vehicleId || vehicleByDeviceId.get(String(device))?.id || "",
          )}${device ? `&deviceId=${encodeURIComponent(device)}` : ""}&from=${encodeURIComponent(rangeFrom)}&to=${encodeURIComponent(rangeTo)}`,
          { replace: true },
        );
        setFeedback({ type: "success", message: "Relatório gerado com sucesso." });
      } catch (requestError) {
        setFeedback({ type: "error", message: requestError?.message || "Erro ao gerar relatório." });
      }
    },
    [deviceId, from, to, generateTripsReport, navigate, loadRouteForTrip, vehicleByDeviceId, vehicleId],
  );

  const handleSubmit = useCallback(
    (event) => {
      event.preventDefault();
      void handleGenerate();
    },
    [handleGenerate],
  );

  useEffect(() => {
    if (drawerTab !== "audit" && columnPickerOpen) {
      setColumnPickerOpen(false);
    }
  }, [columnPickerOpen, drawerTab]);

  useEffect(() => {
    if (activeTab === "audit") {
      setDrawerTab("audit");
      return;
    }
    if (drawerTab === "audit") {
      setDrawerTab("events");
    }
  }, [activeTab, drawerTab]);

  useEffect(() => {
    if (autoGenerateRef.current) return;
    const search = new URLSearchParams(location.search || "");
    const queryFrom = search.get("from");
    const queryTo = search.get("to");
    if (!queryFrom || !queryTo || !deviceId) return;
    autoGenerateRef.current = true;
    handleGenerate(deviceId, asLocalInput(queryFrom, DEFAULT_FROM), asLocalInput(queryTo, DEFAULT_TO));
  }, [deviceId, handleGenerate, location.search]);

  const handleDownload = useCallback(async () => {
    const validation = validateRange({ deviceId, from, to });
    if (validation) {
      setFormError(validation);
      return;
    }
    setFormError("");
    setDownloading(true);
    try {
      await downloadTripsCsv({
        deviceId,
        vehicleId: vehicleId || vehicleByDeviceId.get(String(deviceId))?.id,
        from: new Date(from).toISOString(),
        to: new Date(to).toISOString(),
      });
      setFeedback({ type: "success", message: "Exportação iniciada." });
    } catch (requestError) {
      setFeedback({ type: "error", message: requestError?.message || "Erro ao exportar CSV." });
    } finally {
      setDownloading(false);
    }
  }, [deviceId, from, to, downloadTripsCsv, vehicleByDeviceId, vehicleId]);

  const handleSelectPoint = useCallback(
    (nextIndex, options = {}) => {
      const clampedIndex = Math.max(0, Math.min(nextIndex, timelineMax));
      const target = routePoints[clampedIndex] || null;
      if (target) {
        syncAnimatedPoint(clampedIndex);
      }
      if (options.centerMap && target && Number.isFinite(target.lat) && Number.isFinite(target.lng)) {
        setManualCenter({ lat: target.lat, lng: target.lng, ts: Date.now() });
      }
      if (isPlaying) {
        lastFrameRef.current = null;
      }
    },
    [isPlaying, routePoints, syncAnimatedPoint, timelineMax],
  );

  const handlePlayToggle = useCallback(() => {
    if (!totalPoints) return;
    if (isPlaying) {
      stopPlayback();
      return;
    }

    const atEnd = playbackTimeRef.current >= playbackBounds.end || activeIndex >= totalPoints - 1;
    if (atEnd) {
      const firstPoint = routePoints[0] || null;
      const secondPoint = routePoints[1] || firstPoint;
      activeIndexRef.current = 0;
      setActiveIndex(0);
      if (firstPoint) {
        const heading = secondPoint ? computeHeading(firstPoint, secondPoint) : 0;
        playbackTimeRef.current = firstPoint.t || 0;
        setPlaybackTimeMs(firstPoint.t || 0);
        setAnimatedPoint({
          lat: firstPoint.lat,
          lng: firstPoint.lng,
          heading,
          t: firstPoint.t,
        });
      } else {
        playbackTimeRef.current = 0;
        setPlaybackTimeMs(0);
        setAnimatedPoint(null);
      }
    }

    if (process.env.NODE_ENV !== "production") {
      // eslint-disable-next-line no-console
      console.debug("play clicked, isPlaying -> true");
    }
    lastFrameRef.current = null;
    setIsPlaying(true);
  }, [activeIndex, isPlaying, playbackBounds.end, routePoints, stopPlayback, totalPoints]);

  const handleSliderChange = useCallback(
    (value) => {
      if (!routePoints.length) return;
      const ratio = clamp(Number(value) / REPLAY_SLIDER_RESOLUTION, 0, 1);
      const nextTime = lerp(playbackBounds.start, playbackBounds.end || playbackBounds.start, ratio);
      updateAnimatedState(nextTime);
      if (isPlaying) {
        lastFrameRef.current = null;
      }
    },
    [isPlaying, playbackBounds.end, playbackBounds.start, routePoints.length, updateAnimatedState],
  );

  const handleMapLayerChange = useCallback((nextKey) => {
    setMapLayerKey(getValidMapLayer(nextKey));
  }, []);

  const mapTypeKey = useMemo(() => {
    const key = String(mapLayerKey || "").toLowerCase();
    if (key.includes("hybrid")) return "hybrid";
    if (key.includes("sat")) return "sat";
    return "road";
  }, [mapLayerKey]);

  const resolveLayerForType = useCallback((type) => {
    const candidates = ENABLED_MAP_LAYERS.filter((layer) => layer?.url);
    const match = (needle) => candidates.find((layer) => String(layer.key || "").toLowerCase().includes(needle));
    if (type === "sat") {
      return match("satellite") || match("sat") || match("hybrid") || MAP_LAYER_FALLBACK;
    }
    if (type === "hybrid") {
      return match("hybrid") || match("satellite") || MAP_LAYER_FALLBACK;
    }
    return match("road") || match("street") || match("osm") || MAP_LAYER_FALLBACK;
  }, []);

  const handleMapTypeChange = useCallback(
    (type) => {
      const layer = resolveLayerForType(type);
      if (layer?.key) {
        handleMapLayerChange(layer.key);
      }
    },
    [handleMapLayerChange, resolveLayerForType],
  );

  const handleClearFilters = useCallback(() => {
    setSelectedEventType(null);
    setTimelineFilter("all");
    setEventCursor(0);
  }, []);

  const handleSelectTrip = useCallback(
    async (trip) => {
      setSelectedTrip(trip);
      setActiveIndex(0);
      activeIndexRef.current = 0;
      stopPlayback();
      setEventSearch("");
      setPositionsSearch("");
      setAuditSearch("");
      handleClearFilters();
      setDrawerTab("events");
      await loadRouteForTrip(trip);
    },
    [handleClearFilters, loadRouteForTrip, stopPlayback],
  );

  const handleSelectEventType = useCallback(
    (eventType) => {
      if (!eventType || eventType === "all") {
        handleClearFilters();
        return;
      }
      const summary = eventSummaries.find((item) => item.type === eventType);
      if (!summary) return;
      const nextCursor = selectedEventType === eventType ? (eventCursor + 1) % summary.occurrences.length : 0;
      setSelectedEventType(eventType);
      setTimelineFilter(eventType);
      setEventCursor(nextCursor);
      handleSelectPoint(summary.occurrences[nextCursor], { centerMap: focusMode === "map" });
    },
    [eventCursor, eventSummaries, focusMode, handleClearFilters, handleSelectPoint, selectedEventType],
  );

  const handleJumpToEvent = useCallback(
    (direction = 1) => {
      const baseEvents = selectedEventType
        ? tripEvents.filter((event) => event.type === selectedEventType)
        : tripEvents;
      if (!baseEvents.length) return;

      const currentIndex = baseEvents.findIndex((event) => event.index === activeIndex);
      const nextIndex = currentIndex === -1 ? 0 : (currentIndex + direction + baseEvents.length) % baseEvents.length;
      const target = baseEvents[nextIndex];
      setSelectedEventType(selectedEventType || target.type);
      setEventCursor(nextIndex);
      handleSelectPoint(target.index, { centerMap: focusMode === "map" });
    },
    [activeIndex, focusMode, handleSelectPoint, selectedEventType, tripEvents],
  );

  const sliderValue = useMemo(() => {
    if (!routePoints.length) return 0;
    const duration = playbackBounds.end - playbackBounds.start || 1;
    const ratio = clamp((playbackTimeMs - playbackBounds.start) / duration, 0, 1);
    return Math.round(ratio * REPLAY_SLIDER_RESOLUTION);
  }, [playbackBounds.end, playbackBounds.start, playbackTimeMs, routePoints.length]);

  const playbackDate = useMemo(() => {
    if (!routePoints.length) return null;
    const candidate = Number.isFinite(playbackTimeMs) && playbackTimeMs ? playbackTimeMs : playbackBounds.start;
    const resolved = Number.isFinite(candidate) ? candidate : null;
    if (resolved === null) return null;
    const asDate = new Date(resolved);
    return Number.isFinite(asDate.getTime()) ? asDate : null;
  }, [playbackBounds.start, playbackTimeMs, routePoints.length]);

  const visibleCount = filteredTimelineEntries.length;
  const hasActiveFilter = timelineFilter !== "all";
  const statusText = `${visibleCount} registro${visibleCount === 1 ? "" : "s"} — ${
    hasActiveFilter ? `filtrando: ${activeFilterLabel}` : "mostrando todos"
  }`;
  const generatedAtLabel = data?.__meta?.generatedAt
    ? formatDateTime(new Date(data.__meta.generatedAt), locale)
    : null;
  const statusTone = feedback?.type === "error" || formError || deviceUnavailable || error
    ? "error"
    : feedback?.type === "success" || loading || generatedAtLabel
      ? "success"
      : "idle";
  const statusMessage =
    formError ||
    (deviceUnavailable ? "Selecione um veículo com equipamento vinculado para gerar trajetos." : null) ||
    (feedback?.type === "error" ? feedback.message : null) ||
    (error?.message || null) ||
    (loading ? "Gerando relatório..." : null) ||
    (feedback?.type === "success" ? feedback.message : null) ||
    (generatedAtLabel ? `Relatório gerado • Última geração: ${generatedAtLabel}` : "Relatório não gerado.");

  const drawerCountLabel = useMemo(() => {
    if (drawerTab === "events" && tripEventsLoading) return "Carregando...";
    if (drawerTab === "audit") return `${filteredAuditEntries.length} registros`;
    if (drawerTab === "positions") return `${filteredPositions.length} posições`;
    return `${filteredEventEntries.length} ocorrências`;
  }, [drawerTab, filteredAuditEntries.length, filteredEventEntries.length, filteredPositions.length, tripEventsLoading]);

  return (
    <div
      className="flex min-h-0 flex-1 flex-col overflow-hidden bg-[#0B0F16] text-white/90"
      style={{ "--trips-header-h": "124px", "--trips-replay-offset": "72px" }}
    >
      <header className="shrink-0 border-b border-white/10 bg-white/5 px-3 py-2 sm:px-4 lg:px-4 2xl:px-6 backdrop-blur">
        <PageHeader />

        <form onSubmit={handleSubmit} className="mt-1 flex w-full flex-wrap items-center gap-2 min-[1200px]:flex-nowrap">
          <div className="min-w-[240px] flex-1">
            <AutocompleteSelect
              label={null}
              placeholder={loadingVehicles ? "Carregando veículos..." : "Digite placa ou nome"}
              value={vehicleId || ""}
              options={vehicleOptions}
              onChange={(nextVehicleId, option) => {
                if (!nextVehicleId) {
                  setVehicleSelection(null, null);
                  return;
                }
                setVehicleSelection(nextVehicleId, option?.deviceId ?? null);
              }}
              className="w-full"
              inputClassName="h-9 rounded-full px-3 text-sm"
              allowClear
              emptyText={loadingVehicles ? "Carregando veículos..." : "Nenhum veículo encontrado."}
              disabled={loadingVehicles}
            />
          </div>

          <div className="flex h-9 items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 text-xs">
            <span className="text-white/60">De</span>
            <input
              type="datetime-local"
              value={from}
              onChange={(event) => {
                setFrom(event.target.value);
              }}
              className="h-full min-w-[170px] bg-transparent text-sm text-white outline-none"
            />
          </div>

          <div className="flex h-9 items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 text-xs">
            <span className="text-white/60">Até</span>
            <input
              type="datetime-local"
              value={to}
              onChange={(event) => {
                setTo(event.target.value);
              }}
              className="h-full min-w-[170px] bg-transparent text-sm text-white outline-none"
            />
          </div>

          <Button
            type="submit"
            variant={loading ? "danger" : "primary"}
            className="h-9 whitespace-nowrap rounded-full px-4 text-xs font-semibold"
            disabled={loading || !deviceId}
          >
            {loading ? "Gerando..." : "Gerar"}
          </Button>
          <button
            type="button"
            className="h-9 whitespace-nowrap rounded-full border border-white/10 bg-transparent px-4 text-xs font-semibold text-white/80 hover:border-white/20"
            onClick={handleDownload}
            disabled={downloading || !deviceId}
          >
            {downloading ? "Exportando..." : "Exportar CSV"}
          </button>
        </form>

        <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-white/60">
          <span
            className={`h-2 w-2 rounded-full ${
              statusTone === "error"
                ? "bg-red-400"
                : statusTone === "success"
                  ? "bg-emerald-300"
                  : "bg-white/30"
            }`}
          />
          <span>{statusMessage}</span>
        </div>
        {loadingVehicles && <p className="mt-2 text-xs text-white/50">Carregando veículos...</p>}
        {vehiclesError && <p className="mt-2 text-xs text-red-300">{vehiclesError.message}</p>}
      </header>

      <main className="relative isolate grid flex-1 min-h-0 h-[calc(100vh-var(--e-header-h)-var(--trips-header-h))] grid-rows-[minmax(0,1fr)] overflow-hidden grid-cols-[clamp(380px,32vw,520px)_minmax(0,1fr)] gap-[14px] px-3 py-4 sm:px-4 lg:px-4 2xl:px-6 max-[1100px]:grid-cols-1 max-[1100px]:h-auto">
        <aside className="relative isolate z-10 flex h-full min-h-0 w-[clamp(380px,32vw,520px)] min-w-0 shrink-0 flex-col gap-2 overflow-hidden border-r border-white/10 bg-[#0B0F16] max-[1100px]:w-full">
          <div className="flex flex-wrap items-center gap-3 border-b border-white/10 pb-2">
            <div className="shrink-0 whitespace-nowrap text-sm font-semibold text-white">
              Viagens encontradas <span className="text-white/50">({filteredTrips.length})</span>
            </div>
            <div className="flex h-9 flex-1 min-w-[220px] items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 text-sm">
              <span className="text-white/40">🔎</span>
              <input
                value={tripSearch}
                onChange={(event) => setTripSearch(event.target.value)}
                placeholder="Buscar por origem, destino..."
                className="min-w-0 flex-1 bg-transparent text-sm text-white outline-none"
              />
            </div>
          </div>

          <div className="flex flex-1 min-h-0 flex-col items-stretch justify-start gap-2 overflow-y-auto overflow-x-hidden pr-1">
            {loading && (
              <div className="rounded-[14px] border border-white/10 bg-white/5 p-3 text-xs text-white/60">
                Processando relatório...
              </div>
            )}
            {filteredTrips.map((trip, index) => {
              const tripKey = resolveTripKey(trip);
              const selectedKey = selectedTrip ? resolveTripKey(selectedTrip) : "";
              const isSelected = selectedKey ? selectedKey === tripKey : selectedTrip === trip;
              const itemKey = tripKey || `trip-${index}`;
              const isExpanded = expandedTripKey === itemKey;
              const startValue = resolveTripTimeValue(trip, "start");
              const endValue = resolveTripTimeValue(trip, "end");
              const startLabel = formatDateTime(parseDate(startValue), locale);
              const endLabel = formatDateTime(parseDate(endValue), locale);
              const distanceLabel = formatDistance(resolveTripDistanceMeters(trip));
              const durationLabel = formatDuration(resolveTripDurationSeconds(trip));
              const maxSpeed = resolveTripMaxSpeed(trip);
              const stopCountValue = resolveTripStopCount(trip);
              const fullStartAddress = resolveTripAddressValue(trip, "start");
              const fullEndAddress = resolveTripAddressValue(trip, "end");
              const shortStartAddress = resolveTripShortAddress(trip, "start");
              const shortEndAddress = resolveTripShortAddress(trip, "end");
              const signalBadge = resolveTripSignalBadge(trip);
              const badgeBase = "rounded-full border px-2 py-0.5 text-[9px] uppercase tracking-wide";
              const chipItems = [
                signalBadge
                  ? {
                      key: "signal",
                      label: signalBadge.label,
                      tone: signalBadge.tone,
                    }
                  : null,
                distanceLabel
                  ? {
                      key: "distance",
                      label: distanceLabel,
                    }
                  : null,
                durationLabel
                  ? {
                      key: "duration",
                      label: durationLabel,
                    }
                  : null,
              ].filter(Boolean);
              const chipVisible = chipItems.slice(0, 3);
              const chipExtra = chipItems.length - chipVisible.length;
              return (
                <div
                  key={itemKey}
                  role="button"
                  tabIndex={0}
                  onClick={() => handleSelectTrip(trip)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      handleSelectTrip(trip);
                    }
                  }}
                  className={`relative flex-none shrink-0 w-full max-w-full cursor-pointer overflow-hidden rounded-[12px] border px-3 py-2.5 text-left transition focus:outline-none focus-visible:outline-none ${
                    isSelected
                      ? "border-primary/60 bg-primary/10"
                      : "border-white/10 bg-white/[0.03] hover:border-white/20"
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[11px] font-semibold text-white" title={`${startLabel} → ${endLabel}`}>
                        {startLabel} → {endLabel}
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <div className="flex items-center gap-1 whitespace-nowrap">
                        {chipVisible.map((chip) => (
                          <span
                            key={chip.key}
                            className={`${badgeBase} ${
                              chip.tone === "good"
                                ? "border-emerald-400/40 bg-emerald-400/10 text-emerald-100"
                                : chip.tone === "warn"
                                  ? "border-amber-300/40 bg-amber-300/10 text-amber-100"
                                  : chip.tone === "bad"
                                    ? "border-red-400/40 bg-red-400/10 text-red-100"
                                    : "border-white/10 bg-white/5 text-white/70"
                            }`}
                          >
                            {chip.label}
                          </span>
                        ))}
                        {chipExtra > 0 ? (
                          <span className={`${badgeBase} border-white/10 bg-white/5 text-white/70`}>+{chipExtra}</span>
                        ) : null}
                      </div>
                      <button
                        type="button"
                        className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[9px] text-white/70 hover:border-primary/50"
                        onClick={(event) => {
                          event.stopPropagation();
                          setExpandedTripKey((prev) => (prev === itemKey ? null : itemKey));
                        }}
                      >
                        {isExpanded ? "Ocultar" : "Detalhes"}
                      </button>
                    </div>
                  </div>

                  <div className="mt-1 space-y-1 text-[10px] text-white/60">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="flex h-2 w-2 items-center justify-center rounded-full border border-white/20 bg-white/10">
                        <span className="h-1.5 w-1.5 rounded-full bg-primary/70" />
                      </span>
                      <span className="text-white/40">Origem:</span>
                      <div className="min-w-0 flex-1 line-clamp-2 break-words" title={fullStartAddress || "—"}>
                        {shortStartAddress}
                      </div>
                    </div>
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="flex h-2 w-2 items-center justify-center rounded-full border border-white/20 bg-white/10">
                        <span className="h-1.5 w-1.5 rounded-full bg-purple-300/80" />
                      </span>
                      <span className="text-white/40">Destino:</span>
                      <div className="min-w-0 flex-1 line-clamp-2 break-words" title={fullEndAddress || "—"}>
                        {shortEndAddress}
                      </div>
                    </div>
                  </div>

                  {isExpanded ? (
                    <div className="mt-1 space-y-1 text-[10px] text-white/60">
                      <div className="line-clamp-2">
                        <span className="text-white/40">Origem completa:</span>{" "}
                        <span>{fullStartAddress || "—"}</span>
                      </div>
                      <div className="line-clamp-2">
                        <span className="text-white/40">Destino completo:</span>{" "}
                        <span>{fullEndAddress || "—"}</span>
                      </div>
                      {Number.isFinite(stopCountValue) ? (
                        <div>
                          <span className="text-white/40">Paradas:</span> {stopCountValue}
                        </div>
                      ) : null}
                      {Number.isFinite(maxSpeed) ? (
                        <div>
                          <span className="text-white/40">Vel máx:</span> {Math.round(maxSpeed)} km/h
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </aside>

        <section className="relative z-0 flex h-full min-h-0 min-w-0 flex-col gap-3 overflow-y-auto overflow-x-hidden pr-1">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/10 pb-2 min-[1200px]:flex-nowrap">
            <div className="flex items-center gap-3">
              <span className="rounded-full border border-primary/40 bg-primary/10 px-3 py-1 text-xs font-semibold tracking-[0.12em]" style={{ fontFamily: '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace' }}>
                {selectedVehicle?.plate || "—"}
              </span>
              <div className="min-w-0">
                <div className="truncate text-sm font-extrabold text-white">
                  {selectedTrip
                    ? `${formatDistance(resolveTripDistanceMeters(selectedTrip))} • ${formatDuration(
                        resolveTripDurationSeconds(selectedTrip),
                      )}`
                    : "Trajeto selecionado"}
                </div>
                <div className="truncate text-xs text-white/60">
                  {selectedTrip
                    ? `${formatDateTime(parseDate(resolveTripTimeValue(selectedTrip, "start")), locale)} → ${formatDateTime(
                        parseDate(resolveTripTimeValue(selectedTrip, "end")),
                        locale,
                      )}`
                    : "Selecione uma viagem para visualizar."}
                </div>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {[
                { key: "replay", label: "Replay" },
                { key: "audit", label: "Auditoria" },
              ].map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setActiveTab(tab.key)}
                  className={`h-9 rounded-full border px-4 text-xs font-semibold transition ${
                    activeTab === tab.key
                      ? "border-primary/60 bg-primary/20 text-white"
                      : "border-white/10 bg-white/5 text-white/60 hover:border-white/20 hover:text-white"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex min-h-0 flex-1 flex-col gap-3">
            {activeTab === "replay" ? (
              <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-white/10 pb-2 text-xs min-[1200px]:flex-nowrap">
                <div className="flex flex-col gap-1">
                  <button
                    type="button"
                    className="h-9 whitespace-nowrap rounded-full border border-primary/60 bg-primary/20 px-4 text-xs font-semibold text-white"
                    onClick={handlePlayToggle}
                    disabled={!totalPoints || routeLoading}
                  >
                    {isPlaying ? "Pausar" : "Reproduzir"}
                  </button>
                  {shouldShowItinerarySelector ? (
                    <div className="flex flex-col gap-1 text-[10px] text-white/60">
                      <label className="flex flex-col gap-1">
                        <span className="uppercase tracking-[0.14em]">Rota/Itinerário do trajeto</span>
                        <AutocompleteSelect
                          value={selectedItineraryId}
                          options={itinerarySelectOptions}
                          onChange={(value) => setSelectedItineraryId(String(value || ""))}
                          disabled={!selectedVehicle || itineraryListLoading || shouldWaitForMirror}
                          placeholder="Buscar itinerário"
                          className="min-w-[240px]"
                          inputClassName="h-8 rounded-full px-3 text-xs"
                          allowClear
                          emptyText="Nenhum itinerário encontrado."
                        />
                      </label>
                      <div className="min-h-[32px] space-y-1 text-[10px] text-white/60">
                        {selectedItineraryMeta ? (
                          <>
                            <span
                              className={`block text-[10px] uppercase tracking-[0.12em] ${
                                itineraryConfirmed ? "text-sky-200" : "text-red-200"
                              }`}
                            >
                              Status: {selectedItineraryMeta.statusLabel || (itineraryConfirmed ? "Confirmado" : "Pendente")}
                            </span>
                            <span className="block text-[10px] text-white/60">
                              Tolerância pra Desvio de Rota embarcada: {itineraryBufferLabel}
                            </span>
                          </>
                        ) : (
                          <span className="text-[10px] text-white/40">
                            Selecione um itinerário para ver a tolerância.
                          </span>
                        )}
                      </div>
                      {itineraryListLoading ? (
                        <span className="text-[10px] text-white/40">Carregando itinerários...</span>
                      ) : itineraryListError ? (
                        <span className="text-[10px] text-red-300">Falha ao carregar itinerários</span>
                      ) : itineraryOverlayLoading ? (
                        <span className="text-[10px] text-white/40">Carregando mapa do itinerário...</span>
                      ) : itineraryOverlayError ? (
                        <span className="text-[10px] text-red-300">Falha ao carregar itinerário</span>
                      ) : null}
                    </div>
                  ) : null}
                </div>

                <div className="flex h-9 items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 text-xs">
                  <span className="text-white/60">Velocidade</span>
                  <select
                    value={speed}
                    onChange={(event) => setSpeed(Number(event.target.value))}
                    className="h-full bg-transparent text-xs text-white outline-none"
                  >
                    {REPLAY_SPEEDS.map((value) => (
                      <option key={value} value={value}>
                        {value}x
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex shrink-0 overflow-hidden rounded-full border border-white/10 bg-white/5">
                  {[
                    { key: "sat", label: "Satélite" },
                    { key: "road", label: "Ruas" },
                    { key: "hybrid", label: "Híbrido" },
                  ].map((option) => (
                    <button
                      key={option.key}
                      type="button"
                      onClick={() => handleMapTypeChange(option.key)}
                      className={`px-3 py-2 text-xs transition ${
                        mapTypeKey === option.key ? "bg-white/10 text-white" : "text-white/60 hover:text-white"
                      }`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>

                <div className="flex w-full flex-wrap items-center justify-end gap-4 text-xs text-white/60 sm:ml-auto sm:w-auto">
                  <div className="flex items-center gap-2">
                    <span>Map Matching</span>
                    <button
                      type="button"
                      onClick={() => {
                        const next = !mapMatchingEnabled;
                        setMapMatchingEnabled(next);
                        if (!next) {
                          setMapMatchingError(null);
                          setMapMatchingNotice(null);
                        }
                      }}
                      className={`h-6 w-12 rounded-full border transition ${
                        mapMatchingEnabled ? "border-emerald-400/40 bg-emerald-400/20" : "border-white/10 bg-white/5"
                      }`}
                    >
                      <span
                        className={`block h-4 w-4 rounded-full bg-white transition ${
                          mapMatchingEnabled ? "translate-x-6" : "translate-x-1"
                        }`}
                      />
                    </button>
                  </div>
                  <div className="flex items-center gap-2">
                    <span>Rota lógica</span>
                    <button
                      type="button"
                      onClick={() => {
                        const next = !logicalRouteEnabled;
                        setLogicalRouteEnabled(next);
                        if (!next) {
                          setLogicalRouteError(null);
                          setLogicalRouteProvider(null);
                        }
                      }}
                      className={`h-6 w-12 rounded-full border transition ${
                        logicalRouteEnabled ? "border-emerald-400/40 bg-emerald-400/20" : "border-white/10 bg-white/5"
                      }`}
                    >
                      <span
                        className={`block h-4 w-4 rounded-full bg-white transition ${
                          logicalRouteEnabled ? "translate-x-6" : "translate-x-1"
                        }`}
                      />
                    </button>
                  </div>
                </div>
              </div>
            ) : null}

            {activeTab === "replay" ? (
              <div className="flex min-h-0 flex-1 flex-col gap-3">
                <div className="shrink-0 overflow-hidden rounded-[16px] border border-white/10 bg-[#0f141c]/60">
                  <div className="flex items-center justify-between border-b border-white/10 bg-black/30 px-4 py-2 text-xs">
                    <span className="font-semibold text-white">Mapa do trajeto</span>
                    <span className="text-white/50">{selectedVehicle?.plate || "—"}</span>
                  </div>
                  <div className="h-[clamp(320px,46vh,520px)] overflow-hidden">
                    <ReplayMap
                      points={routePoints}
                      activeIndex={activeIndex}
                      animatedPoint={animatedPoint}
                      animatedLivePointRef={animatedLivePointRef}
                      mapLayer={mapLayer}
                      pathToRender={pathToRender}
                      focusMode="map"
                      isPlaying={isPlaying}
                      manualCenter={manualCenter}
                      tripKey={selectedTrip ? resolveTripKey(selectedTrip) : ""}
                      selectedVehicle={selectedVehicle}
                      isActive={activeTab === "replay"}
                      itineraryOverlay={itineraryOverlay}
                      itineraryConfirmed={itineraryConfirmed}
                      layoutToken={`${drawerTab}-${activeTab}`}
                    />
                  </div>
                </div>

                <div className="shrink-0 rounded-[16px] border border-white/10 bg-black/40 px-4 py-3 text-xs">
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="flex flex-wrap items-center gap-4 text-white/60">
                      <span>
                        <span className="font-semibold text-white">Ponto:</span> {activeIndex + 1} / {Math.max(totalPoints, 1)}
                      </span>
                      <span>
                        <span className="font-semibold text-white">Vel.:</span>{" "}
                        {activePoint?.__speed != null ? `${Math.round(activePoint.__speed)} km/h` : "—"}
                      </span>
                      <span>
                        <span className="font-semibold text-white">Horário:</span>{" "}
                        {playbackDate ? formatDateTime(playbackDate, locale) : "—"}
                      </span>
                    </div>
                    <div className="flex min-w-[220px] flex-1 items-center gap-2">
                      <button
                        type="button"
                        className="h-8 rounded-full border border-white/10 bg-white/5 px-3 text-xs text-white hover:border-white/20"
                        onClick={() => handleSelectPoint(Math.max(0, activeIndex - 1))}
                        disabled={activeIndex <= 0}
                      >
                        ◀
                      </button>
                      <input
                        type="range"
                        min={0}
                        max={REPLAY_SLIDER_RESOLUTION}
                        value={sliderValue}
                        onChange={(event) => handleSliderChange(Number(event.target.value))}
                        disabled={!routePoints.length}
                        className="w-full accent-primary"
                      />
                      <button
                        type="button"
                        className="h-8 rounded-full border border-white/10 bg-white/5 px-3 text-xs text-white hover:border-white/20"
                        onClick={() => handleSelectPoint(Math.min(timelineMax, activeIndex + 1))}
                        disabled={activeIndex >= timelineMax}
                      >
                        ▶
                      </button>
                    </div>
                  </div>
                </div>

                <div className="flex min-w-0 flex-1 min-h-0 flex-col rounded-[16px] border border-white/10 bg-white/[0.02]">
                  <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-white/10 bg-black/20 px-4 py-2 text-xs">
                    <div className="flex items-center gap-3 text-white/70">
                      <span className="font-semibold text-white">
                        {drawerTab === "audit" ? "Auditoria" : drawerTab === "positions" ? "Posições" : "Eventos"}
                      </span>
                      <span className="text-[11px] text-white/50">{drawerCountLabel}</span>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {[
                        { key: "events", label: "Eventos" },
                        { key: "audit", label: "Auditoria" },
                        { key: "positions", label: "Posições" },
                      ].map((tab) => (
                        <button
                          key={tab.key}
                          type="button"
                          onClick={() => setDrawerTab(tab.key)}
                          className={`rounded-full border px-3 py-1 text-[11px] font-semibold transition ${
                            drawerTab === tab.key
                              ? "border-primary/60 bg-primary/20 text-white"
                              : "border-white/10 bg-white/5 text-white/60 hover:border-white/20 hover:text-white"
                          }`}
                        >
                          {tab.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="flex min-h-0 min-w-0 flex-1 flex-col px-4 py-4 text-xs text-white/70">
                    {drawerTab === "events" ? (
                      <div className="flex min-h-0 flex-1 flex-col gap-3">
                        <div className="shrink-0 space-y-3">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex items-center gap-2 text-xs text-white/60">
                              <span>Evento atual:</span>
                              <span className="font-semibold text-white">{currentEventLabel}</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] text-white/70 hover:border-primary/50"
                                onClick={() => handleJumpToEvent(-1)}
                              >
                                ◀
                              </button>
                              <button
                                type="button"
                                className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] text-white/70 hover:border-primary/50"
                                onClick={() => handleJumpToEvent(1)}
                              >
                                ▶
                              </button>
                            </div>
                          </div>
                          <div className="flex h-8 min-w-0 items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 text-[11px]">
                            <span className="text-white/40">🔎</span>
                            <input
                              value={eventSearch}
                              onChange={(event) => setEventSearch(event.target.value)}
                              placeholder="Filtrar eventos..."
                              className="w-full max-w-[14rem] bg-transparent text-[11px] text-white outline-none"
                            />
                          </div>
                        </div>
                        <div className="min-w-0 pr-1">
                          <div className="min-w-0 space-y-2">
                          {tripEventsLoading ? (
                            <div className="rounded-[12px] border border-white/10 bg-white/5 p-3 text-[11px] text-white/60">
                              Carregando eventos do trajeto...
                            </div>
                          ) : null}
                          {showTripEventsError ? (
                            <div className="rounded-[12px] border border-red-400/40 bg-red-400/10 p-3 text-[11px] text-red-100">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <span>{tripEventsError}</span>
                                <button
                                  type="button"
                                  className="rounded-full border border-red-300/60 bg-red-400/10 px-3 py-1 text-[11px] text-red-100 hover:border-red-200"
                                  onClick={() => setEventsReloadToken((prev) => prev + 1)}
                                >
                                  Tentar novamente
                                </button>
                              </div>
                            </div>
                          ) : null}
                          {limitedEventEntries.length ? (
                            limitedEventEntries.map((event) => (
                              <div
                                key={`event-${event.index}-${event.time?.toISOString?.() ?? event.index}`}
                                className="rounded-[12px] border border-white/10 bg-white/5 px-3 py-2"
                              >
                                {timelineEntryByIndex.get(event.index) || event.__address ? (
                                  <div className="text-[11px] text-white/50">
                                    {timelineEntryByIndex.get(event.index)
                                      ? resolveEntryAddress(timelineEntryByIndex.get(event.index))
                                      : event.__address}
                                  </div>
                                ) : null}
                                <div className="flex items-center justify-between gap-2 text-[11px] text-white/60">
                                  <span className="font-semibold text-white">{event.label || "Evento"}</span>
                                  <span style={{ fontFamily: '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace' }}>
                                    {event.time instanceof Date ? event.time.toLocaleTimeString() : "—"}
                                  </span>
                                </div>
                                <div className="mt-1 text-[11px] text-white/50">
                                  {event.lat && event.lng ? `${event.lat.toFixed?.(5) ?? event.lat}, ${event.lng.toFixed?.(5) ?? event.lng}` : "—"}
                                </div>
                                <div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-white/60">
                                  <span>
                                    {event.label}
                                    {event.__category === "security" ? " • Segurança" : ""}
                                  </span>
                                  <div className="flex items-center gap-2">
                                    {event.__severityLabel ? (
                                      <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[9px] text-white/70">
                                        {event.__severityLabel}
                                      </span>
                                    ) : null}
                                    <button
                                      type="button"
                                      className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] text-white hover:border-primary/50"
                                      onClick={() => handleSelectPoint(event.index, { centerMap: true })}
                                    >
                                      Ver/Ir
                                    </button>
                                  </div>
                                </div>
                              </div>
                            ))
                          ) : (
                            <div className="rounded-[12px] border border-white/10 bg-white/5 p-3 text-[11px] text-white/60">
                              Nenhum evento para este filtro.
                            </div>
                          )}
                          </div>
                        </div>
                        {filteredEventEntries.length > MAX_DRAWER_ROWS ? (
                          <div className="shrink-0 text-[11px] text-white/50">
                            Mostrando {MAX_DRAWER_ROWS} de {filteredEventEntries.length} eventos.
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                    {drawerTab === "audit" ? (
                      <div className="flex min-h-0 flex-1 flex-col gap-3">
                        <div className="shrink-0">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="text-sm font-semibold text-white">Linha do tempo</div>
                            <div className="flex flex-wrap items-center gap-2">
                              <div className="flex h-8 items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 text-[11px]">
                                <span className="text-white/40">🔎</span>
                                <input
                                  value={auditSearch}
                                  onChange={(event) => setAuditSearch(event.target.value)}
                                  placeholder="Filtrar eventos..."
                                  className="w-full max-w-[14rem] bg-transparent text-[11px] text-white outline-none"
                                />
                              </div>
                              <div className="relative">
                                <button
                                  type="button"
                                  className="h-8 rounded-full border border-white/10 bg-white/5 px-3 text-[11px] font-semibold text-white/80 hover:border-white/20"
                                  onClick={() => setColumnPickerOpen((prev) => !prev)}
                                >
                                  Colunas
                                </button>
                                {columnPickerOpen ? (
                                  <div className="absolute right-0 z-20 mt-2 w-72 rounded-xl border border-white/10 bg-[#111E36] p-3 text-xs shadow-[0_18px_60px_rgba(0,0,0,0.45)]">
                                    <div className="flex items-center justify-between text-[11px] text-white/60">
                                      <span>Colunas visíveis</span>
                                      <div className="flex items-center gap-2">
                                        <button
                                          type="button"
                                          className="rounded-full border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-white/70 hover:border-primary/50"
                                          onClick={() => applyColumnPreset("default")}
                                        >
                                          Padrão
                                        </button>
                                        <button
                                          type="button"
                                          className="rounded-full border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-white/70 hover:border-primary/50"
                                          onClick={() => applyColumnPreset("all")}
                                        >
                                          Tudo
                                        </button>
                                      </div>
                                    </div>
                                    <div className="mt-3 max-h-64 space-y-2 overflow-auto pr-1">
                                      {availableColumnDefs.map((column) => {
                                        const isSelected = selectedColumns.includes(column.key);
                                        const index = selectedColumns.indexOf(column.key);
                                        return (
                                          <div
                                            key={column.key}
                                            className={`flex items-center justify-between gap-2 rounded-lg border px-2 py-2 ${
                                              isSelected ? "border-primary/50 bg-primary/10" : "border-white/10 bg-white/5"
                                            }`}
                                          >
                                            <label className="flex items-center gap-2 text-[11px] text-white/80">
                                              <input
                                                type="checkbox"
                                                checked={isSelected}
                                                onChange={() => handleToggleColumn(column.key)}
                                                className="accent-primary"
                                              />
                                              <span>{column.label}</span>
                                            </label>
                                            <div className="flex items-center gap-1">
                                              <button
                                                type="button"
                                                className="rounded-full border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-white/70 hover:border-primary/50"
                                                onClick={() => handleMoveColumn(column.key, -1)}
                                                disabled={!isSelected || index <= 0}
                                                title="Mover para cima"
                                              >
                                                ↑
                                              </button>
                                              <button
                                                type="button"
                                                className="rounded-full border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-white/70 hover:border-primary/50"
                                                onClick={() => handleMoveColumn(column.key, 1)}
                                                disabled={!isSelected || index < 0 || index >= selectedColumns.length - 1}
                                                title="Mover para baixo"
                                              >
                                                ↓
                                              </button>
                                            </div>
                                          </div>
                                        );
                                      })}
                                    </div>
                                  </div>
                                ) : null}
                              </div>
                            </div>
                          </div>
                        </div>

                        <div className="shrink-0 text-[11px] text-white/50">
                          <span>{statusText}</span>
                        </div>

                        <div className="min-w-0 pr-1">
                          <TimelineTable
                            entries={limitedAuditEntries}
                            activeIndex={activeIndex}
                            onSelect={handleSelectPoint}
                            locale={locale}
                            columns={visibleColumns}
                            resolveAddress={resolveEntryAddress}
                            focusMode="table"
                            isPlaying={isPlaying}
                          />
                          {filteredAuditEntries.length > MAX_DRAWER_ROWS ? (
                            <div className="mt-2 text-[11px] text-white/50">
                              Mostrando {MAX_DRAWER_ROWS} de {filteredAuditEntries.length} registros.
                            </div>
                          ) : null}
                        </div>
                      </div>
                    ) : null}
                    {drawerTab === "positions" ? (
                      <div className="flex min-h-0 flex-1 flex-col gap-3">
                        <div className="shrink-0">
                          <div className="flex items-center justify-between gap-2">
                            <div className="text-sm font-semibold text-white">Posições</div>
                            <div className="flex h-8 min-w-0 items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 text-[11px]">
                              <span className="text-white/40">🔎</span>
                              <input
                                value={positionsSearch}
                                onChange={(event) => setPositionsSearch(event.target.value)}
                                placeholder="Filtrar posições..."
                                className="w-full max-w-[14rem] bg-transparent text-[11px] text-white outline-none"
                              />
                            </div>
                          </div>
                        </div>
                        <div className="min-w-0 pr-1">
                          {limitedPositions.length ? (
                            <table className="min-w-full text-[11px] text-white/80">
                              <thead className="sticky top-0 bg-slate-900/80 backdrop-blur">
                                <tr>
                                  <th className="px-3 py-2 text-left font-semibold text-white/70">Hora</th>
                                  <th className="px-3 py-2 text-left font-semibold text-white/70">Vel.</th>
                                  <th className="px-3 py-2 text-left font-semibold text-white/70">Lat</th>
                                  <th className="px-3 py-2 text-left font-semibold text-white/70">Lon</th>
                                  <th className="px-3 py-2 text-left font-semibold text-white/70">Endereço</th>
                                  <th className="px-3 py-2 text-right font-semibold text-white/70">Ação</th>
                                </tr>
                              </thead>
                              <tbody>
                                {limitedPositions.map((entry) => (
                                  <tr key={`pos-${entry.index}`} className="border-b border-white/5 hover:bg-white/5">
                                    <td className="px-3 py-2 text-white/80" style={{ fontFamily: '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace' }}>
                                      {entry.time instanceof Date ? entry.time.toLocaleTimeString() : "—"}
                                    </td>
                                    <td className="px-3 py-2 text-white/80" style={{ fontFamily: '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace' }}>
                                      {entry.speed !== null && entry.speed !== undefined ? `${Math.round(entry.speed)} km/h` : "—"}
                                    </td>
                                    <td className="px-3 py-2 text-white/70" style={{ fontFamily: '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace' }}>
                                      {Number.isFinite(entry.lat) ? entry.lat.toFixed(5) : "—"}
                                    </td>
                                    <td className="px-3 py-2 text-white/70" style={{ fontFamily: '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace' }}>
                                      {Number.isFinite(entry.lng) ? entry.lng.toFixed(5) : "—"}
                                    </td>
                                    <td className="px-3 py-2 text-white/70">{resolveEntryAddress(entry)}</td>
                                    <td className="px-3 py-2 text-right">
                                      <button
                                        type="button"
                                        className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] text-white hover:border-primary/50"
                                        onClick={() => handleSelectPoint(entry.index, { centerMap: true })}
                                      >
                                        Ver/Ir
                                      </button>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          ) : (
                            <div className="flex h-[160px] items-center justify-center text-sm text-white/60">
                              Nenhuma posição para este filtro.
                            </div>
                          )}
                        </div>
                        {filteredPositions.length > MAX_DRAWER_ROWS ? (
                          <div className="text-[11px] text-white/50">
                            Mostrando {MAX_DRAWER_ROWS} de {filteredPositions.length} posições.
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
            ) : (
              <div className="rounded-[16px] border border-white/10 bg-white/[0.02] px-4 py-4 text-xs text-white/70">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-sm font-semibold text-white">Linha do tempo</div>
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="flex h-8 min-w-0 items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 text-[11px]">
                      <span className="text-white/40">🔎</span>
                      <input
                        value={auditSearch}
                        onChange={(event) => setAuditSearch(event.target.value)}
                        placeholder="Filtrar eventos..."
                        className="w-full max-w-[14rem] bg-transparent text-[11px] text-white outline-none"
                      />
                    </div>
                    <div className="relative">
                      <button
                        type="button"
                        className="h-8 rounded-full border border-white/10 bg-white/5 px-3 text-[11px] font-semibold text-white/80 hover:border-white/20"
                        onClick={() => setColumnPickerOpen((prev) => !prev)}
                      >
                        Colunas
                      </button>
                      {columnPickerOpen ? (
                        <div className="absolute right-0 z-20 mt-2 w-72 rounded-xl border border-white/10 bg-[#111E36] p-3 text-xs shadow-[0_18px_60px_rgba(0,0,0,0.45)]">
                          <div className="flex items-center justify-between text-[11px] text-white/60">
                            <span>Colunas visíveis</span>
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                className="rounded-full border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-white/70 hover:border-primary/50"
                                onClick={() => applyColumnPreset("default")}
                              >
                                Padrão
                              </button>
                              <button
                                type="button"
                                className="rounded-full border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-white/70 hover:border-primary/50"
                                onClick={() => applyColumnPreset("all")}
                              >
                                Tudo
                              </button>
                            </div>
                          </div>
                          <div className="mt-3 max-h-64 space-y-2 overflow-auto pr-1">
                            {availableColumnDefs.map((column) => {
                              const isSelected = selectedColumns.includes(column.key);
                              const index = selectedColumns.indexOf(column.key);
                              return (
                                <div
                                  key={column.key}
                                  className={`flex items-center justify-between gap-2 rounded-lg border px-2 py-2 ${
                                    isSelected ? "border-primary/50 bg-primary/10" : "border-white/10 bg-white/5"
                                  }`}
                                >
                                  <label className="flex items-center gap-2 text-[11px] text-white/80">
                                    <input
                                      type="checkbox"
                                      checked={isSelected}
                                      onChange={() => handleToggleColumn(column.key)}
                                      className="accent-primary"
                                    />
                                    <span>{column.label}</span>
                                  </label>
                                  <div className="flex items-center gap-1">
                                    <button
                                      type="button"
                                      className="rounded-full border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-white/70 hover:border-primary/50"
                                      onClick={() => handleMoveColumn(column.key, -1)}
                                      disabled={!isSelected || index <= 0}
                                      title="Mover para cima"
                                    >
                                      ↑
                                    </button>
                                    <button
                                      type="button"
                                      className="rounded-full border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-white/70 hover:border-primary/50"
                                      onClick={() => handleMoveColumn(column.key, 1)}
                                      disabled={!isSelected || index < 0 || index >= selectedColumns.length - 1}
                                      title="Mover para baixo"
                                    >
                                      ↓
                                    </button>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>

                <div className="mt-3 text-[11px] text-white/50">
                  <span>{statusText}</span>
                </div>

                <div className="mt-3">
                  <TimelineTable
                    entries={limitedAuditEntries}
                    activeIndex={activeIndex}
                    onSelect={handleSelectPoint}
                    locale={locale}
                    columns={visibleColumns}
                    resolveAddress={resolveEntryAddress}
                    focusMode="table"
                    isPlaying={isPlaying}
                  />
                  {filteredAuditEntries.length > MAX_DRAWER_ROWS ? (
                    <div className="mt-2 text-[11px] text-white/50">
                      Mostrando {MAX_DRAWER_ROWS} de {filteredAuditEntries.length} registros.
                    </div>
                  ) : null}
                </div>
              </div>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
