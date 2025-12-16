import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { MapContainer, Marker, Polyline, TileLayer, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

import useDevices from "../lib/hooks/useDevices";
import { useTranslation } from "../lib/i18n.js";
import useReportsRoute from "../lib/hooks/useReportsRoute";
import { useReports } from "../lib/hooks/useReports";
import { formatDateTime, pickCoordinate, pickSpeed } from "../lib/monitoring-helpers.js";
import {
  DEFAULT_MAP_LAYER_KEY,
  ENABLED_MAP_LAYERS,
  MAP_LAYER_FALLBACK,
  MAP_LAYER_SECTIONS,
  MAP_LAYER_STORAGE_KEYS,
  getValidMapLayer,
} from "../lib/mapLayers.js";

// Discovery note (Epic B): this page will receive map layer selection,
// improved replay rendering, and event navigation for trip playback.

const DEFAULT_CENTER = [-19.9167, -43.9345];
const DEFAULT_ZOOM = 12;
const DEFAULT_FROM = () => new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 16);
const DEFAULT_TO = () => new Date().toISOString().slice(0, 16);
const FALLBACK_CENTER = [-15.793889, -47.882778];
const FALLBACK_ZOOM = 5;
const REPLAY_SPEEDS = [1, 2, 4, 8];
const MAP_LAYER_STORAGE_KEY = MAP_LAYER_STORAGE_KEYS.trips;
const ANIMATION_BASE_MS = 900;
const MAX_INTERPOLATION_METERS = 120;

function toFiniteNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function clampLatitude(lat) {
  return Math.min(90, Math.max(-90, lat));
}

function clampLongitude(lng) {
  return Math.min(180, Math.max(-180, lng));
}

function isValidLatLng(lat, lng) {
  const normalizedLat = toFiniteNumber(lat);
  const normalizedLng = toFiniteNumber(lng);
  if (normalizedLat === null || normalizedLng === null) return false;
  return normalizedLat >= -90 && normalizedLat <= 90 && normalizedLng >= -180 && normalizedLng <= 180;
}

function normalizeLatLng(point) {
  if (!point) return null;
  const rawLat = point.lat ?? point.latitude;
  const rawLng = point.lng ?? point.lon ?? point.longitude;
  const lat = toFiniteNumber(rawLat);
  const lng = toFiniteNumber(rawLng);
  if (lat === null || lng === null) return null;
  return { lat: clampLatitude(lat), lng: clampLongitude(lng) };
}

function parseDate(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
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

function smoothRoute(points) {
  if (!Array.isArray(points)) return [];
  return points.map((point, index, array) => {
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

function buildVehicleIcon(bearing = 0) {
  const rotation = `transform: rotate(${bearing}deg);`;
  return L.divIcon({
    className: "replay-vehicle",
    html: `
      <div style="${rotation}width:32px;height:32px;border-radius:12px;background:rgba(34,197,94,0.18);display:flex;align-items:center;justify-content:center;border:1px solid rgba(34,197,94,0.45);box-shadow:0 10px 20px rgba(0,0,0,0.35);backdrop-filter:blur(6px);">
        <svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' width='18' height='18' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round' style='color:#34d399;'>
          <path d='M3 13l9-9 9 9-1.5 1.5L12 7.5 4.5 14.5 3 13z'/>
          <path d='M12 7.5V21' />
        </svg>
      </div>
    `,
    iconSize: [32, 32],
    iconAnchor: [16, 16],
  });
}

function normalizeTripEvent(point) {
  const rawEvent =
    point?.event ||
    point?.type ||
    point?.attributes?.event ||
    point?.attributes?.alarm ||
    point?.attributes?.status ||
    point?.__label;
  if (!rawEvent) return null;
  const type = String(rawEvent).toLowerCase();
  return {
    type,
    label: point?.__label || rawEvent,
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

function formatPointAddress(point) {
  if (typeof point?.address === "string" && point.address.trim()) return point.address.trim();
  if (typeof point?.attributes?.address === "string" && point.attributes.address.trim()) return point.attributes.address.trim();
  if (typeof point?.attributes?.formattedAddress === "string" && point.attributes.formattedAddress.trim()) {
    return point.attributes.formattedAddress.trim();
  }
  if (typeof point?.attributes?.rawAddress === "string" && point.attributes.rawAddress.trim()) {
    return point.attributes.rawAddress.trim();
  }
  return "Endereço indisponível";
}

function buildEventIcon(severity = "normal", active = false) {
  const palette = {
    critical: "#ef4444",
    high: "#ef4444",
    medium: "#f59e0b",
    low: "#10b981",
    info: "#3b82f6",
    normal: "#94a3b8",
  };
  const color = palette[severity] || palette.normal;
  const ring = active ? `box-shadow:0 0 0 6px rgba(34,197,94,0.25);` : "";
  return L.divIcon({
    className: "audit-marker",
    html: `
      <div style="${ring}display:flex;align-items:center;justify-content:center;width:18px;height:18px;border-radius:10px;background:${color};border:2px solid rgba(255,255,255,0.85);"></div>
    `,
    iconSize: [18, 18],
    iconAnchor: [9, 9],
  });
}

function validateRange({ deviceId, from, to }) {
  if (!deviceId) return "Selecione um dispositivo para gerar o relatório.";
  const fromDate = parseDate(from);
  const toDate = parseDate(to);
  if (!fromDate || !toDate) return "Informe datas válidas para início e fim.";
  if (fromDate.getTime() >= toDate.getTime()) return "A data inicial deve ser antes da final.";
  return null;
}

function ReplayMap({
  points,
  activeIndex,
  animatedPoint,
  mapLayer,
  smoothedPath,
  showPoints,
  onSelectIndex,
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
    const basePath = smoothedPath?.length ? smoothedPath : routePoints;
    return basePath.filter((point) => isValidLatLng(point.lat, point.lng)).map((point) => [point.lat, point.lng]);
  }, [routePoints, smoothedPath]);

  const activePoint = routePoints[activeIndex] || routePoints[0] || null;
  const vehicleIcon = useMemo(() => buildVehicleIcon(animatedPoint?.heading || 0), [animatedPoint?.heading]);
  const tileLayer = mapLayer || MAP_LAYER_FALLBACK;
  const resolvedSubdomains = tileLayer.subdomains ?? "abc";
  const normalizedAnimatedPoint = useMemo(() => normalizeLatLng(animatedPoint), [animatedPoint]);
  const normalizedActivePoint = useMemo(() => normalizeLatLng(activePoint), [activePoint]);
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
          maxZoom={tileLayer.maxZoom}
        />
        {positions.length ? <Polyline positions={positions} color="#22c55e" weight={5} opacity={0.7} /> : null}
        {showPoints
          ? routePoints.map((point) => (
              <Marker
                key={`${point.lat}-${point.lng}-${point.index}`}
                position={[point.lat, point.lng]}
                icon={buildEventIcon(point.__severity, point.index === activeIndex)}
                eventHandlers={{ click: () => onSelectIndex?.(point.index) }}
              />
            ))
          : null}
        {animatedPoint ? <Marker position={[animatedPoint.lat, animatedPoint.lng]} icon={vehicleIcon} /> : null}
        <MapFocus point={activePoint} />
        <MapResizeHandler />
      </MapContainer>
    </div>
  );
}

function MapFocus({ point }) {
  const map = useMap();
  const lastViewRef = useRef(null);
  useEffect(() => {
    if (!map) return;

    const normalized = normalizeLatLng(point);
    const target = normalized ? [normalized.lat, normalized.lng] : FALLBACK_CENTER;
    const zoom = normalized ? DEFAULT_ZOOM : FALLBACK_ZOOM;
    const key = `${target[0]},${target[1]},${zoom}`;

    if (lastViewRef.current === key) return;

    lastViewRef.current = key;
    map.setView(target, zoom, { animate: Boolean(normalized) });
  }, [map, point]);
  return null;
}

function MapResizeHandler() {
  const map = useMap();
  const timeoutRef = useRef(null);

  useEffect(() => {
    timeoutRef.current = setTimeout(() => map.invalidateSize(), 200);
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [map]);

  useEffect(() => {
    const handleResize = () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => map.invalidateSize(), 200);
    };

    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [map]);

  return null;
}

function EventPanel({ events = [], selectedType, onSelectType, totalOccurrences }) {
  const hasEvents = events.length > 0;
  const totalCount = Number(totalOccurrences) || 0;

  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-3">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold text-white">Eventos do trajeto</div>
        <div className="text-xs text-white/60">{totalCount} ocorrência(s)</div>
      </div>

      {hasEvents ? (
        <div className="mt-2 max-h-[360px] space-y-2 overflow-y-auto pr-1">
          {events.map((event) => {
            const isActive = event.type === selectedType;
            return (
              <button
                key={event.type}
                type="button"
                onClick={() => onSelectType?.(event.type)}
                className={`w-full rounded-lg border px-3 py-2 text-left text-sm transition ${
                  isActive
                    ? "border-primary/60 bg-primary/10 text-white"
                    : "border-white/10 bg-white/5 text-white/80 hover:border-primary/40"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex flex-col">
                    <span className="font-semibold">{event.label}</span>
                    <span className="text-[11px] text-white/60">Clique para navegar pelas ocorrências</span>
                  </div>
                  <span
                    className={`rounded-full border px-3 py-1 text-xs font-semibold ${
                      isActive ? "border-primary/60 bg-primary/20 text-white" : "border-white/10 bg-white/10 text-white/80"
                    }`}
                  >
                    {event.count}
                  </span>
                </div>
              </button>
            );
          })}
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
  const { locale } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const { devices: rawDevices } = useDevices();
  const devices = useMemo(() => (Array.isArray(rawDevices) ? rawDevices : []), [rawDevices]);
  const { data, loading, error, generateTripsReport, downloadTripsCsv } = useReports();
  const {
    data: routeData,
    loading: routeLoading,
    error: routeError,
    generate: generateRoute,
  } = useReportsRoute();

  const [deviceId, setDeviceId] = useState("");
  const [from, setFrom] = useState(DEFAULT_FROM);
  const [to, setTo] = useState(DEFAULT_TO);
  const [formError, setFormError] = useState("");
  const [feedback, setFeedback] = useState(null);
  const [downloading, setDownloading] = useState(false);
  const [selectedTrip, setSelectedTrip] = useState(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [mapLayerKey, setMapLayerKey] = useState(DEFAULT_MAP_LAYER_KEY);
  const [showPoints, setShowPoints] = useState(false);
  const [selectedEventType, setSelectedEventType] = useState(null);
  const [eventCursor, setEventCursor] = useState(0);
  const [animatedPoint, setAnimatedPoint] = useState(null);
  const animationRef = useRef(null);

  const trips = useMemo(
    () => (Array.isArray(data?.trips) ? data.trips : Array.isArray(data) ? data : []),
    [data],
  );

  const routePoints = useMemo(() => {
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
        return {
          ...point,
          lat,
          lng,
          __time: time,
          __severity: normalizeSeverityFromPoint(point),
          __address: formatPointAddress(point),
          __speed: pickSpeed(point),
          __label:
            point.event ||
            point.type ||
            point.attributes?.event ||
            point.attributes?.alarm ||
            point.attributes?.status ||
            "Posição registrada",
          __index: index,
        };
      })
      .filter((point) => point.__time || (Number.isFinite(point.lat) && Number.isFinite(point.lng)));

    const sorted = normalized.sort((a, b) => {
      const aTime = a.__time ? a.__time.getTime() : 0;
      const bTime = b.__time ? b.__time.getTime() : 0;
      if (aTime === bTime) return a.__index - b.__index;
      return aTime - bTime;
    });

    return sorted.map((point, index) => ({ ...point, index }));
  }, [routeData]);

  const activePoint = useMemo(() => routePoints[activeIndex] || routePoints[0] || null, [activeIndex, routePoints]);
  const smoothedRoute = useMemo(() => smoothRoute(routePoints), [routePoints]);
  const smoothedPath = useMemo(() => densifyPath(smoothedRoute), [smoothedRoute]);
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
        severity: point.__severity,
        address: point.__address,
        speed: point.__speed,
      })),
    [routePoints],
  );

  const tripEvents = useMemo(
    () =>
      routePoints
        .map((point, index) => {
          const normalized = normalizeTripEvent(point);
          if (!normalized) return null;
          return { index, ...normalized, time: point.__time, lat: point.lat, lng: point.lng };
        })
        .filter(Boolean),
    [routePoints],
  );

  const eventSummaries = useMemo(() => {
    const accumulator = new Map();
    const normalizeLabel = (value) => {
      if (typeof value === "string") return value;
      if (value === null || value === undefined) return "";
      return String(value);
    };

    tripEvents.forEach((event) => {
      if (!accumulator.has(event.type)) {
        accumulator.set(event.type, { type: event.type, label: normalizeLabel(event.label ?? event.type), occurrences: [] });
      }
      const current = accumulator.get(event.type);
      current.label = normalizeLabel(event.label ?? current.label);
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

  const activeEvent = useMemo(() => tripEvents.find((event) => event.index === activeIndex) || null, [activeIndex, tripEvents]);
  const selectedEventSummary = useMemo(
    () => eventSummaries.find((item) => item.type === selectedEventType) || null,
    [eventSummaries, selectedEventType],
  );
  const totalEvents = tripEvents.length;
  const currentEventLabel = selectedEventSummary?.label || activeEvent?.label || "Nenhum evento";

  useEffect(() => {
    const search = new URLSearchParams(location.search || "");
    const queryDevice = search.get("deviceId") || search.get("device");
    const queryFrom = search.get("from");
    const queryTo = search.get("to");

    if (queryDevice) setDeviceId(queryDevice);
    if (queryFrom) setFrom(asLocalInput(queryFrom, DEFAULT_FROM));
    if (queryTo) setTo(asLocalInput(queryTo, DEFAULT_TO));

    if (queryDevice && queryFrom && queryTo && !trips.length) {
      handleGenerate(queryDevice, queryFrom, queryTo);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.search]);

  useEffect(() => {
    setActiveIndex(0);
    setIsPlaying(false);
    setSelectedEventType(null);
    setEventCursor(0);
  }, [routePoints]);

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

  useEffect(() => {
    setAnimatedPoint(smoothedRoute[0] || null);
  }, [smoothedRoute]);

  useEffect(() => {
    const target = smoothedRoute[activeIndex] || smoothedRoute[0];
    if (!target) return undefined;

    const startPoint = animatedPoint || target;
    const heading = computeHeading(startPoint, target);
    const start = performance.now();
    const duration = Math.max(320, ANIMATION_BASE_MS / speed);

    if (animationRef.current) {
      cancelAnimationFrame(animationRef.current);
    }

    const tick = (now) => {
      const progress = Math.min((now - start) / duration, 1);
      setAnimatedPoint({
        lat: lerp(startPoint.lat, target.lat, progress),
        lng: lerp(startPoint.lng, target.lng, progress),
        heading,
      });

      if (progress < 1) {
        animationRef.current = requestAnimationFrame(tick);
      }
    };

    animationRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animationRef.current);
  }, [activeIndex, smoothedRoute, speed]);

  useEffect(() => {
    if (!isPlaying || totalPoints <= 1) return undefined;
    const interval = setInterval(() => {
      setActiveIndex((current) => {
        const next = Math.min(current + 1, totalPoints - 1);
        if (next === totalPoints - 1) {
          setIsPlaying(false);
        }
        return next;
      });
    }, 800 / speed);
    return () => clearInterval(interval);
  }, [isPlaying, totalPoints, speed]);

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
          from: new Date(rangeFrom).toISOString(),
          to: new Date(rangeTo).toISOString(),
        });
        const nextTrip = Array.isArray(response?.trips) ? response.trips[0] : null;
        if (nextTrip) {
          setSelectedTrip(nextTrip);
          await loadRouteForTrip(nextTrip);
        }
        navigate(
          `/trips?deviceId=${encodeURIComponent(device)}&from=${encodeURIComponent(rangeFrom)}&to=${encodeURIComponent(rangeTo)}`,
          { replace: true },
        );
        setFeedback({ type: "success", message: "Relatório gerado com sucesso." });
      } catch (requestError) {
        setFeedback({ type: "error", message: requestError?.message || "Erro ao gerar relatório." });
      }
    },
    [deviceId, from, to, generateTripsReport, navigate, loadRouteForTrip],
  );

  const handleSubmit = useCallback(
    (event) => {
      event.preventDefault();
      void handleGenerate();
    },
    [handleGenerate],
  );

  const handleDownload = useCallback(async () => {
    const validation = validateRange({ deviceId, from, to });
    if (validation) {
      setFormError(validation);
      return;
    }
    setFormError("");
    setDownloading(true);
    try {
      await downloadTripsCsv({ deviceId, from: new Date(from).toISOString(), to: new Date(to).toISOString() });
      setFeedback({ type: "success", message: "Exportação iniciada." });
    } catch (requestError) {
      setFeedback({ type: "error", message: requestError?.message || "Erro ao exportar CSV." });
    } finally {
      setDownloading(false);
    }
  }, [deviceId, from, to, downloadTripsCsv]);

  const handleSelectTrip = useCallback(
    async (trip) => {
      setSelectedTrip(trip);
      setActiveIndex(0);
      setIsPlaying(false);
      await loadRouteForTrip(trip);
    },
    [loadRouteForTrip],
  );

  const handleSelectPoint = useCallback((nextIndex) => {
    setIsPlaying(false);
    setActiveIndex(nextIndex);
  }, []);

  const handleMapLayerChange = useCallback((nextKey) => {
    setMapLayerKey(getValidMapLayer(nextKey));
  }, []);

  const handleSelectEventType = useCallback(
    (eventType) => {
      const summary = eventSummaries.find((item) => item.type === eventType);
      if (!summary) return;
      const nextCursor = selectedEventType === eventType ? (eventCursor + 1) % summary.occurrences.length : 0;
      setSelectedEventType(eventType);
      setEventCursor(nextCursor);
      handleSelectPoint(summary.occurrences[nextCursor]);
    },
    [eventCursor, eventSummaries, handleSelectPoint, selectedEventType],
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
      handleSelectPoint(target.index);
    },
    [activeIndex, handleSelectPoint, selectedEventType, tripEvents],
  );

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold text-white">Trajetos</h1>
        <p className="text-sm text-white/60">Gere e acompanhe relatórios de viagens dos dispositivos.</p>
      </div>

      <form
        onSubmit={handleSubmit}
        className="grid gap-4 rounded-2xl border border-white/10 bg-white/5 p-4 sm:grid-cols-2 lg:grid-cols-4"
      >
        <label className="space-y-1 text-sm text-white/80">
          <span className="text-white/60">Dispositivo</span>
          <select
            value={deviceId}
            onChange={(event) => setDeviceId(event.target.value)}
            className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-white focus:border-primary/40 focus:outline-none"
          >
            <option value="">Selecione um dispositivo</option>
            {devices.map((device) => (
              <option key={device.id ?? device.uniqueId} value={device.id ?? device.uniqueId}>
                {device.name || device.vehicle || device.uniqueId}
              </option>
            ))}
          </select>
        </label>

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
                    <td className="py-2 pr-4 text-white/70">{trip.startShortAddress || trip.startAddress || "—"}</td>
                    <td className="py-2 pr-4 text-white/70">{trip.endShortAddress || trip.endAddress || "—"}</td>
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
              onClick={() => setIsPlaying((value) => !value)}
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
            <label className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/80">
              <input
                type="checkbox"
                className="h-4 w-4 accent-primary"
                checked={showPoints}
                onChange={(event) => setShowPoints(event.target.checked)}
              />
              <span className="text-white/70">Mostrar pontos</span>
            </label>
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

        {totalPoints ? (
          <>
            <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(260px,1fr)]">
              <ReplayMap
                points={routePoints}
                activeIndex={activeIndex}
                animatedPoint={animatedPoint}
                mapLayer={mapLayer}
                smoothedPath={smoothedPath}
                showPoints={showPoints}
                onSelectIndex={handleSelectPoint}
              />
              <EventPanel
                events={eventSummaries}
                selectedType={selectedEventType}
                onSelectType={handleSelectEventType}
                totalOccurrences={totalEvents}
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
                  {activePoint?.__time ? (
                    <div>
                      <span className="text-white/50">Horário:</span>
                      <span className="ml-1 text-white">{formatDateTime(activePoint.__time, locale)}</span>
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
                max={timelineMax}
                value={Math.min(activeIndex, timelineMax)}
                onChange={(event) => handleSelectPoint(Number(event.target.value))}
                className="w-full accent-primary"
              />
            </div>

            <div className="mt-6 grid gap-4 lg:grid-cols-3">
              <div className="lg:col-span-2 rounded-lg border border-white/10 bg-white/5 p-3">
                <div className="mb-3 flex items-center justify-between">
                  <div className="text-sm font-semibold text-white">Linha do tempo de auditoria</div>
                  <div className="text-xs text-white/60">{timelineEntries.length} registros</div>
                </div>
                <div className="max-h-96 space-y-2 overflow-y-auto pr-1">
                  {timelineEntries.length === 0 ? (
                    <div className="rounded-md border border-white/10 bg-white/5 p-3 text-sm text-white/60">
                      Nenhum ponto carregado para este trajeto.
                    </div>
                  ) : (
                    timelineEntries.map((entry) => (
                      <TimelineItem
                        key={`${entry.index}-${entry.time?.toISOString?.() ?? entry.index}`}
                        entry={entry}
                        active={entry.index === activeIndex}
                        onSelect={handleSelectPoint}
                        locale={locale}
                      />
                    ))
                  )}
                </div>
              </div>
              {summary ? (
                <div className="space-y-3">
                  <div className="rounded-lg border border-white/10 bg-white/5 p-3 text-sm text-white/70">
                    <div className="text-white/50">Início</div>
                    <div className="font-semibold text-white">{summary.start ? formatDateTime(summary.start, locale) : "—"}</div>
                  </div>
                  <div className="rounded-lg border border-white/10 bg-white/5 p-3 text-sm text-white/70">
                    <div className="text-white/50">Fim</div>
                    <div className="font-semibold text-white">{summary.end ? formatDateTime(summary.end, locale) : "—"}</div>
                  </div>
                  <div className="rounded-lg border border-white/10 bg-white/5 p-3 text-sm text-white/70">
                    <div className="text-white/50">Vel. média</div>
                    <div className="font-semibold text-white">{summary.averageSpeed !== null ? `${summary.averageSpeed} km/h` : "—"}</div>
                  </div>
                  <div className="rounded-lg border border-white/10 bg-white/5 p-3 text-sm text-white/70">
                    <div className="text-white/50">Vel. máxima</div>
                    <div className="font-semibold text-white">{summary.maxSpeed !== null ? `${summary.maxSpeed} km/h` : "—"}</div>
                  </div>
                </div>
              ) : null}
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

function TimelineItem({ entry, active, onSelect, locale }) {
  return (
    <button
      type="button"
      onClick={() => onSelect?.(entry.index)}
      className={`w-full rounded-lg border px-3 py-2 text-left text-sm transition ${
        active
          ? "border-primary/60 bg-primary/10 text-white"
          : "border-white/10 bg-white/5 text-white/80 hover:border-primary/40"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="text-xs text-white/60">{entry.time ? formatDateTime(entry.time, locale) : "Horário indisponível"}</div>
          <div className="font-semibold text-white">{entry.label}</div>
          <div className="text-xs text-white/60">{entry.address}</div>
        </div>
        <div className="flex flex-col items-end gap-1 text-xs text-white/60">
          <SeverityPill severity={entry.severity} />
          <div className="rounded bg-white/10 px-2 py-1 text-[11px] text-white/70">
            Vel.: {entry.speed !== undefined && entry.speed !== null ? `${Math.round(entry.speed)} km/h` : "—"}
          </div>
        </div>
      </div>
    </button>
  );
}

function SeverityPill({ severity }) {
  const palette = {
    critical: "bg-red-500/20 text-red-200 border-red-500/40",
    high: "bg-red-500/20 text-red-200 border-red-500/40",
    medium: "bg-yellow-500/20 text-yellow-200 border-yellow-500/40",
    low: "bg-green-500/20 text-green-200 border-green-500/40",
    info: "bg-blue-500/20 text-blue-200 border-blue-500/40",
    normal: "bg-white/10 text-white/70 border-white/20",
  };

  const label =
    severity === "critical"
      ? "Crítico"
      : severity === "high"
        ? "Alto"
        : severity === "medium"
          ? "Médio"
          : severity === "low"
            ? "Baixo"
            : "Info";

  return <span className={`rounded-full border px-3 py-1 text-[11px] font-semibold ${palette[severity] ?? palette.normal}`}>{label}</span>;
}
