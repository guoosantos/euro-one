import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { MapContainer, Marker, Polyline, TileLayer, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

import useVehicles, { normalizeVehicleDevices } from "../lib/hooks/useVehicles.js";
import { useTranslation } from "../lib/i18n.js";
import useReportsRoute from "../lib/hooks/useReportsRoute";
import { useReports } from "../lib/hooks/useReports";
import { formatDateTime, pickCoordinate, pickSpeed } from "../lib/monitoring-helpers.js";
import useAddressLookup from "../lib/hooks/useAddressLookup.js";
import { formatAddress } from "../lib/format-address.js";
import { FALLBACK_ADDRESS } from "../lib/utils/geocode.js";
import { resolveEventDefinitionFromPayload } from "../lib/event-translations.js";
import safeApi from "../lib/safe-api.js";
import { API_ROUTES } from "../lib/api-routes.js";
import {
  DEFAULT_MAP_LAYER_KEY,
  ENABLED_MAP_LAYERS,
  MAP_LAYER_FALLBACK,
  MAP_LAYER_SECTIONS,
  MAP_LAYER_STORAGE_KEYS,
  getValidMapLayer,
} from "../lib/mapLayers.js";
import { toDeviceKey } from "../lib/hooks/useDevices.helpers.js";
import VehicleSelector from "../components/VehicleSelector.jsx";
import useVehicleSelection from "../lib/hooks/useVehicleSelection.js";
import { getVehicleIconSvg } from "../lib/icons/vehicleIcons.js";

// Discovery note (Epic B): this page will receive map layer selection,
// improved replay rendering, and event navigation for trip playback.

const DEFAULT_CENTER = [-19.9167, -43.9345];
const DEFAULT_ZOOM = 15;
const DEFAULT_FROM = () => new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 16);
const DEFAULT_TO = () => new Date().toISOString().slice(0, 16);
const FALLBACK_CENTER = [-15.793889, -47.882778];
const FALLBACK_ZOOM = 5;
const REPLAY_SPEEDS = [1, 2, 4, 8];
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
const ROUTE_WEIGHT = 7;

const TRIP_EVENT_TRANSLATIONS = {
  "position registered": "Posição registrada",
  position: "Posição registrada",
  overspeed: "Excesso de velocidade",
  "harsh braking": "Frenagem brusca",
  "harsh-braking": "Frenagem brusca",
  "harsh acceleration": "Aceleração brusca",
  "harsh-acceleration": "Aceleração brusca",
  "ignition on": "Ignição ligada",
  "ignition off": "Ignição desligada",
};

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

function sampleRouteForMatching(points = [], { maxPoints = 240, minDistanceMeters = 12 } = {}) {
  if (!Array.isArray(points) || points.length <= maxPoints) {
    return points.filter(Boolean);
  }
  const sampled = [];
  let lastKept = null;

  points.forEach((point, index) => {
    if (!point) return;
    if (sampled.length === 0 || index === points.length - 1) {
      sampled.push(point);
      lastKept = point;
      return;
    }
    const distance = haversineDistance(
      { lat: lastKept?.lat, lng: lastKept?.lng },
      { lat: point.lat, lng: point.lng },
    );
    if (!Number.isFinite(distance) || distance >= minDistanceMeters) {
      sampled.push(point);
      lastKept = point;
    }
  });

  if (sampled.length > maxPoints) {
    const step = Math.ceil(sampled.length / maxPoints);
    return sampled.filter((_, idx) => idx % step === 0 || idx === sampled.length - 1);
  }

  return sampled;
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
  const projected = points
    .map((point, index) => {
      if (!Number.isFinite(point?.lat) || !Number.isFinite(point?.lng)) return null;
      const proj = L.CRS.Earth.project(L.latLng(point.lat, point.lng));
      return { index, point, projected: proj };
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

function buildVehicleIcon(bearing = 0, iconType, color = "#86efac") {
  const iconSvg = getVehicleIconSvg(iconType);
  return L.divIcon({
    className: "replay-vehicle",
    html: `
      <div style="position:relative;width:34px;height:34px;display:flex;align-items:center;justify-content:center;">
        <div style="position:absolute;top:-6px;left:50%;transform:translateX(-50%) rotate(${bearing}deg);transform-origin:50% 100%;width:0;height:0;border-left:5px solid transparent;border-right:5px solid transparent;border-bottom:9px solid rgba(37,99,235,0.95);filter:drop-shadow(0 2px 3px rgba(0,0,0,0.3));"></div>
        <div style="width:32px;height:32px;border-radius:12px;background:rgba(15,23,42,0.8);display:flex;align-items:center;justify-content:center;border:1px solid rgba(148,163,184,0.35);box-shadow:0 6px 14px rgba(0,0,0,0.35);backdrop-filter:blur(6px);color:${color};">
          <div style="width:18px;height:18px;display:flex;align-items:center;justify-content:center;">${iconSvg}</div>
        </div>
      </div>
    `,
    iconSize: [32, 32],
    iconAnchor: [16, 16],
  });
}

function normalizeTripEvent(point, helpers = {}) {
  const rawEvent =
    point?.event ||
    point?.type ||
    point?.attributes?.event ||
    point?.attributes?.alarm ||
    point?.attributes?.status ||
    point?.__label;
  if (!rawEvent) return null;
  const normalizedEvent = String(rawEvent).trim();
  const resolvedDefinition = resolveEventDefinitionFromPayload(point, helpers.locale, helpers.t);
  const type = resolvedDefinition?.isNumeric ? resolvedDefinition.type : normalizedEvent.toLowerCase();
  const resolvedLabel = resolvedDefinition?.isNumeric ? resolvedDefinition.label : null;
  return {
    type,
    label: translateTripEvent(resolvedLabel || point?.__label || normalizedEvent),
    icon: resolvedDefinition?.icon || null,
    ignition: resolvedDefinition?.ignition,
  };
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

function normalizeAddressValue(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (ADDRESS_PLACEHOLDERS.has(trimmed.toLowerCase())) return null;
  return trimmed;
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
  selectedVehicle = null,
}) {
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

  const activePoint = routePoints[activeIndex] || routePoints[0] || null;
  const ignitionColor = useMemo(() => {
    const ignition = typeof activePoint?.__ignition === "boolean" ? activePoint.__ignition : null;
    if (ignition === true) return "#22c55e";
    if (ignition === false) return "#ef4444";
    return "#86efac";
  }, [activePoint?.__ignition]);
  const vehicleIcon = useMemo(
    () =>
      buildVehicleIcon(
        animatedPoint?.heading || 0,
        selectedVehicle?.iconType ||
          selectedVehicle?.attributes?.iconType ||
          selectedVehicle?.type ||
          selectedVehicle?.vehicleType ||
          selectedVehicle?.category ||
          selectedVehicle?.attributes?.vehicleType ||
          selectedVehicle?.attributes?.type,
        ignitionColor,
      ),
    [
      animatedPoint?.heading,
      ignitionColor,
      selectedVehicle?.attributes?.iconType,
      selectedVehicle?.iconType,
      selectedVehicle?.attributes?.type,
      selectedVehicle?.attributes?.vehicleType,
      selectedVehicle?.category,
      selectedVehicle?.type,
      selectedVehicle?.vehicleType,
    ],
  );
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

  if (!hasSelectedVehicle) {
    return (
      <div className="relative flex h-[420px] w-full items-center justify-center rounded-xl border border-white/10 bg-[#0f141c] text-sm text-white/60">
        Selecione um veículo para visualizar o replay.
      </div>
    );
  }

  return (
    <div className="relative h-[420px] w-full overflow-hidden rounded-xl border border-white/10 bg-[#0f141c]">
      <MapContainer
        center={initialCenter}
        zoom={initialZoom}
        className="h-full w-full"
      >
        <TileLayer
          key={tileLayer.key}
          attribution={tileLayer.attribution}
          url={tileLayer.url}
          subdomains={resolvedSubdomains}
          maxZoom={resolvedMaxZoom}
        />
        {positions.length ? <Polyline positions={positions} color={ROUTE_COLOR} weight={ROUTE_WEIGHT} opacity={ROUTE_OPACITY} /> : null}
        {animatedMarkerPosition ? <Marker ref={markerRef} position={animatedMarkerPosition} icon={vehicleIcon} /> : null}
        <MapFocus point={activePoint} />
        <ReplayFollower point={normalizedAnimatedPoint} heading={animatedPoint?.heading} enabled={focusMode === "map" && isPlaying} />
        <ManualCenter target={manualCenter} />
        <MapResizeHandler />
      </MapContainer>
    </div>
  );
}

function MapFocus({ point }) {
  const map = useMap();
  const lastViewRef = useRef(null);
  const retryRef = useRef(null);
  const attemptsRef = useRef(0);

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
          map.invalidateSize();
          applyView();
        }, 180);
        return;
      }

      attemptsRef.current = 0;
      lastViewRef.current = key;
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
    if (!map || !point || !enabled) return undefined;

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

    map.panTo([targetOffset.lat, targetOffset.lng], { animate: true });

    return undefined;
  }, [enabled, heading, map, point]);

  return null;
}

function ManualCenter({ target }) {
  const map = useMap();
  const lastTsRef = useRef(null);

  useEffect(() => {
    if (!map || !target) return undefined;
    if (!Number.isFinite(target.lat) || !Number.isFinite(target.lng)) return undefined;
    if (lastTsRef.current === target.ts) return undefined;
    lastTsRef.current = target.ts;

    map.flyTo([target.lat, target.lng], map.getZoom(), { animate: true });

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
        map.whenReady(() => map.invalidateSize());
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
                    const content = rawContent ?? "—";
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

function EventPanel({ events = [], selectedType, onSelectType, totalTimeline = 0 }) {
  const hasEvents = events.length > 0;
  const totalCount = totalTimeline || events.reduce((sum, event) => sum + (event.count || 0), 0);
  const filters = [{ type: "all", label: "Todos", count: totalTimeline }, ...events];

  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-3">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold text-white">Eventos do trajeto</div>
        <div className="text-xs text-white/60">{totalCount} ocorrência(s)</div>
      </div>

      {hasEvents ? (
        <div className="mt-3 space-y-2">
          <div className="max-h-[360px] space-y-2 overflow-y-auto pr-1">
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
  const location = useLocation();
  const navigate = useNavigate();
  const {
    vehicles,
    vehicleOptions,
    loading: loadingVehicles,
    error: vehiclesError,
  } = useVehicles();
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
  const mapMatchingCacheRef = useRef(new Map());
  const logicalRouteCacheRef = useRef(new Map());
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
  const deviceId = deviceIdFromStore || selectedVehicle?.primaryDeviceId || "";
  const deviceUnavailable = Boolean(vehicleId) && !deviceId;

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
        const translatedLabel = translateTripEvent(
          mappedEvent?.label ||
            point.event ||
            point.type ||
            point.attributes?.event ||
            point.attributes?.alarm ||
            point.attributes?.status ||
            "Posição registrada",
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
    setMapMatchingProvider(providerKey);
    setMapMatchingResult(normalized);
    setMapMatchedPath(shouldUseGeometry ? geometry : null);
    if (providerKey === "passthrough") {
      setMapMatchingNotice("Rota original (provider=passthrough). Configure OSRM_BASE_URL no backend para ajustar às ruas.");
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
        }))
        .filter((point) => Number.isFinite(point.lat) && Number.isFinite(point.lng)),
      { maxPoints: MAP_MATCH_MAX_POINTS, minDistanceMeters: 10 },
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
        },
        { timeout: 25_000, signal: abortController.signal },
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
  const mapLayerOptions = useMemo(
    () =>
      MAP_LAYER_SECTIONS.map((section) => ({
        ...section,
        layers: section.layers.filter((layer) => layer.available !== false && layer.url),
      })),
    [],
  );

  const totalPoints = routePoints.length;
  const timelineMax = Math.max(totalPoints - 1, 0);

  const summary = useMemo(() => {
    if (!routePoints.length) return null;
    const validPoints = routePoints.filter((point) => point.__time instanceof Date);
    if (!validPoints.length) return null;
    const speeds = routePoints.map((point) => point.__speed).filter((value) => value !== null && Number.isFinite(value));
    return {
      start: validPoints[0]?.__time ?? null,
      end: validPoints[validPoints.length - 1]?.__time ?? null,
      averageSpeed: speeds.length ? Math.round(speeds.reduce((acc, value) => acc + value, 0) / speeds.length) : null,
      maxSpeed: speeds.length ? Math.max(...speeds) : null,
    };
  }, [routePoints]);

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

  const shouldLookupAddresses = useMemo(
    () => selectedColumns.includes("address") && timelineEntries.length > 0 && !isPlaying,
    [isPlaying, selectedColumns, timelineEntries.length],
  );
  const formatFallbackAddress = useCallback((lat, lng) => {
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      return `${FALLBACK_ADDRESS} (${lat.toFixed(5)}, ${lng.toFixed(5)})`;
    }
    return FALLBACK_ADDRESS;
  }, []);

  const addressWindowSize = 80;
  const replayAddressItems = useMemo(() => {
    if (!shouldLookupAddresses || !timelineEntries.length) return [];
    const sourceEntries = filteredTimelineEntries.length ? filteredTimelineEntries : timelineEntries;
    const focusIndex = sourceEntries.findIndex((entry) => entry.index === activeIndex);
    const windowRadius = Math.max(Math.floor(addressWindowSize / 2), 1);
    const startIndex = focusIndex === -1 ? 0 : Math.max(0, focusIndex - windowRadius);
    const endIndex =
      focusIndex === -1
        ? Math.min(sourceEntries.length, addressWindowSize)
        : Math.min(sourceEntries.length, focusIndex + windowRadius + 1);
    const deduped = new Map();
    const pushEntry = (entry) => {
      if (!entry) return;
      const addressKey = entry.addressKey || buildCoordKey(entry.lat, entry.lng);
      if (!addressKey || deduped.has(addressKey)) return;
      deduped.set(addressKey, { addressKey, lat: entry.lat, lng: entry.lng });
    };

    pushEntry(timelineEntries[0]);
    pushEntry(timelineEntries[timelineEntries.length - 1]);
    sourceEntries.slice(startIndex, endIndex).forEach(pushEntry);
    if (focusIndex === -1) {
      pushEntry(timelineEntries.find((entry) => entry.index === activeIndex));
    }
    return Array.from(deduped.values());
  }, [activeIndex, addressWindowSize, filteredTimelineEntries, shouldLookupAddresses, timelineEntries]);

  const resolveTimelineAddressKey = useCallback((entry) => entry.addressKey || buildCoordKey(entry.lat, entry.lng), []);
  const resolveTimelineAddressCoords = useCallback((entry) => ({ lat: entry.lat, lng: entry.lng }), []);

  const { addresses: resolvedAddresses, loadingKeys: addressLoading } = useAddressLookup(replayAddressItems, {
    getKey: resolveTimelineAddressKey,
    getCoords: resolveTimelineAddressCoords,
    enabled: shouldLookupAddresses && replayAddressItems.length > 0,
  });
  const tripAddressItems = useMemo(() => {
    if (!trips.length) return [];
    const items = [];
    const seen = new Set();
    trips.forEach((trip) => {
      const startLat = toFiniteNumber(trip.startLat ?? trip.startLatitude ?? trip.start?.latitude);
      const startLng = toFiniteNumber(trip.startLon ?? trip.startLongitude ?? trip.start?.longitude);
      const endLat = toFiniteNumber(trip.endLat ?? trip.endLatitude ?? trip.end?.latitude);
      const endLng = toFiniteNumber(trip.endLon ?? trip.endLongitude ?? trip.end?.longitude);

      if (!trip.startShortAddress && !trip.startAddress && Number.isFinite(startLat) && Number.isFinite(startLng)) {
        const key = buildCoordKey(startLat, startLng);
        if (key && !seen.has(key)) {
          seen.add(key);
          items.push({ addressKey: key, lat: startLat, lng: startLng });
        }
      }
      if (!trip.endShortAddress && !trip.endAddress && Number.isFinite(endLat) && Number.isFinite(endLng)) {
        const key = buildCoordKey(endLat, endLng);
        if (key && !seen.has(key)) {
          seen.add(key);
          items.push({ addressKey: key, lat: endLat, lng: endLng });
        }
      }
    });
    return items;
  }, [trips]);

  const resolveTripAddressKey = useCallback(
    (entry) => entry.addressKey || buildCoordKey(entry.lat, entry.lng),
    [],
  );
  const resolveTripAddressCoords = useCallback((entry) => ({ lat: entry.lat, lng: entry.lng }), []);

  const { addresses: tripAddresses, loadingKeys: tripAddressLoading } = useAddressLookup(tripAddressItems, {
    getKey: resolveTripAddressKey,
    getCoords: resolveTripAddressCoords,
    batchSize: 4,
    enabled: tripAddressItems.length > 0,
  });

  const tripEvents = useMemo(
    () =>
      routePoints
        .map((point, index) => {
          const normalized = point.__event || normalizeTripEvent(point, { locale, t });
          if (!normalized) return null;
          return { index, ...normalized, time: point.__time, lat: point.lat, lng: point.lng };
        })
        .filter(Boolean),
    [routePoints],
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
      if (entry?.backendAddress) return entry.backendAddress;
      const key = entry?.addressKey || buildCoordKey(entry?.lat, entry?.lng);
      if (key && resolvedAddresses[key]) {
        const resolved = resolvedAddresses[key];
        if (typeof resolved === "string" && resolved.trim() === key) return FALLBACK_ADDRESS;
        return resolved;
      }
      if (key && addressLoading.has(key)) return "Resolvendo endereço...";
      return formatFallbackAddress(entry?.lat, entry?.lng);
    },
    [addressLoading, formatFallbackAddress, resolvedAddresses],
  );
  const resolveTripAddress = useCallback(
    (trip, type) => {
      const isStart = type === "start";
      const lat = toFiniteNumber(
        isStart ? trip.startLat ?? trip.startLatitude ?? trip.start?.latitude : trip.endLat ?? trip.endLatitude ?? trip.end?.latitude,
      );
      const lng = toFiniteNumber(
        isStart ? trip.startLon ?? trip.startLongitude ?? trip.start?.longitude : trip.endLon ?? trip.endLongitude ?? trip.end?.longitude,
      );
      const backend = isStart
        ? trip.startShortAddress || trip.startAddress
        : trip.endShortAddress || trip.endAddress;
      const normalizedBackend = normalizeAddressValue(backend);
      if (normalizedBackend) return normalizedBackend;
      const key = buildCoordKey(lat, lng);
      if (key && tripAddresses[key]) {
        const resolved = tripAddresses[key];
        if (typeof resolved === "string" && resolved.trim() === key) {
          return formatFallbackAddress(lat, lng);
        }
        return resolved;
      }
      if (key && tripAddressLoading.has(key)) return "Resolvendo endereço...";
      return formatFallbackAddress(lat, lng);
    },
    [formatFallbackAddress, tripAddresses, tripAddressLoading],
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
  const currentEventLabel = selectedEventSummary?.label || activeEvent?.label || "Nenhum evento";

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
    if (!vehicleId && vehicleOptions.length === 1) {
      setVehicleSelection(String(vehicleOptions[0].value));
    }
  }, [vehicleId, vehicleOptions, setVehicleSelection]);

  useEffect(() => {
    const search = new URLSearchParams(location.search || "");
    const pendingVehicleParam = search.get("vehicleId");
    const pendingDeviceParam = search.get("deviceId") || search.get("device");
    const currentVehicleId = normalizeQueryId(vehicleId);
    const currentDeviceId = normalizeQueryId(deviceIdFromStore);

    if (pendingVehicleParam) {
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

  const handleSelectTrip = useCallback(
    async (trip) => {
      setSelectedTrip(trip);
      setActiveIndex(0);
      activeIndexRef.current = 0;
      stopPlayback();
      await loadRouteForTrip(trip);
    },
    [loadRouteForTrip, stopPlayback],
  );

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

  const handleClearFilters = useCallback(() => {
    setSelectedEventType(null);
    setTimelineFilter("all");
    setEventCursor(0);
  }, []);

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

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold text-white">Trajetos</h1>
        <p className="text-sm text-white/60">
          Gere e acompanhe relatórios de viagens por veículo. Quando houver mais de um equipamento, usamos o principal disponível.
        </p>
      </div>

      <form
        onSubmit={handleSubmit}
        className="grid gap-4 rounded-2xl border border-white/10 bg-white/5 p-4 sm:grid-cols-2 lg:grid-cols-4"
      >
        <VehicleSelector className="space-y-1 text-sm text-white/80" />

        <label className="space-y-1 text-sm text-white/80">
          <span className="text-white/60">De</span>
          <input
            type="datetime-local"
            value={from}
            onChange={(event) => setFrom(event.target.value)}
            className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-white focus:border-primary/40 focus:outline-none"
          />
        </label>

        <label className="space-y-1 text-sm text-white/80">
          <span className="text-white/60">Até</span>
          <input
            type="datetime-local"
            value={to}
            onChange={(event) => setTo(event.target.value)}
            className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-white focus:border-primary/40 focus:outline-none"
          />
        </label>

        <div className="flex items-end justify-end gap-2">
          <button type="submit" className="btn" disabled={loading || !deviceId}>
            {loading ? "Gerando..." : "Gerar"}
          </button>
          <button type="button" className="btn btn-ghost" onClick={handleDownload} disabled={downloading || !deviceId}>
            {downloading ? "Exportando..." : "Exportar CSV"}
          </button>
        </div>
      </form>

      {deviceUnavailable && (
        <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-3 text-sm text-yellow-100">
          Selecione um veículo com equipamento vinculado para gerar trajetos.
        </div>
      )}
      {formError ? <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-100">{formError}</div> : null}
      {feedback && feedback.type === "success" && (
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-100">
          {feedback.message}
        </div>
      )}
      {(feedback?.type === "error" || error) && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">
          {feedback?.type === "error" ? feedback.message : error?.message}
        </div>
      )}

      <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
        <div className="flex items-center justify-between gap-2 pb-3">
          <div>
            <div className="text-sm font-semibold text-white">Viagens encontradas</div>
            <div className="text-xs text-white/60">{trips.length} registros</div>
          </div>
          {data?.__meta?.generatedAt ? (
            <div className="text-xs text-white/60">
              Última geração: {formatDateTime(new Date(data.__meta.generatedAt), locale)}
            </div>
          ) : null}
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="text-white/50">
              <tr className="border-b border-white/10 text-left">
                <th className="py-2 pr-4">Início</th>
                <th className="py-2 pr-4">Fim</th>
                <th className="py-2 pr-4">Duração</th>
                <th className="py-2 pr-4">Distância</th>
                <th className="py-2 pr-4">Vel. média</th>
                <th className="py-2 pr-4">Origem</th>
                <th className="py-2 pr-4">Destino</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={7} className="py-4 text-center text-white/60">
                    Processando relatório...
                  </td>
                </tr>
              )}
              {!loading && trips.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-4 text-center text-white/60">
                    Gere um relatório para visualizar os trajetos.
                  </td>
                </tr>
              )}
              {trips.map((trip) => {
                const isSelected = selectedTrip?.id === trip.id && selectedTrip?.startTime === trip.startTime;
                return (
                  <tr
                    key={`${trip.deviceId || trip.device_id}-${trip.startTime}-${trip.endTime}`}
                    className={`border-b border-white/5 cursor-pointer transition hover:bg-white/5 ${
                      isSelected ? "bg-primary/5 border-l-4 border-primary" : ""
                    }`}
                    onClick={() => handleSelectTrip(trip)}
                  >
                    <td className="py-2 pr-4 text-white">{formatDateTime(parseDate(trip.startTime), locale)}</td>
                    <td className="py-2 pr-4 text-white/80">{formatDateTime(parseDate(trip.endTime), locale)}</td>
                    <td className="py-2 pr-4 text-white/70">{formatDuration(trip.duration)}</td>
                    <td className="py-2 pr-4 text-white/70">{formatDistance(trip.distance)}</td>
                    <td className="py-2 pr-4 text-white/70">{formatSpeed(trip.averageSpeed)}</td>
                    <td className="py-2 pr-4 text-white/70">{resolveTripAddress(trip, "start")}</td>
                    <td className="py-2 pr-4 text-white/70">{resolveTripAddress(trip, "end")}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="text-sm font-semibold text-white">Reprodução do trajeto selecionado</div>
            <div className="text-xs text-white/60">{totalPoints ? `${totalPoints} pontos carregados` : "Selecione um trajeto para visualizar."}</div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="btn"
              onClick={handlePlayToggle}
              disabled={!totalPoints || routeLoading}
            >
              {isPlaying ? "Pausar" : "Reproduzir"}
            </button>
            <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/80">
              <span className="text-white/50">Velocidade</span>
              <select
                value={speed}
                onChange={(event) => setSpeed(Number(event.target.value))}
                className="rounded-md border border-white/10 bg-transparent px-2 py-1 text-sm focus:border-primary/40 focus:outline-none"
              >
                {REPLAY_SPEEDS.map((value) => (
                  <option key={value} value={value}>
                    {value}x
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/80">
              <span className="text-white/50">Mapa</span>
              <select
                value={mapLayerKey}
                onChange={(event) => handleMapLayerChange(event.target.value)}
                className="rounded-md border border-white/10 bg-transparent px-2 py-1 text-sm focus:border-primary/40 focus:outline-none"
              >
                {mapLayerOptions.map((section) =>
                  section.layers?.length ? (
                    <optgroup key={section.key} label={section.label}>
                      {section.layers.map((layer) => (
                        <option key={layer.key} value={layer.key}>
                          {layer.label}
                        </option>
                      ))}
                    </optgroup>
                  ) : null,
                )}
              </select>
            </div>
            <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/80">
              <div className="flex flex-col gap-1 leading-tight">
                <span className="text-white/50">Rota</span>
                <label className="flex items-center gap-2 text-xs text-white/80">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-white/20 bg-transparent"
                    checked={mapMatchingEnabled}
                    onChange={(event) => {
                      setMapMatchingEnabled(event.target.checked);
                      if (!event.target.checked) {
                        setMapMatchingError(null);
                        setMapMatchingNotice(null);
                      }
                    }}
                  />
                  <span>Rota por ruas (Map Matching)</span>
                  {mapMatchingLoading ? <span className="text-primary">⋯</span> : null}
                </label>
                <label className="flex items-center gap-2 text-xs text-white/80">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-white/20 bg-transparent"
                    checked={logicalRouteEnabled}
                    onChange={(event) => setLogicalRouteEnabled(event.target.checked)}
                  />
                  <span>Rota lógica (estilo MyMaps)</span>
                  {logicalRouteLoading ? <span className="text-primary">⋯</span> : null}
                </label>
                <div className="flex flex-wrap items-center gap-2 text-[11px] text-white/70">
                  {mapMatchingProvider ? (
                    <span>
                      Match: <span className="font-semibold text-white">{mapMatchingProvider}</span>
                    </span>
                  ) : null}
                  {logicalRouteProvider ? (
                    <span>
                      Lógica: <span className="font-semibold text-white">{logicalRouteProvider}</span>
                    </span>
                  ) : null}
                  <span className="text-white/60">
                    Renderizando:
                    <span className="ml-1 font-semibold text-white">
                      {mapMatchingEnabled && mapMatchedPath?.length
                        ? "Map matching"
                        : logicalRouteEnabled && logicalRoutePath?.length
                          ? "Rota lógica"
                          : "Rota original"}
                    </span>
                  </span>
                </div>
                {mapMatchingNotice ? (
                  <span
                    className={`text-[11px] ${
                      mapMatchingProvider === "osrm" ? "text-emerald-200" : "text-amber-200"
                    }`}
                  >
                    {mapMatchingNotice}
                  </span>
                ) : null}
              </div>
            </div>
            <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/80">
              <span className="text-white/50">Foco</span>
              <div className="flex overflow-hidden rounded-md border border-white/10">
                {[
                  { key: "map", label: "Mapa" },
                  { key: "table", label: "Tabela" },
                  { key: "none", label: "Nenhum" },
                ].map((option) => {
                  const isActive = focusMode === option.key;
                  return (
                    <button
                      key={option.key}
                      type="button"
                      className={`px-3 py-1 text-xs font-semibold transition ${
                        isActive ? "bg-primary/20 text-white" : "text-white/80 hover:bg-white/5"
                      }`}
                      onClick={() => setFocusMode(option.key)}
                    >
                      {option.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-white/70">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-white/50">Evento atual:</span>
            <span className="rounded-full border border-white/10 bg-white/5 px-2 py-1 text-white">
              {currentEventLabel}
            </span>
            {selectedEventSummary ? (
              <span className="text-white/50">
                ({eventCursor + 1} de {selectedEventSummary.count})
              </span>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="rounded-lg border border-white/10 px-3 py-2 text-xs text-white transition hover:border-primary/40 disabled:cursor-not-allowed disabled:border-white/10 disabled:text-white/30"
              onClick={() => handleJumpToEvent(-1)}
              disabled={!totalEvents}
            >
              Evento anterior
            </button>
            <button
              type="button"
              className="rounded-lg border border-white/10 px-3 py-2 text-xs text-white transition hover:border-primary/40 disabled:cursor-not-allowed disabled:border-white/10 disabled:text-white/30"
              onClick={() => handleJumpToEvent(1)}
              disabled={!totalEvents}
            >
              Próximo evento
            </button>
          </div>
        </div>

        {routeLoading && <div className="mt-3 text-sm text-white/60">Carregando trajeto...</div>}
        {routeError && (
          <div className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">
            {routeError.message}
          </div>
        )}
        {(mapMatchingError || logicalRouteError) && (
          <div className="mt-3 space-y-1 rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-3 text-xs text-yellow-100">
            {mapMatchingError ? <div>{mapMatchingError}</div> : null}
            {logicalRouteError ? <div>{logicalRouteError}</div> : null}
          </div>
        )}

        {totalPoints ? (
          <>
            <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(260px,1fr)]">
              <ReplayMap
                points={routePoints}
                activeIndex={activeIndex}
                animatedPoint={animatedPoint}
                animatedLivePointRef={animatedLivePointRef}
                mapLayer={mapLayer}
                pathToRender={pathToRender}
                focusMode={focusMode}
                isPlaying={isPlaying}
                manualCenter={manualCenter}
                selectedVehicle={selectedVehicle}
              />
              <EventPanel
                events={eventSummaries}
                selectedType={selectedEventType}
                onSelectType={handleSelectEventType}
                totalTimeline={timelineEntries.length}
              />
            </div>

            <div className="mt-4 space-y-3">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex flex-wrap items-center gap-3 text-sm text-white/70">
                  <div>
                    <span className="text-white/50">Ponto atual:</span>
                    <span className="ml-1 text-white">{activeIndex + 1} / {Math.max(totalPoints, 1)}</span>
                  </div>
                  {activePoint?.__speed !== undefined && activePoint?.__speed !== null ? (
                    <div>
                      <span className="text-white/50">Velocidade:</span>
                      <span className="ml-1 text-white">{Math.round(activePoint.__speed)} km/h</span>
                    </div>
                  ) : null}
                  {playbackDate ? (
                    <div>
                      <span className="text-white/50">Horário:</span>
                      <span className="ml-1 text-white">{formatDateTime(playbackDate, locale)}</span>
                    </div>
                  ) : null}
                </div>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    className="rounded-lg border border-white/10 px-3 py-2 text-xs text-white hover:border-white/30"
                    onClick={() => handleSelectPoint(Math.max(0, activeIndex - 1))}
                    disabled={activeIndex <= 0}
                  >
                    Anterior
                  </button>
                  <button
                    type="button"
                    className="rounded-lg border border-white/10 px-3 py-2 text-xs text-white hover:border-white/30"
                    onClick={() => handleSelectPoint(Math.min(timelineMax, activeIndex + 1))}
                    disabled={activeIndex >= timelineMax}
                  >
                    Próximo
                  </button>
                </div>
              </div>
             
              <input
                type="range"
                min={0}
                max={REPLAY_SLIDER_RESOLUTION}
                value={sliderValue}
                onChange={(event) => handleSliderChange(Number(event.target.value))}
                disabled={!routePoints.length}
                className="w-full accent-primary"
              />
            </div>

            <div className="mt-6 space-y-3">
              <div className="rounded-lg border border-white/10 bg-white/5 p-3">
                <div className="text-sm font-semibold text-white">Linha do tempo de auditoria</div>
                <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <div className="rounded-lg border border-white/10 bg-white/5 p-3 text-sm text-white/70">
                    <div className="text-white/50">Início</div>
                    <div className="font-semibold text-white">{summary?.start ? formatDateTime(summary.start, locale) : "—"}</div>
                  </div>
                  <div className="rounded-lg border border-white/10 bg-white/5 p-3 text-sm text-white/70">
                    <div className="text-white/50">Fim</div>
                    <div className="font-semibold text-white">{summary?.end ? formatDateTime(summary.end, locale) : "—"}</div>
                  </div>
                  <div className="rounded-lg border border-white/10 bg-white/5 p-3 text-sm text-white/70">
                    <div className="text-white/50">Vel. média</div>
                    <div className="font-semibold text-white">
                      {summary?.averageSpeed !== null && summary?.averageSpeed !== undefined ? `${summary.averageSpeed} km/h` : "—"}
                    </div>
                  </div>
                  <div className="rounded-lg border border-white/10 bg-white/5 p-3 text-sm text-white/70">
                    <div className="text-white/50">Vel. máxima</div>
                    <div className="font-semibold text-white">
                      {summary?.maxSpeed !== null && summary?.maxSpeed !== undefined ? `${summary.maxSpeed} km/h` : "—"}
                    </div>
                  </div>
                </div>
              </div>

              <div className="space-y-3 rounded-lg border border-white/10 bg-white/5 p-3">
                <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                  <div className="text-sm text-white/70">{statusText}</div>
                  <div className="flex flex-wrap items-center gap-2">
                    {hasActiveFilter ? (
                      <button
                        type="button"
                        className="rounded-md border border-white/15 bg-white/10 px-3 py-2 text-xs font-semibold text-white transition hover:border-primary/50 hover:bg-primary/20"
                        onClick={handleClearFilters}
                      >
                        Limpar filtro
                      </button>
                    ) : null}
                    <div className="relative">
                      <button
                        type="button"
                        className="rounded-md border border-white/15 bg-white/10 px-3 py-2 text-xs font-semibold text-white transition hover:border-primary/50 hover:bg-primary/20"
                        onClick={() => setColumnPickerOpen((value) => !value)}
                      >
                        ⚙ Colunas
                      </button>
                      {columnPickerOpen ? (
                        <div className="absolute right-0 z-20 mt-2 w-72 rounded-lg border border-white/10 bg-slate-900/90 p-3 shadow-xl backdrop-blur">
                          <div className="flex items-center justify-between gap-2">
                            <div className="text-sm font-semibold text-white">Colunas</div>
                            <button
                              type="button"
                              className="text-xs text-white/60"
                              onClick={() => setColumnPickerOpen(false)}
                            >
                              Fechar
                            </button>
                          </div>
                          <div className="mt-2 flex items-center gap-2 text-xs text-white/80">
                            <button
                              type="button"
                              className="rounded border border-white/15 bg-white/10 px-2 py-1 font-semibold text-white transition hover:border-primary/50 hover:bg-primary/20"
                              onClick={() => applyColumnPreset("default")}
                            >
                              Padrão
                            </button>
                            <button
                              type="button"
                              className="rounded border border-white/15 bg-white/10 px-2 py-1 font-semibold text-white transition hover:border-primary/50 hover:bg-primary/20"
                              onClick={() => applyColumnPreset("all")}
                            >
                              Todas
                            </button>
                          </div>
                          <div className="mt-3 max-h-64 space-y-2 overflow-y-auto pr-1">
                            {availableColumnDefs.map((column) => {
                              const checked = selectedColumns.includes(column.key);
                              return (
                                <div
                                  key={column.key}
                                  className="flex items-center gap-2 rounded-md border border-white/10 bg-white/5 px-2 py-1"
                                >
                                  <input
                                    type="checkbox"
                                    className="h-4 w-4 rounded border-white/20 bg-transparent"
                                    checked={checked}
                                    onChange={() => handleToggleColumn(column.key)}
                                  />
                                  <span className="flex-1 text-sm text-white">{column.label}</span>
                                  {checked ? (
                                    <div className="flex items-center gap-1 text-white/60">
                                      <button
                                        type="button"
                                        className="rounded border border-white/10 px-2 py-1 text-[10px] font-semibold hover:border-primary/40"
                                        onClick={() => handleMoveColumn(column.key, -1)}
                                      >
                                        ↑
                                      </button>
                                      <button
                                        type="button"
                                        className="rounded border border-white/10 px-2 py-1 text-[10px] font-semibold hover:border-primary/40"
                                        onClick={() => handleMoveColumn(column.key, 1)}
                                      >
                                        ↓
                                      </button>
                                    </div>
                                  ) : null}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>

                <TimelineTable
                  entries={filteredTimelineEntries}
                  activeIndex={activeIndex}
                  onSelect={handleSelectPoint}
                  locale={locale}
                  columns={visibleColumns}
                  resolveAddress={resolveEntryAddress}
                  focusMode={focusMode}
                  isPlaying={isPlaying}
                />
              </div>
            </div>
          </>
        ) : (
          <div className="mt-4 rounded-lg border border-white/10 bg-white/5 p-4 text-sm text-white/60">
            Selecione um trajeto para visualizar o mapa.
          </div>
        )}
      </div>
    </div>
  );
}
