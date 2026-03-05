import { loadCollection, saveCollection } from "./storage.js";
import { listDeployments } from "../models/xdm-deployment.js";
import { getItineraryById } from "../models/itinerary.js";
import { getRouteById } from "../models/route.js";

const STATE_STORAGE_KEY = "itinerary-direction-state";
const EVENT_STORAGE_KEY = "itinerary-direction-events";

const MAX_STORED_EVENTS = Number(process.env.ITINERARY_REVERSE_MAX_EVENTS) || 5000;
const SAMPLE_TTL_MS = Number(process.env.ITINERARY_REVERSE_SAMPLE_TTL_MS) || 15 * 60 * 1000;
const STATE_TTL_MS = Number(process.env.ITINERARY_REVERSE_STATE_TTL_MS) || 24 * 60 * 60 * 1000;
const MIN_POINTS = Number(process.env.ITINERARY_REVERSE_MIN_POINTS) || 6;
const MIN_WINDOW_MS = Number(process.env.ITINERARY_REVERSE_MIN_WINDOW_MS) || 2 * 60 * 1000;
const MIN_MOVEMENT_METERS = Number(process.env.ITINERARY_REVERSE_MIN_MOVEMENT_METERS) || 400;
const REVERSE_RATIO_THRESHOLD = Number(process.env.ITINERARY_REVERSE_RATIO) || 0.7;
const EVENT_COOLDOWN_MS = Number(process.env.ITINERARY_REVERSE_COOLDOWN_MS) || 10 * 60 * 1000;
const DEFAULT_BUFFER_METERS = Number(process.env.XDM_ROUTE_BUFFER_METERS) || 200;
const BUFFER_EXTRA_GRACE_METERS = Number(process.env.ITINERARY_REVERSE_BUFFER_GRACE_METERS) || 120;
const CONTEXT_CACHE_TTL_MS = Number(process.env.ITINERARY_REVERSE_CONTEXT_CACHE_MS) || 60 * 1000;

const FAILED_DEPLOYMENT_STATUSES = new Set([
  "FAILED",
  "TIMEOUT",
  "ERROR",
  "INVALID",
  "REJECTED",
  "CANCELED",
  "CANCELLED",
  "FINISHED",
]);
const ACTIVE_DISPATCH_STATUSES = new Set([
  "SYNCING",
  "DEPLOYING",
  "QUEUED",
  "STARTED",
  "RUNNING",
  "DEPLOYED",
  "CONFIRMED",
]);

const persistedStates = loadCollection(STATE_STORAGE_KEY, []);
const persistedEvents = loadCollection(EVENT_STORAGE_KEY, []);

const stateByKey = new Map(
  (Array.isArray(persistedStates) ? persistedStates : [])
    .map((entry) => {
      const key = buildStateKey(entry?.clientId, entry?.vehicleId, entry?.deviceId);
      return key ? [key, entry] : null;
    })
    .filter(Boolean),
);

let itineraryDirectionEvents = Array.isArray(persistedEvents) ? persistedEvents : [];
const contextCache = new Map();

function normalizeId(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text || null;
}

function buildStateKey(clientId, vehicleId, deviceId) {
  const c = normalizeId(clientId);
  const v = normalizeId(vehicleId);
  const d = normalizeId(deviceId);
  if (!c || !v || !d) return null;
  return `${c}:${v}:${d}`;
}

function parseTimestamp(value) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return null;
  return new Date(parsed);
}

function resolveEventTime(position) {
  return (
    parseTimestamp(position?.fixTime) ||
    parseTimestamp(position?.deviceTime) ||
    parseTimestamp(position?.serverTime) ||
    parseTimestamp(position?.timestamp) ||
    new Date()
  );
}

function normalizeRoutePoints(points = []) {
  return (Array.isArray(points) ? points : [])
    .map((point) => {
      const lat = Number(Array.isArray(point) ? point[0] : point?.lat ?? point?.latitude);
      const lng = Number(Array.isArray(point) ? point[1] : point?.lng ?? point?.lon ?? point?.longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
      return [lat, lng];
    })
    .filter(Boolean);
}

function computeMetersPerLon(referenceLat) {
  return 111320 * Math.cos((referenceLat * Math.PI) / 180);
}

function toMeters(point, referenceLat) {
  const lat = Number(point?.[0]);
  const lng = Number(point?.[1]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const metersPerLon = computeMetersPerLon(referenceLat);
  if (!Number.isFinite(metersPerLon) || metersPerLon === 0) return null;
  return { x: lng * metersPerLon, y: lat * 111320 };
}

function buildRouteProjectionContext(routePoints = []) {
  const points = normalizeRoutePoints(routePoints);
  if (points.length < 2) return null;
  const referenceLat = Number(points[0][0]);
  if (!Number.isFinite(referenceLat)) return null;
  const projected = points.map((point) => toMeters(point, referenceLat)).filter(Boolean);
  if (projected.length < 2) return null;

  const segments = [];
  let cumulative = 0;
  for (let index = 0; index < projected.length - 1; index += 1) {
    const start = projected[index];
    const end = projected[index + 1];
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const length = Math.hypot(dx, dy);
    if (!Number.isFinite(length) || length <= 0) continue;
    segments.push({
      start,
      end,
      dx,
      dy,
      length,
      cumulativeStart: cumulative,
    });
    cumulative += length;
  }

  if (!segments.length || cumulative <= 0) return null;
  return {
    referenceLat,
    segments,
    totalLengthMeters: cumulative,
    routePoints: points,
  };
}

function projectProgressMeters(point, projectionContext) {
  if (!point || !projectionContext) return null;
  const projectedPoint = toMeters(point, projectionContext.referenceLat);
  if (!projectedPoint) return null;

  let best = null;
  for (const segment of projectionContext.segments) {
    const relX = projectedPoint.x - segment.start.x;
    const relY = projectedPoint.y - segment.start.y;
    const dot = relX * segment.dx + relY * segment.dy;
    const denom = segment.dx * segment.dx + segment.dy * segment.dy;
    const ratio = denom > 0 ? Math.max(0, Math.min(1, dot / denom)) : 0;
    const closestX = segment.start.x + segment.dx * ratio;
    const closestY = segment.start.y + segment.dy * ratio;
    const distanceMeters = Math.hypot(projectedPoint.x - closestX, projectedPoint.y - closestY);
    const progressMeters = segment.cumulativeStart + segment.length * ratio;

    if (!best || distanceMeters < best.distanceMeters) {
      best = { progressMeters, distanceMeters };
    }
  }

  return best;
}

function resolveBufferMeters(route) {
  const metadata = route?.metadata && typeof route.metadata === "object" ? route.metadata : {};
  const candidate = Number(
    metadata.xdmBufferMeters ??
      metadata.bufferMeters ??
      metadata.routeBufferMeters ??
      metadata.toleranceMeters ??
      route?.bufferMeters,
  );
  if (Number.isFinite(candidate) && candidate > 0) return candidate;
  return DEFAULT_BUFFER_METERS;
}

function persistStates() {
  saveCollection(STATE_STORAGE_KEY, Array.from(stateByKey.values()));
}

function persistEvents() {
  saveCollection(EVENT_STORAGE_KEY, itineraryDirectionEvents);
}

function trimStates(now = Date.now()) {
  let changed = false;
  for (const [key, entry] of stateByKey.entries()) {
    const lastUpdate = Date.parse(entry?.updatedAt || 0);
    if (!Number.isFinite(lastUpdate) || now - lastUpdate > STATE_TTL_MS) {
      stateByKey.delete(key);
      changed = true;
    }
  }
  if (changed) persistStates();
}

function buildRouteSignature(routePoints = [], itineraryId, routeId) {
  const first = routePoints[0];
  const last = routePoints[routePoints.length - 1];
  return [
    itineraryId || "none",
    routeId || "none",
    routePoints.length,
    first ? `${first[0].toFixed(5)}:${first[1].toFixed(5)}` : "na",
    last ? `${last[0].toFixed(5)}:${last[1].toFixed(5)}` : "na",
  ].join("|");
}

function getContextCacheKey(clientId, vehicleId) {
  return `${normalizeId(clientId) || "na"}:${normalizeId(vehicleId) || "na"}`;
}

function resolveLatestEmbarkDeployment(clientId, vehicleId) {
  const deployments = listDeployments({ clientId })
    .filter((item) => String(item?.vehicleId || "") === String(vehicleId))
    .sort((a, b) => Date.parse(b?.startedAt || 0) - Date.parse(a?.startedAt || 0));

  if (!deployments.length) return null;
  const latest = deployments[0];
  const latestAction = String(latest?.action || "").toUpperCase();
  if (latestAction === "DISEMBARK") {
    return null;
  }

  return deployments.find((item) => {
    const action = String(item?.action || "EMBARK").toUpperCase();
    const status = String(item?.status || "").toUpperCase();
    if (action !== "EMBARK") return false;
    if (FAILED_DEPLOYMENT_STATUSES.has(status)) return false;
    return ACTIVE_DISPATCH_STATUSES.has(status) || !status;
  }) || null;
}

function resolveItineraryRouteContext(clientId, vehicleId) {
  const cacheKey = getContextCacheKey(clientId, vehicleId);
  const now = Date.now();
  const cached = contextCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    return cached.value;
  }

  const deployment = resolveLatestEmbarkDeployment(clientId, vehicleId);
  if (!deployment?.itineraryId) {
    contextCache.set(cacheKey, { expiresAt: now + CONTEXT_CACHE_TTL_MS, value: null });
    return null;
  }
  const itinerary = getItineraryById(deployment.itineraryId);
  const routeItem = Array.isArray(itinerary?.items)
    ? itinerary.items.find((item) => String(item?.type || "").toLowerCase() === "route")
    : null;
  if (!routeItem?.id) {
    contextCache.set(cacheKey, { expiresAt: now + CONTEXT_CACHE_TTL_MS, value: null });
    return null;
  }

  const route = getRouteById(routeItem.id);
  const routePoints = normalizeRoutePoints(route?.points || []);
  const projectionContext = buildRouteProjectionContext(routePoints);
  if (!projectionContext) {
    contextCache.set(cacheKey, { expiresAt: now + CONTEXT_CACHE_TTL_MS, value: null });
    return null;
  }

  const value = {
    itineraryId: String(itinerary?.id || deployment.itineraryId),
    itineraryName: itinerary?.name || deployment?.snapshot?.itinerary?.name || "Itinerário",
    routeId: String(route?.id || routeItem.id),
    routeName: route?.name || routeItem?.name || "Rota",
    routePoints,
    projectionContext,
    toleranceMeters: resolveBufferMeters(route),
  };
  contextCache.set(cacheKey, { expiresAt: now + CONTEXT_CACHE_TTL_MS, value });
  return value;
}

function appendSample(entry, sample) {
  const base = Array.isArray(entry?.samples) ? [...entry.samples] : [];
  base.push(sample);
  const minAt = sample.at - SAMPLE_TTL_MS;
  const filtered = base.filter((item) => Number(item?.at) >= minAt);
  return filtered.slice(-40);
}

function analyseDirection(samples = []) {
  if (!Array.isArray(samples) || samples.length < 2) {
    return {
      sampleCount: Array.isArray(samples) ? samples.length : 0,
      elapsedMs: 0,
      totalMovementMeters: 0,
      reverseMovementMeters: 0,
      reverseRatio: 0,
      netDeltaMeters: 0,
      predominantReverse: false,
    };
  }

  const ordered = [...samples].sort((a, b) => Number(a.at) - Number(b.at));
  let totalMovementMeters = 0;
  let reverseMovementMeters = 0;
  for (let index = 1; index < ordered.length; index += 1) {
    const delta = Number(ordered[index].progressMeters) - Number(ordered[index - 1].progressMeters);
    if (!Number.isFinite(delta)) continue;
    totalMovementMeters += Math.abs(delta);
    if (delta < 0) reverseMovementMeters += Math.abs(delta);
  }

  const first = ordered[0];
  const last = ordered[ordered.length - 1];
  const elapsedMs = Math.max(0, Number(last.at) - Number(first.at));
  const netDeltaMeters = Number(last.progressMeters) - Number(first.progressMeters);
  const reverseRatio = totalMovementMeters > 0 ? reverseMovementMeters / totalMovementMeters : 0;
  const predominantReverse =
    netDeltaMeters < 0 &&
    totalMovementMeters >= MIN_MOVEMENT_METERS &&
    reverseRatio >= REVERSE_RATIO_THRESHOLD;

  return {
    sampleCount: ordered.length,
    elapsedMs,
    totalMovementMeters,
    reverseMovementMeters,
    reverseRatio,
    netDeltaMeters,
    predominantReverse,
  };
}

function formatEventPosition(position) {
  const latitude = Number(position?.latitude ?? position?.lat);
  const longitude = Number(position?.longitude ?? position?.lng);
  return {
    latitude: Number.isFinite(latitude) ? latitude : null,
    longitude: Number.isFinite(longitude) ? longitude : null,
  };
}

function buildItineraryReverseEvent({
  clientId,
  vehicleId,
  deviceId,
  position,
  context,
  analysis,
}) {
  const now = resolveEventTime(position);
  const eventTimeIso = now.toISOString();
  const { latitude, longitude } = formatEventPosition(position);

  return {
    id: `itinerary-reverse:${normalizeId(deviceId) || "device"}:${now.getTime()}`,
    eventId: "ITINERARIO_INVERTIDO",
    type: "itineraryReverse",
    eventType: "itineraryReverse",
    eventLabel: "Itinerário invertido",
    eventSeverity: "critical",
    eventCategory: "Segurança",
    eventRequiresHandling: true,
    eventActive: true,
    source: "itinerary-direction",
    synthetic: true,
    eventTime: eventTimeIso,
    serverTime: new Date().toISOString(),
    clientId: normalizeId(clientId),
    vehicleId: normalizeId(vehicleId),
    deviceId: normalizeId(deviceId),
    latitude,
    longitude,
    address: position?.address || position?.shortAddress || null,
    protocol: position?.protocol || position?.attributes?.protocol || null,
    attributes: {
      itineraryId: context.itineraryId,
      itineraryName: context.itineraryName,
      routeId: context.routeId,
      routeName: context.routeName,
      toleranceMeters: context.toleranceMeters,
      sampleCount: analysis.sampleCount,
      elapsedMs: analysis.elapsedMs,
      totalMovementMeters: Math.round(analysis.totalMovementMeters),
      reverseMovementMeters: Math.round(analysis.reverseMovementMeters),
      reverseRatio: Number(analysis.reverseRatio.toFixed(3)),
      netDeltaMeters: Math.round(analysis.netDeltaMeters),
    },
    normalizedEvent: {
      title: "Itinerário invertido",
      label: "Itinerário invertido",
      severity: "Crítica",
      category: "Segurança",
      requiresHandling: true,
      typeKey: "itineraryReverse",
      eventId: "ITINERARIO_INVERTIDO",
    },
  };
}

export function listItineraryDirectionEvents({
  clientId,
  deviceIds = [],
  from,
  to,
} = {}) {
  const normalizedClientId = normalizeId(clientId);
  const deviceSet = new Set((Array.isArray(deviceIds) ? deviceIds : []).map((id) => String(id)));
  const fromDate = parseTimestamp(from);
  const toDate = parseTimestamp(to);

  return (Array.isArray(itineraryDirectionEvents) ? itineraryDirectionEvents : []).filter((event) => {
    if (normalizedClientId && String(event?.clientId || "") !== normalizedClientId) return false;
    if (deviceSet.size && !deviceSet.has(String(event?.deviceId || ""))) return false;
    if (fromDate || toDate) {
      const eventDate = parseTimestamp(event?.eventTime || event?.serverTime);
      if (!eventDate) return false;
      if (fromDate && eventDate < fromDate) return false;
      if (toDate && eventDate > toDate) return false;
    }
    return true;
  });
}

export function appendItineraryDirectionEvent(event) {
  if (!event || !event.id) return null;
  itineraryDirectionEvents = [event, ...itineraryDirectionEvents].slice(0, MAX_STORED_EVENTS);
  persistEvents();
  return event;
}

export function ingestItineraryDirectionEvents({
  clientId,
  vehicleId,
  deviceId,
  position,
} = {}) {
  const normalizedClientId = normalizeId(clientId);
  const normalizedVehicleId = normalizeId(vehicleId);
  const normalizedDeviceId = normalizeId(deviceId);
  if (!normalizedClientId || !normalizedVehicleId || !normalizedDeviceId) return [];

  const latitude = Number(position?.latitude ?? position?.lat);
  const longitude = Number(position?.longitude ?? position?.lng);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return [];

  trimStates();
  const context = resolveItineraryRouteContext(normalizedClientId, normalizedVehicleId);
  if (!context?.projectionContext) return [];

  const progress = projectProgressMeters([latitude, longitude], context.projectionContext);
  if (!progress) return [];

  const routeSignature = buildRouteSignature(context.routePoints, context.itineraryId, context.routeId);
  const stateKey = buildStateKey(normalizedClientId, normalizedVehicleId, normalizedDeviceId);
  if (!stateKey) return [];
  const now = resolveEventTime(position);
  const nowMs = now.getTime();
  const routeTolerance = Math.max(0, Number(context.toleranceMeters || DEFAULT_BUFFER_METERS)) + BUFFER_EXTRA_GRACE_METERS;

  const previous = stateByKey.get(stateKey);
  const baseState =
    previous && previous.routeSignature === routeSignature
      ? previous
      : {
          clientId: normalizedClientId,
          vehicleId: normalizedVehicleId,
          deviceId: normalizedDeviceId,
          itineraryId: context.itineraryId,
          routeId: context.routeId,
          routeSignature,
          samples: [],
          lastEventAt: null,
          updatedAt: now.toISOString(),
        };

  if (progress.distanceMeters > routeTolerance) {
    const resetState = {
      ...baseState,
      samples: [],
      updatedAt: now.toISOString(),
    };
    stateByKey.set(stateKey, resetState);
    persistStates();
    return [];
  }

  const nextSamples = appendSample(baseState, {
    at: nowMs,
    progressMeters: progress.progressMeters,
    distanceMeters: progress.distanceMeters,
  });
  const nextState = {
    ...baseState,
    samples: nextSamples,
    updatedAt: now.toISOString(),
  };

  const analysis = analyseDirection(nextSamples);
  if (
    analysis.sampleCount >= MIN_POINTS &&
    analysis.elapsedMs >= MIN_WINDOW_MS &&
    analysis.totalMovementMeters >= MIN_MOVEMENT_METERS &&
    analysis.predominantReverse
  ) {
    const lastEventAt = Date.parse(nextState.lastEventAt || 0);
    if (!Number.isFinite(lastEventAt) || nowMs - lastEventAt >= EVENT_COOLDOWN_MS) {
      const event = buildItineraryReverseEvent({
        clientId: normalizedClientId,
        vehicleId: normalizedVehicleId,
        deviceId: normalizedDeviceId,
        position,
        context,
        analysis,
      });
      appendItineraryDirectionEvent(event);
      nextState.lastEventAt = now.toISOString();
      nextState.samples = nextSamples.slice(-Math.max(3, Math.floor(MIN_POINTS / 2)));
      stateByKey.set(stateKey, nextState);
      persistStates();
      return [event];
    }
  }

  stateByKey.set(stateKey, nextState);
  persistStates();
  return [];
}

export function __resetItineraryDirectionForTests() {
  stateByKey.clear();
  itineraryDirectionEvents = [];
  contextCache.clear();
  saveCollection(STATE_STORAGE_KEY, []);
  saveCollection(EVENT_STORAGE_KEY, []);
}

