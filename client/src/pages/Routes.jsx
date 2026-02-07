import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { divIcon } from "leaflet";
import { Marker, Polyline, TileLayer, Tooltip, useMapEvents } from "react-leaflet";
import {
  Building2,
  Clock3,
  Download,
  FileUp,
  GripVertical,
  LayoutGrid,
  Layers,
  List,
  Square,
  MapPin,
  Play,
  Save,
  Signpost,
  Star,
  Undo2,
  X,
} from "lucide-react";
import "leaflet/dist/leaflet.css";

import AddressAutocomplete from "../components/AddressAutocomplete.jsx";
import { formatSearchAddress } from "../lib/format-address.js";
import useVehicles, { normalizeVehicleDevices } from "../lib/hooks/useVehicles.js";
import useGeocodeSearch from "../lib/hooks/useGeocodeSearch.js";
import Button from "../ui/Button";
import Input from "../ui/Input";
import Select from "../ui/Select";
import { API_ROUTES } from "../lib/api-routes.js";
import api from "../lib/api.js";
import { deduplicatePath, downloadKml, exportRoutesToKml, parseKmlPlacemarks, simplifyPath } from "../lib/kml.js";
import { toDeviceKey } from "../lib/hooks/useDevices.helpers.js";
import useVehicleSelection from "../lib/hooks/useVehicleSelection.js";
import useMapLifecycle from "../lib/map/useMapLifecycle.js";
import useMapController from "../lib/map/useMapController.js";
import {
  DEFAULT_MAP_LAYER_KEY,
  ENABLED_MAP_LAYERS,
  MAP_LAYER_FALLBACK,
  MAP_LAYER_STORAGE_KEYS,
  getValidMapLayer,
} from "../lib/mapLayers.js";
import { resolveMapPreferences } from "../lib/map-config.js";
import { resolveMirrorHeaders } from "../lib/mirror-params.js";
import { useTenant } from "../lib/tenant-context.jsx";
import MapToolbar from "../components/map/MapToolbar.jsx";
import { useUI } from "../lib/store.js";
import AppMap from "../components/map/AppMap.jsx";
import { useConfirmDialog } from "../components/ui/ConfirmDialogProvider.jsx";
import usePageToast from "../lib/hooks/usePageToast.js";
import PageToast from "../components/ui/PageToast.jsx";

const DEFAULT_CENTER = [-23.55052, -46.633308];
function alignUrlProtocol(rawUrl) {
  if (!rawUrl) return "";
  try {
    const url = new URL(rawUrl);
    if (typeof window !== "undefined" && window.location?.protocol === "https:" && url.protocol === "http:") {
      url.protocol = "https:";
    }
    return url.toString().replace(/\/$/, "");
  } catch (_error) {
    return rawUrl.replace(/\/$/, "");
  }
}

const GRAPH_HOPPER_URL = alignUrlProtocol(
  import.meta?.env?.VITE_GRAPHHOPPER_URL || import.meta?.env?.VITE_GRAPH_HOPPER_URL || "",
);
const GRAPH_HOPPER_KEY = import.meta?.env?.VITE_GRAPHHOPPER_KEY || import.meta?.env?.VITE_GRAPH_HOPPER_KEY || "";
const OSRM_BASE_URL = alignUrlProtocol(import.meta?.env?.VITE_OSRM_URL || "https://router.project-osrm.org");
const FINAL_GEOCODE_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const finalGeocodeCache = new Map();

function getFinalGeocodeCache(key) {
  if (!key) return null;
  const cached = finalGeocodeCache.get(key);
  if (!cached) return null;
  if (cached.expiresAt && cached.expiresAt > Date.now()) {
    return cached.value;
  }
  finalGeocodeCache.delete(key);
  return null;
}

function setFinalGeocodeCache(key, value, ttlMs = FINAL_GEOCODE_CACHE_TTL_MS) {
  if (!key) return null;
  finalGeocodeCache.set(key, { value, expiresAt: Date.now() + ttlMs });
  return value;
}

function buildFinalGeocodeKeys({ placeId, lat, lng }) {
  const keys = [];
  if (placeId) keys.push(`place:${placeId}`);
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    keys.push(`coords:${lat.toFixed(5)},${lng.toFixed(5)}`);
  }
  return keys;
}

async function lookupFinalGeocode({ lat, lng, placeId, signal }) {
  const keys = buildFinalGeocodeKeys({ placeId, lat, lng });
  for (const key of keys) {
    const cached = getFinalGeocodeCache(key);
    if (cached) return { ...cached, cached: true, source: "client-cache" };
  }

  const response = await api.get(API_ROUTES.geocode.lookup, {
    params: { lat, lng, placeId },
    signal,
  });
  const payload = response?.data;
  if (payload && payload.status !== "fallback") {
    keys.forEach((key) => setFinalGeocodeCache(key, payload));
  }
  return payload;
}

function isForbiddenError(error) {
  return Number(error?.response?.status ?? error?.status) === 403;
}

const emptyRoute = () => ({
  id: null,
  name: "Nova rota",
  mode: "car",
  points: [],
  metadata: { waypoints: [], xdmBufferMeters: 150 },
});

function uid(prefix = "wpt") {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

const WAYPOINT_LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
function waypointLetter(index) {
  if (index < WAYPOINT_LETTERS.length) return WAYPOINT_LETTERS[index];
  return `#${index + 1}`;
}

function normaliseWaypoint(raw, fallbackLabel) {
  if (!raw) return null;
  const lat = Number(raw.lat ?? raw.latitude ?? (Array.isArray(raw) ? raw[0] : null));
  const lng = Number(raw.lng ?? raw.lon ?? raw.longitude ?? (Array.isArray(raw) ? raw[1] : null));
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return {
    id: raw.id || raw.key || uid(),
    type: raw.type || "stop",
    lat,
    lng,
    order: Number.isFinite(raw.order) ? Number(raw.order) : undefined,
    label: raw.label || fallbackLabel || `${lat.toFixed(4)}, ${lng.toFixed(4)}`,
  };
}

function normalizeStopOrders(waypoints) {
  const normalized = (Array.isArray(waypoints) ? waypoints : [])
    .filter(Boolean)
    .map((item) => (item?.type === "checkpoint" ? { ...item, type: "stop" } : item));
  const stops = normalized.filter((item) => item.type === "stop").sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const others = normalized.filter((item) => item.type !== "stop");
  const reindexedStops = stops.map((stop, index) => ({ ...stop, order: index }));
  return [...others, ...reindexedStops];
}

function deriveWaypoints(metadataWaypoints, points) {
  const normalised = Array.isArray(metadataWaypoints)
    ? metadataWaypoints
        .map((item, index) => ({ ...normaliseWaypoint(item), order: Number.isFinite(item?.order) ? Number(item.order) : index }))
        .filter(Boolean)
    : [];

  const hasEndpoints = normalised.some((item) => item.type === "origin") && normalised.some((item) => item.type === "destination");
  if (hasEndpoints) {
    return normalizeStopOrders(normalised);
  }

  if (Array.isArray(points) && points.length >= 2) {
    const middleStops = points.slice(1, -1).map((coords, index) => ({
      id: uid(),
      type: "stop",
      lat: Number(coords[0]),
      lng: Number(coords[1]),
      order: index,
      label: `Parada ${index + 1}`,
    }));
    return normalizeStopOrders([
      { id: uid(), type: "origin", order: 0, lat: Number(points[0][0]), lng: Number(points[0][1]), label: "Origem" },
      ...middleStops,
      {
        id: uid(),
        type: "destination",
        order: middleStops.length + 1,
        lat: Number(points[points.length - 1][0]),
        lng: Number(points[points.length - 1][1]),
        label: "Destino",
      },
    ]);
  }

  return normalizeStopOrders(normalised);
}

function withWaypoints(route) {
  const safeRoute = route || {};
  const points = Array.isArray(safeRoute.points)
    ? safeRoute.points
        .map((pair) => {
          if (!Array.isArray(pair) || pair.length < 2) return null;
          const lat = Number(pair[0]);
          const lng = Number(pair[1]);
          return Number.isFinite(lat) && Number.isFinite(lng) ? [lat, lng] : null;
        })
        .filter(Boolean)
    : [];
  const metadata = safeRoute.metadata && typeof safeRoute.metadata === "object" ? { ...safeRoute.metadata } : {};
  const waypoints = deriveWaypoints(metadata.waypoints, points);
  return {
    ...safeRoute,
    mode: safeRoute.mode || "car",
    points,
    metadata: { ...metadata, waypoints },
  };
}

function splitWaypoints(waypoints) {
  const origin = waypoints.find((item) => item.type === "origin") || null;
  const destination = waypoints.find((item) => item.type === "destination") || null;
  const stops = waypoints.filter((item) => item.type === "stop").sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  return { origin, destination, stops };
}

const osrmCache = new Map();

function normalizeRoutingWaypoints(rawWaypoints) {
  return (Array.isArray(rawWaypoints) ? rawWaypoints : [])
    .map((point) => {
      if (!point) return null;
      const lat = Number(point.lat ?? point.latitude ?? (Array.isArray(point) ? point[0] : null));
      const lng = Number(point.lng ?? point.lon ?? point.longitude ?? (Array.isArray(point) ? point[1] : null));
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
      return { ...point, lat, lng };
    })
    .filter(Boolean);
}

function isValidLatLng(point) {
  return Number.isFinite(point?.lat) && Number.isFinite(point?.lng);
}

function createRoutePinIcon({ label, tone = "stop" }) {
  return divIcon({
    className: `route-pin-icon route-pin-icon--${tone}`,
    html: `<div class="route-pin"><span class="route-pin-label">${label}</span></div>`,
    iconSize: [32, 40],
    iconAnchor: [16, 38],
    popupAnchor: [0, -32],
  });
}

async function buildOsrmPath(waypoints) {
  const normalized = normalizeRoutingWaypoints(waypoints);
  if (normalized.length < 2) return [];
  const coordinates = normalized.map((point) => `${point.lng},${point.lat}`).join(";");
  const cacheKey = coordinates;
  if (osrmCache.has(cacheKey)) {
    return osrmCache.get(cacheKey);
  }
  const url = new URL(`${OSRM_BASE_URL}/route/v1/driving/${coordinates}`);
  url.searchParams.set("overview", "full");
  url.searchParams.set("geometries", "geojson");
  url.searchParams.set("annotations", "false");

  const request = fetch(url.toString())
    .then((response) => {
      if (!response.ok) {
        throw new Error("OSRM indisponível para gerar rota agora.");
      }
      return response.json().catch(() => null);
    })
    .then((payload) => {
      const geometry = payload?.routes?.[0]?.geometry;
      const coords = geometry?.coordinates || payload?.routes?.[0]?.geometry?.coordinates || [];
      if (!Array.isArray(coords) || !coords.length) return [];
      return coords.map(([lon, lat]) => [lat, lon]);
    })
    .catch((error) => {
      osrmCache.delete(cacheKey);
      throw error;
    });

  osrmCache.set(cacheKey, request);
  return request;
}

async function buildGraphHopperPath(waypoints) {
  if (!GRAPH_HOPPER_URL || !GRAPH_HOPPER_KEY) return null;
  const normalized = normalizeRoutingWaypoints(waypoints);
  if (normalized.length < 2) return null;
  const url = new URL(`${GRAPH_HOPPER_URL}/route`);
  url.searchParams.set("profile", "car");
  url.searchParams.set("points_encoded", "false");
  url.searchParams.set("locale", "pt-BR");
  url.searchParams.set("key", GRAPH_HOPPER_KEY);
  normalized.forEach((point) => {
    url.searchParams.append("point", `${point.lat},${point.lng}`);
  });

  const response = await fetch(url.toString());
  if (!response.ok) return null;
  const payload = await response.json().catch(() => null);
  const coords = payload?.paths?.[0]?.points?.coordinates;
  if (!Array.isArray(coords) || !coords.length) return null;
  return coords.map(([lon, lat]) => [lat, lon]);
}

function extractPositionsFromPayload(payload) {
  const container = payload?.data ?? payload;
  const base = Array.isArray(container?.positions)
    ? container.positions
    : Array.isArray(container?.route)
      ? container.route
      : Array.isArray(container)
        ? container
        : Array.isArray(container?.data)
          ? container.data
          : [];

  return base
    .map((pos) => [Number(pos.latitude ?? pos.lat), Number(pos.longitude ?? pos.lon ?? pos.lng)])
    .filter((pair) => pair.every((value) => Number.isFinite(value)));
}

function normalizeLatLngPair(raw) {
  if (!Array.isArray(raw)) return null;
  const [lat, lng] = raw;
  const latNum = Number(lat);
  const lngNum = Number(lng);
  if (!Number.isFinite(latNum) || !Number.isFinite(lngNum)) return null;
  return [latNum, lngNum];
}

function normalizeRoutePoints(points) {
  return (Array.isArray(points) ? points : []).map(normalizeLatLngPair).filter(Boolean);
}

function serializeRouteSnapshot(route) {
  if (!route) return "";
  const safeRoute = withWaypoints(route);
  return JSON.stringify({
    id: safeRoute.id || null,
    name: safeRoute.name || "",
    mode: safeRoute.mode || "car",
    points: normalizeRoutePoints(safeRoute.points || []),
    waypoints: normalizeStopOrders(safeRoute.metadata?.waypoints || []),
  });
}

function formatSearchLabel(value, fallback = "") {
  if (value === null || value === undefined) return fallback;
  if (typeof value === "string" || typeof value === "number") {
    const formatted = formatSearchAddress(value);
    return formatted && formatted !== "—" ? formatted : String(value);
  }
  if (typeof value === "object") {
    const candidate = value.address && typeof value.address === "object" ? value.address : value;
    const formatted = formatSearchAddress(candidate);
    if (formatted && formatted !== "—") return formatted;
    if (typeof value.label === "string") return value.label;
    if (typeof value.concise === "string") return value.concise;
    if (typeof value.address === "string") return value.address;
  }
  return fallback;
}

function extractAddressParts(item) {
  if (!item || typeof item !== "object") return null;
  const raw = item.raw && typeof item.raw === "object" ? item.raw : null;
  const candidates = [
    item.addressParts,
    item.address_parts,
    item.parts,
    item.address,
    raw?.addressParts,
    raw?.address_parts,
    raw?.parts,
    raw?.address,
  ];
  return candidates.find((value) => value && typeof value === "object" && !Array.isArray(value)) || null;
}

function coalesceString(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null) {
      const text = String(value).trim();
      if (text) return text;
    }
  }
  return "";
}

function abbreviateStreet(value) {
  if (!value) return "";
  const cleaned = String(value).replace(/\s+/g, " ").trim();
  const [first, ...rest] = cleaned.split(" ");
  const match = [
    [/^avenida\b/i, "Av."],
    [/^av\.?\b/i, "Av."],
    [/^rua\b/i, "R."],
    [/^rodovia\b/i, "Rod."],
    [/^estrada\b/i, "Est."],
    [/^travessa\b/i, "Tv."],
    [/^alameda\b/i, "Al."],
    [/^largo\b/i, "Lg."],
    [/^prac[aá]\b/i, "Pc."],
  ].find(([regex]) => regex.test(first));
  if (!match) return cleaned;
  const [, abbreviation] = match;
  return [abbreviation, rest.join(" ")].filter(Boolean).join(" ").trim();
}

function normalizeCep(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.length !== 8) return "";
  return `${digits.slice(0, 5)}-${digits.slice(5)}`;
}

function resolveHouseNumber(parts, overrideNumber) {
  const override = coalesceString(overrideNumber);
  if (override) return override;
  return coalesceString(
    parts?.houseNumber,
    parts?.house_number,
    parts?.number,
    parts?.numero,
    parts?.house,
    parts?.street_number,
    parts?.streetNumber,
  );
}

function formatAddressFromParts(parts = {}, overrideNumber = "") {
  if (!parts || typeof parts !== "object") return "";
  const street = abbreviateStreet(
    coalesceString(parts.street, parts.road, parts.streetName, parts.route, parts.logradouro, parts.endereco),
  );
  const number = resolveHouseNumber(parts, overrideNumber) || (street ? "s/n" : "");
  const neighbourhood = coalesceString(
    parts.neighbourhood,
    parts.neighborhood,
    parts.suburb,
    parts.quarter,
    parts.bairro,
    parts.district,
    parts.city_district,
  );
  const city = coalesceString(parts.city, parts.town, parts.village, parts.municipality, parts.county, parts.cidade);
  const state = coalesceString(parts.state_code, parts.stateCode, parts.state, parts.region, parts.uf, parts.estado);
  const postalCode = normalizeCep(coalesceString(parts.postalCode, parts.postcode, parts.zipcode, parts.cep));

  const head = [street, number].filter(Boolean).join(", ");
  const cityState = [city, state].filter(Boolean).join("-");
  let formatted = head;
  if (neighbourhood) {
    formatted = formatted ? `${formatted} - ${neighbourhood}` : neighbourhood;
  }
  if (cityState) {
    formatted = formatted ? `${formatted} — ${cityState}` : cityState;
  }
  if (postalCode) {
    formatted = formatted ? `${formatted}, ${postalCode}` : postalCode;
  }
  return formatted || "";
}

function formatSuggestionAddress(item) {
  if (!item) return "";
  const parts = extractAddressParts(item) || {};
  const formatted = formatAddressFromParts(parts);
  const fallback = formatSearchAddress(item?.raw?.address || item);
  return formatted || fallback || "";
}

function resolveSuggestionIcon(item) {
  const rawType = [
    item?.type,
    item?.class,
    item?.category,
    item?.raw?.type,
    item?.raw?.class,
    item?.raw?.category,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (/(city|town|village|municipality|county|state|region|bairro|district)/.test(rawType)) {
    return Building2;
  }
  if (/(road|street|highway|motorway|route|avenida|avenue|rua|rodovia|estrada)/.test(rawType)) {
    return Signpost;
  }
  if (/(amenity|tourism|attraction|hotel|restaurant|shop|poi|place)/.test(rawType)) {
    return Star;
  }
  return MapPin;
}

function highlightMatch(text, query) {
  if (!text) return "";
  const term = String(query || "").trim();
  if (!term) return text;
  const lower = text.toLowerCase();
  const lowerTerm = term.toLowerCase();
  if (!lower.includes(lowerTerm)) return text;

  const parts = [];
  let cursor = 0;
  let index = lower.indexOf(lowerTerm, cursor);
  while (index !== -1) {
    if (index > cursor) {
      parts.push(text.slice(cursor, index));
    }
    parts.push(
      <span key={`${index}-${lowerTerm}`} className="route-search-highlight">
        {text.slice(index, index + lowerTerm.length)}
      </span>,
    );
    cursor = index + lowerTerm.length;
    index = lower.indexOf(lowerTerm, cursor);
  }
  if (cursor < text.length) {
    parts.push(text.slice(cursor));
  }
  return parts;
}

function MapClickHandler({ enabled, onAdd }) {
  useMapEvents({
    click(event) {
      if (!enabled) return;
      onAdd([event.latlng.lat, event.latlng.lng]);
    },
  });
  return null;
}

function WaypointInput({ label, placeholder, value, onChange, onClear, resetKey, autoFocus = false, hideLabel = false, onFocus }) {
  const [query, setQuery] = useState(() => formatSearchLabel(value?.label || value?.address || ""));
  const { suggestions, isSearching, clearSuggestions, searchRegion, error } = useGeocodeSearch();
  const [isFocused, setIsFocused] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [isResolving, setIsResolving] = useState(false);
  const [dropdownStyle, setDropdownStyle] = useState(null);
  const debounceRef = useRef(null);
  const resolveRef = useRef(null);
  const containerRef = useRef(null);
  const inputRef = useRef(null);
  const listRef = useRef(null);
  const trimmedQuery = query.trim();
  const typedNumberMatch = trimmedQuery.match(/\b\d+\b/);
  const typedNumber = typedNumberMatch ? typedNumberMatch[0] : "";
  const hasTypedNumber = Boolean(typedNumber);
  const orderedSuggestions = useMemo(() => {
    if (!hasTypedNumber) return suggestions;
    const scoreCandidate = (item) => {
      const parts = extractAddressParts(item) || {};
      const hasHouse = Boolean(resolveHouseNumber(parts, ""));
      const label = formatSuggestionAddress(item).toLowerCase();
      const numberMatch = typedNumber && label.includes(typedNumber);
      return (hasHouse ? 2 : 0) + (numberMatch ? 1 : 0);
    };
    return [...suggestions].sort((a, b) => scoreCandidate(b) - scoreCandidate(a));
  }, [hasTypedNumber, suggestions, typedNumber]);
  const hasSuggestions = orderedSuggestions.length > 0;
  const emptyMessage =
    !isSearching && trimmedQuery.length >= 3 && !hasSuggestions && error?.message === "Nenhum resultado encontrado."
      ? "Nenhum endereço encontrado"
      : "";
  const errorMessage =
    error && error?.message !== "Nenhum resultado encontrado."
      ? "Não foi possível buscar agora, tente novamente."
      : "";

  useEffect(() => {
    if (isFocused) return;
    setQuery(formatSearchLabel(value?.label || value?.formattedAddress || value?.address || ""));
  }, [value?.address, value?.formattedAddress, value?.id, value?.label, isFocused]);

  useEffect(() => {
    clearSuggestions();
    setIsFocused(false);
    setActiveIndex(-1);
  }, [clearSuggestions, resetKey]);

  useEffect(() => {
    if (!autoFocus) return;
    const frame = requestAnimationFrame(() => {
      if (!inputRef.current) return;
      inputRef.current.focus();
      inputRef.current.select();
    });
    return () => cancelAnimationFrame(frame);
  }, [autoFocus]);

  useEffect(() => {
    if (query && query.length >= 3) {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => searchRegion(query), 250);
    } else {
      clearSuggestions();
    }
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, clearSuggestions, searchRegion]);

  const showSuggestions =
    isFocused && trimmedQuery.length >= 3 && (hasSuggestions || isSearching || emptyMessage || errorMessage);

  useEffect(() => {
    if (!showSuggestions) {
      setDropdownStyle(null);
      return;
    }
    const updatePosition = () => {
      const element = containerRef.current;
      if (!element) return;
      const inputRect = element.getBoundingClientRect();
      const panelElement =
        element.closest(".route-waypoint-list") ||
        element.closest(".route-waypoint-row") ||
        element.closest(".floating-left-panel") ||
        element.parentElement;
      const panelRect = panelElement?.getBoundingClientRect?.() || null;
      const inputWidth = inputRect.width || element.offsetWidth || 0;
      const desiredWidth = inputWidth * 1.25;
      let maxWidth = 560;
      if (panelRect) {
        const available = panelRect.right - inputRect.left - 12;
        const panelMax = panelRect.width - 24;
        maxWidth = Math.min(maxWidth, available, panelMax);
      } else {
        maxWidth = Math.min(maxWidth, window.innerWidth - inputRect.left - 16);
      }
      const width = Math.min(Math.max(inputWidth, desiredWidth), maxWidth);
      setDropdownStyle({ width, left: inputRect.left, top: inputRect.bottom + 6 });
    };

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [showSuggestions]);

  useEffect(() => {
    setActiveIndex(-1);
  }, [trimmedQuery, orderedSuggestions.length]);

  useEffect(() => {
    if (activeIndex < 0 || !listRef.current) return;
    const activeItem = listRef.current.querySelector(`[data-index="${activeIndex}"]`);
    if (!activeItem) return;
    activeItem.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  const parseManual = useCallback(() => {
    if (!query) return null;
    const parts = query.split(/[,;\s]+/).map((part) => Number(part.trim())).filter((num) => Number.isFinite(num));
    if (parts.length >= 2) {
      return { lat: parts[0], lng: parts[1], label: query };
    }
    return null;
  }, [query]);

  const handleSelect = useCallback(
    async (candidate) => {
      if (!candidate) return;
      if (resolveRef.current) {
        resolveRef.current.abort();
      }
      const controller = new AbortController();
      resolveRef.current = controller;

      const candidateParts = extractAddressParts(candidate) || {};
      let resolvedLabel =
        formatSuggestionAddress(candidate) ||
        formatSearchLabel(candidate?.raw?.address || candidate?.label || candidate?.concise || query, candidate?.label || query);
      if (typedNumber && !resolvedLabel.includes(typedNumber)) {
        const withTyped = formatAddressFromParts(candidateParts, typedNumber);
        resolvedLabel = withTyped || query || resolvedLabel;
      }
      const basePayload = {
        id: value?.id || candidate.id || uid(),
        type: value?.type || "stop",
        lat: candidate.lat,
        lng: candidate.lng,
        label: resolvedLabel,
        formattedAddress: resolvedLabel,
        order: value?.order,
      };
      onChange(basePayload);
      setQuery(resolvedLabel || "");
      clearSuggestions();
      setIsFocused(false);

      if (!Number.isFinite(candidate.lat) || !Number.isFinite(candidate.lng)) return;
      setIsResolving(true);
      try {
        const final = await lookupFinalGeocode({
          lat: candidate.lat,
          lng: candidate.lng,
          placeId: candidate?.id,
          signal: controller.signal,
        });
        if (!final || controller.signal.aborted) return;
        if (final.status === "fallback") return;
        const parts = final?.parts || extractAddressParts(final) || extractAddressParts(candidate) || null;
        const hasProviderNumber = Boolean(resolveHouseNumber(parts || {}, ""));
        const numberOverride = hasProviderNumber ? "" : typedNumber;
        const formatted = parts ? formatAddressFromParts(parts, numberOverride) : "";
        const finalLabel = formatted || final?.formattedAddress || resolvedLabel;
        const nextPayload = {
          ...basePayload,
          ...final,
          lat: Number(final?.lat ?? basePayload.lat),
          lng: Number(final?.lng ?? basePayload.lng),
          label: finalLabel,
          formattedAddress: finalLabel,
          addressParts: parts,
          typedNumber: numberOverride || undefined,
        };
        onChange(nextPayload);
      } catch (_error) {
        // ignore final geocode errors (keeps base selection)
      } finally {
        setIsResolving(false);
      }
    },
    [clearSuggestions, onChange, query, value?.id, value?.order, value?.type],
  );

  const handleKeyDown = (event) => {
    if (event.key === "ArrowDown") {
      if (!hasSuggestions) return;
      event.preventDefault();
      setActiveIndex((prev) => {
        const next = prev < 0 ? 0 : prev + 1;
        return Math.min(next, orderedSuggestions.length - 1);
      });
    } else if (event.key === "ArrowUp") {
      if (!hasSuggestions) return;
      event.preventDefault();
      setActiveIndex((prev) => {
        if (prev <= 0) return -1;
        return prev - 1;
      });
    } else if (event.key === "Enter") {
      if (!hasSuggestions || activeIndex < 0) return;
      event.preventDefault();
      const selected = orderedSuggestions[activeIndex];
      if (!selected) return;
      handleSelect(selected);
    } else if (event.key === "Escape") {
      if (!showSuggestions) return;
      event.preventDefault();
      clearSuggestions();
      setIsFocused(false);
    }
  };

  const handleBlur = () => {
    const manual = parseManual();
    if (manual) {
      onChange({ ...manual, id: value?.id || uid(), type: value?.type || "stop", order: value?.order });
    }
  };

  const suggestionList = showSuggestions ? (
    <div className="route-search-suggestions" style={dropdownStyle ?? undefined}>
      <div ref={listRef} className="route-search-list" role="listbox">
        {hasSuggestions ? (
          orderedSuggestions.map((item, index) => {
            const key = item.id || item.placeId || item.place_id || `${item.lat}-${item.lng}-${index}`;
            const isActive = index === activeIndex;
            const title = formatSuggestionAddress(item);
            const Icon = resolveSuggestionIcon(item);
            return (
              <button
                key={key}
                type="button"
                data-index={index}
                className={`route-search-item ${isActive ? "is-active" : ""}`.trim()}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => handleSelect(item)}
                role="option"
                aria-selected={isActive}
                title={title}
              >
                <span className="route-search-icon">
                  <Icon size={16} />
                </span>
                <span className="route-search-content">
                  <span className="route-search-title">{highlightMatch(title, trimmedQuery)}</span>
                </span>
              </button>
            );
          })
        ) : isSearching ? (
          <div className="route-search-state">
            <span className="route-search-spinner" aria-hidden="true" />
            <span>Carregando...</span>
          </div>
        ) : errorMessage ? (
          <div className="route-search-state route-search-state--error">{errorMessage}</div>
        ) : emptyMessage ? (
          <div className="route-search-state">{emptyMessage}</div>
        ) : null}
      </div>
    </div>
  ) : null;
  const renderedSuggestions =
    suggestionList && typeof document !== "undefined"
      ? createPortal(suggestionList, document.body)
      : suggestionList;

  return (
    <div ref={containerRef} className="relative">
      {!hideLabel && <label className="text-xs font-semibold text-white/70">{label}</label>}
      <div className="relative">
        <input
          ref={inputRef}
          className="mt-1 w-full truncate rounded-xl border border-white/10 bg-white/5 px-3 py-1 pr-7 text-xs text-white focus:border-primary focus:outline-none"
          placeholder={placeholder}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onFocus={() => {
            setIsFocused(true);
            onFocus?.();
          }}
          onBlur={() => {
            setIsFocused(false);
            handleBlur();
          }}
          onKeyDown={handleKeyDown}
          title={value?.label || query}
          aria-label={hideLabel ? label || placeholder || "Endereço" : undefined}
        />
        {query ? (
          <button
            type="button"
            className="absolute right-2 top-1/2 -translate-y-1/2 text-white/50 transition hover:text-white"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              setQuery("");
              clearSuggestions();
              onClear?.();
            }}
            aria-label="Limpar endereço"
          >
            ×
          </button>
        ) : null}
      </div>
      {error && <p className="mt-1 text-xs text-red-400">{error.message}</p>}
      {isResolving && <p className="mt-1 text-[11px] text-white/60">Confirmando endereço completo...</p>}
      {renderedSuggestions}
    </div>
  );
}

function ToolbarButton({ icon: Icon, active = false, title, className = "", iconSize = 12, ...props }) {
  return (
    <button
      type="button"
      className={`map-tool-button ${active ? "is-active" : ""} ${className}`.trim()}
      title={title}
      {...props}
    >
      <Icon size={iconSize} />
    </button>
  );
}

function SidebarCard({ children, className = "" }) {
  return (
    <div className={`pointer-events-auto rounded-2xl border border-white/10 bg-[#0f141c]/90 p-4 shadow-2xl ${className}`.trim()}>
      {children}
    </div>
  );
}

function RoutePanel({
  routes,
  activeRouteId,
  searchTerm,
  onSearch,
  onSelect,
  onEdit,
  onDelete,
  onExport,
  loading,
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold text-white">Minhas rotas</h2>
        </div>
        <div className="flex items-center gap-1">
          <span className="map-status-pill bg-white/5 text-white/70">{routes.length} itens</span>
        </div>
      </div>

      <div className="mt-3 space-y-2">
        <Input
          value={searchTerm}
          onChange={(event) => onSearch(event.target.value)}
          placeholder="Buscar rota"
          className="map-compact-input"
        />
        <div className="geofence-panel-list">
          {routes.map((route) => (
            <div
              key={route.id || route.name}
              role="button"
              tabIndex={0}
              aria-pressed={activeRouteId === route.id}
              className={`geofence-panel-item text-left transition ${
                activeRouteId === route.id ? "border-primary/50 bg-primary/10" : "hover:border-white/20"
              }`}
              onClick={() => onSelect(route)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onSelect(route);
                }
              }}
            >
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold text-white">{route.name || "Rota sem nome"}</p>
                  <p className="text-[11px] text-white/60">{route.points?.length || 0} pontos</p>
                </div>
                {route.updatedAt && (
                  <span className="text-[11px] text-white/60">
                    {new Date(route.updatedAt).toLocaleDateString()}
                  </span>
                )}
              </div>
              <div className="mt-2 flex gap-2">
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={(event) => {
                    event.stopPropagation();
                    onEdit?.(route);
                  }}
                >
                  Editar
                </Button>
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={(event) => {
                    event.stopPropagation();
                    onExport(route);
                  }}
                >
                  Exportar
                </Button>
                <Button
                  size="xs"
                  variant="secondary"
                  onClick={(event) => {
                    event.stopPropagation();
                    onDelete(route.id);
                  }}
                >
                  Excluir
                </Button>
              </div>
            </div>
          ))}
          {routes.length === 0 && !loading && <p className="text-xs text-white/60">Nenhuma rota salva ainda.</p>}
          {loading && <p className="text-xs text-white/60">Carregando...</p>}
        </div>
      </div>
    </div>
  );
}

export default function RoutesPage() {
  const navigate = useNavigate();
  const mapRef = useRef(null);
  const { onMapReady, refreshMap } = useMapLifecycle({ mapRef });
  const { registerMap, focusDevice, focusGeometry } = useMapController({ page: "Routes" });
  const { tenant, mirrorContextMode, mirrorModeEnabled, activeMirror, activeMirrorOwnerClientId } = useTenant();
  const mirrorOwnerClientId = activeMirror?.ownerClientId ?? activeMirrorOwnerClientId;
  const mirrorHeaders = useMemo(
    () => resolveMirrorHeaders({ mirrorModeEnabled, mirrorOwnerClientId }),
    [mirrorModeEnabled, mirrorOwnerClientId],
  );
  const shouldWaitForMirror = mirrorContextMode === "target" && mirrorModeEnabled !== false && !mirrorHeaders;
  const mapPreferences = useMemo(() => resolveMapPreferences(tenant?.attributes), [tenant?.attributes]);
  const userActionRef = useRef(false);
  const [mapInstance, setMapInstance] = useState(null);
  const routesTopbarVisible = useUI((state) => state.routesTopbarVisible !== false);
  const setRoutesTopbarVisible = useUI((state) => state.setRoutesTopbarVisible);
  const handleMapReady = useCallback(
    (event) => {
      const map = event?.target || event;
      onMapReady(event);
      registerMap(map);
      setMapInstance(map || null);
    },
    [onMapReady, registerMap],
  );
  const fileInputRef = useRef(null);
  const [routes, setRoutes] = useState([]);
  const [accessError, setAccessError] = useState(null);
  const [draftRoute, setDraftRoute] = useState(withWaypoints(emptyRoute()));
  const [baselineRoute, setBaselineRoute] = useState(withWaypoints(emptyRoute()));
  const [activeRouteId, setActiveRouteId] = useState(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editingRouteId, setEditingRouteId] = useState(null);
  const [routeFilter, setRouteFilter] = useState("");
  const [loadingRoutes, setLoadingRoutes] = useState(false);
  const { confirmDelete } = useConfirmDialog();
  const { toast, showToast } = usePageToast();
  const [saving, setSaving] = useState(false);
  const [isRouting, setIsRouting] = useState(false);
  const [mapAddsStops, setMapAddsStops] = useState(false);
  const [pendingFocusId, setPendingFocusId] = useState(null);
  const [draggingStopId, setDraggingStopId] = useState(null);
  const [dragOverIndex, setDragOverIndex] = useState(null);
  const [mapLayerKey, setMapLayerKey] = useState(DEFAULT_MAP_LAYER_KEY);
  const [mapLayerMenuOpen, setMapLayerMenuOpen] = useState(false);
  const mapLayerButtonRef = useRef(null);
  const [activePanel, setActivePanel] = useState("editor");
  const [editorMode, setEditorMode] = useState("manual");
  const [layoutMenuOpen, setLayoutMenuOpen] = useState(false);
  const [showRoutesPanel, setShowRoutesPanel] = useState(true);
  const [showEditorPanel, setShowEditorPanel] = useState(true);
  const [historyForm, setHistoryForm] = useState({ vehicleId: "", from: "", to: "" });
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [autocompleteResetKey, setAutocompleteResetKey] = useState(0);
  const [addressValue, setAddressValue] = useState({ formattedAddress: "" });
  const [searchMarker, setSearchMarker] = useState(null);
  const mapInvalidateKey = useMemo(
    () => `${showRoutesPanel}-${showEditorPanel}-${activePanel}-${editorMode}-${routesTopbarVisible}`,
    [activePanel, editorMode, routesTopbarVisible, showEditorPanel, showRoutesPanel],
  );
  const mapLayerStorageKey = MAP_LAYER_STORAGE_KEYS.routes;

  const {
    vehicles,
    vehicleOptions,
    loading: loadingVehicles,
    error: vehiclesError,
  } = useVehicles({ includeTelemetry: false });
  const { selectedVehicleId: vehicleId, selectedTelemetryDeviceId: deviceIdFromStore } = useVehicleSelection({
    syncQuery: true,
  });
  const historyVehicle = useMemo(
    () => vehicles.find((vehicle) => String(vehicle.id) === String(historyForm.vehicleId)) || null,
    [historyForm.vehicleId, vehicles],
  );
  const historyDeviceId = deviceIdFromStore || historyVehicle?.primaryDeviceId || "";
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

  const filteredRoutes = useMemo(() => {
    const term = routeFilter.trim().toLowerCase();
    if (!term) return routes;
    return routes.filter((route) => route.name?.toLowerCase().includes(term));
  }, [routeFilter, routes]);

  const mapLayer = useMemo(
    () => ENABLED_MAP_LAYERS.find((layer) => layer.key === mapLayerKey) || MAP_LAYER_FALLBACK,
    [mapLayerKey],
  );

  const mapLayerOptions = useMemo(() => {
    const candidates = ENABLED_MAP_LAYERS.filter((layer) => layer?.url);
    const pickedKeys = new Set();
    const pick = (keys) =>
      candidates.find((layer) => keys.some((key) => layer.key.includes(key))) || null;

    const options = [
      { id: "satellite", label: "Satélite", layer: pick(["google-satellite", "satellite", "hybrid", "google-hybrid"]) },
      { id: "streets", label: "Ruas / Padrão", layer: pick(["google-road", "openstreetmap", "osm", "carto-light"]) },
      { id: "terrain", label: "Terreno", layer: pick(["opentopomap", "topo", "terrain"]) },
      { id: "dark", label: "Escuro", layer: pick(["carto-dark", "dark"]) },
    ]
      .filter((item) => item.layer)
      .filter((item) => {
        if (!item.layer) return false;
        if (pickedKeys.has(item.layer.key)) return false;
        pickedKeys.add(item.layer.key);
        return true;
      });

    if (!options.length && candidates.length) {
      return candidates.slice(0, 5).map((layer) => ({ id: layer.key, label: layer.label, layer }));
    }

    return options;
  }, []);

  useEffect(() => {
    if (!historyForm.vehicleId && vehicleOptions.length === 1) {
      setHistoryForm((current) => ({ ...current, vehicleId: String(vehicleOptions[0].value) }));
    }
  }, [historyForm.vehicleId, vehicleOptions]);

  useEffect(() => {
    if (!vehicleId) return;
    if (historyForm.vehicleId !== String(vehicleId)) {
      setHistoryForm((current) => ({ ...current, vehicleId: String(vehicleId) }));
    }
  }, [historyForm.vehicleId, vehicleId]);

  useEffect(() => {
    try {
      const storedLayer = localStorage.getItem(mapLayerStorageKey);
      setMapLayerKey(getValidMapLayer(storedLayer));
    } catch (_error) {
      // ignore
    }
  }, [mapLayerStorageKey]);

  useEffect(() => {
    try {
      localStorage.setItem(mapLayerStorageKey, mapLayerKey);
    } catch (_error) {
      // ignore
    }
  }, [mapLayerKey, mapLayerStorageKey]);

  const waypoints = useMemo(() => normalizeStopOrders(draftRoute.metadata?.waypoints || []), [draftRoute.metadata?.waypoints]);
  const { origin, destination, stops } = useMemo(() => splitWaypoints(waypoints), [waypoints]);
  const isDraftDirty = useMemo(
    () => serializeRouteSnapshot(draftRoute) !== serializeRouteSnapshot(baselineRoute),
    [baselineRoute, draftRoute],
  );
  const originPoint = useMemo(() => (isValidLatLng(origin) ? origin : null), [origin]);
  const destinationPoint = useMemo(() => (isValidLatLng(destination) ? destination : null), [destination]);
  const originIcon = useMemo(
    () => (originPoint ? createRoutePinIcon({ label: "A", tone: "origin" }) : null),
    [originPoint],
  );
  const destinationIcon = useMemo(
    () => (destinationPoint ? createRoutePinIcon({ label: "B", tone: "destination" }) : null),
    [destinationPoint],
  );
  const stopIcons = useMemo(
    () =>
      stops.map((_stop, index) =>
        createRoutePinIcon({ label: waypointLetter(index + 2), tone: "stop" }),
      ),
    [stops],
  );
  const searchIcon = useMemo(
    () => (searchMarker ? createRoutePinIcon({ label: "S", tone: "search" }) : null),
    [searchMarker],
  );

  const resetAutocomplete = useCallback(() => {
    setAutocompleteResetKey((current) => current + 1);
    setAddressValue({ formattedAddress: "" });
  }, []);

  const loadRoutes = useCallback(async ({ updateDraft = true } = {}) => {
    if (shouldWaitForMirror) {
      setLoadingRoutes(false);
      return;
    }
    setLoadingRoutes(true);
    try {
      const response = await api.get(API_ROUTES.routes, { headers: mirrorHeaders });
      const list = response?.data?.data || response?.data?.routes || response?.data || [];
      const normalised = (Array.isArray(list) ? list : []).map(withWaypoints);
      setRoutes(normalised);
      setAccessError(null);
      if (updateDraft && normalised[0] && !activeRouteId) {
        setDraftRoute(normalised[0]);
        setBaselineRoute(normalised[0]);
        setActiveRouteId(normalised[0].id);
        setIsEditing(false);
        setEditingRouteId(null);
      }
    } catch (error) {
      if (isForbiddenError(error)) {
        setAccessError({ message: "Sem acesso às rotas neste cliente." });
        return;
      }
      if (import.meta.env?.DEV) {
        console.error("[routes] Falha ao carregar rotas", error);
      }
    } finally {
      setLoadingRoutes(false);
    }
  }, [activeRouteId, mirrorHeaders, shouldWaitForMirror]);

  useEffect(() => {
    void loadRoutes();
  }, [loadRoutes]);

  const handleNewRoute = useCallback(() => {
    const fresh = withWaypoints(emptyRoute());
    userActionRef.current = true;
    setDraftRoute(fresh);
    setBaselineRoute(fresh);
    setActiveRouteId(null);
    setIsEditing(false);
    setEditingRouteId(null);
    setMapAddsStops(false);
    setPendingFocusId(null);
    setDraggingStopId(null);
    setDragOverIndex(null);
    resetAutocomplete();
  }, [resetAutocomplete]);

  const handleStartManualRoute = useCallback(() => {
    handleNewRoute();
    setEditorMode("manual");
    setActivePanel("editor");
    setShowEditorPanel(true);
  }, [handleNewRoute]);

  const buildRoutePayload = useCallback(
    (routePayload = draftRoute) => {
      const trimmedName = routePayload?.name?.trim();
      const payload = withWaypoints({
        ...routePayload,
        name: trimmedName,
        metadata: {
          ...(routePayload.metadata || {}),
          waypoints: normalizeStopOrders(routePayload.metadata?.waypoints || waypoints || []),
        },
      });
      if (!payload.name) {
        throw new Error("Informe um nome para a rota.");
      }
      if (!payload.points || payload.points.length < 2) {
        throw new Error("A rota precisa de pelo menos dois pontos.");
      }
      return payload;
    },
    [draftRoute, waypoints],
  );

  const createRoute = useCallback(
    async (routePayload = draftRoute) => {
      const payload = buildRoutePayload(routePayload);
      const { id: _discardedId, ...createPayload } = payload;
      setSaving(true);
      try {
        const response = await api.post(API_ROUTES.routes, createPayload);
        const saved = withWaypoints(response?.data?.data || response?.data?.route || response?.data || payload);
        setRoutes((prev) => {
          const others = prev.filter((item) => String(item.id) !== String(saved.id));
          return saved.id ? [saved, ...others] : prev;
        });
        await loadRoutes({ updateDraft: false });
        showToast("Rota salva com sucesso.");
        handleNewRoute();
        return saved;
      } finally {
        setSaving(false);
      }
    },
    [buildRoutePayload, draftRoute, handleNewRoute, loadRoutes, showToast],
  );

  const updateRoute = useCallback(
    async (routePayload = draftRoute, routeId = editingRouteId) => {
      if (!routeId) {
        throw new Error("Selecione uma rota para editar.");
      }
      const payload = buildRoutePayload(routePayload);
      setSaving(true);
      try {
        const response = await api.put(`${API_ROUTES.routes}/${routeId}`, { ...payload, id: routeId });
        const saved = withWaypoints(response?.data?.data || response?.data?.route || response?.data || payload);
        setRoutes((prev) => {
          const others = prev.filter((item) => String(item.id) !== String(saved.id));
          return saved.id ? [saved, ...others] : prev;
        });
        showToast("Rota atualizada com sucesso.");
        handleNewRoute();
        return saved;
      } finally {
        setSaving(false);
      }
    },
    [buildRoutePayload, draftRoute, editingRouteId, handleNewRoute, showToast],
  );

  const handleSave = async () => {
    try {
      const shouldUpdate = isEditing && Boolean(editingRouteId);
      if (!shouldUpdate && editingRouteId) {
        setEditingRouteId(null);
        setIsEditing(false);
      }
      if (shouldUpdate) {
        await updateRoute(draftRoute, editingRouteId);
      } else {
        await createRoute(draftRoute);
      }
    } catch (error) {
      if (isForbiddenError(error)) {
        showToast("Sem acesso para salvar rotas neste cliente.", "warning");
        return;
      }
      if (import.meta.env?.DEV) {
        console.error(error);
      }
      showToast(error?.response?.data?.message || error?.message || "Não foi possível salvar a rota.", "warning");
    }
  };

  const handleCancel = useCallback(() => {
    if (isDraftDirty) {
      const confirmed = window.confirm("Deseja descartar alterações?");
      if (!confirmed) return;
    }
    setDraftRoute(baselineRoute);
    setMapAddsStops(false);
  }, [baselineRoute, isDraftDirty]);

  const handleSelectRoute = (route) => {
    const normalized = withWaypoints(route);
    userActionRef.current = true;
    setDraftRoute(normalized);
    setBaselineRoute(normalized);
    setActiveRouteId(normalized.id || null);
    setIsEditing(false);
    setEditingRouteId(null);
    resetAutocomplete();
  };

  const handleEditRoute = (route) => {
    if (!route) return;
    const normalized = withWaypoints(route);
    userActionRef.current = true;
    setDraftRoute(normalized);
    setBaselineRoute(normalized);
    setActiveRouteId(normalized.id || null);
    setIsEditing(true);
    setEditingRouteId(normalized.id || null);
    resetAutocomplete();
  };

  const handleDeleteRoute = async (id) => {
    if (!id) return;
    await confirmDelete({
      title: "Excluir rota",
      message: "Tem certeza que deseja excluir a rota? Essa ação não pode ser desfeita.",
      confirmLabel: "Excluir",
      onConfirm: async () => {
        try {
          await api.delete(`${API_ROUTES.routes}/${id}`);
          setRoutes((current) => current.filter((item) => String(item.id) !== String(id)));
          if (activeRouteId === id) {
            handleNewRoute();
          }
          showToast("Excluído com sucesso.");
        } catch (requestError) {
          showToast("Falha ao excluir.", "error");
          throw requestError;
        }
      },
    });
  };

  const handleExportSingle = (route) => {
    if (!route) return;
    const kml = exportRoutesToKml([route]);
    downloadKml(`${route.name || "rota"}.kml`, kml);
  };

  useEffect(() => {
    if (activePanel === "routes" && !showRoutesPanel) {
      setActivePanel(showEditorPanel ? "editor" : null);
    }
    if (activePanel === "editor" && !showEditorPanel) {
      setActivePanel(showRoutesPanel ? "routes" : null);
    }
  }, [activePanel, showEditorPanel, showRoutesPanel]);

  useEffect(() => {
    resetAutocomplete();
  }, [activePanel, editorMode, resetAutocomplete]);

  useEffect(() => {
    if (!mapLayerMenuOpen) return;
    const handleClick = (event) => {
      if (!mapLayerButtonRef.current) return;
      if (mapLayerButtonRef.current.contains(event.target)) return;
      setMapLayerMenuOpen(false);
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [mapLayerMenuOpen]);

  const handlePanelToggle = useCallback(
    (panel) => {
      setActivePanel((current) => (current === panel ? null : panel));
      resetAutocomplete();
    },
    [resetAutocomplete],
  );

  const updateWaypoint = useCallback(
    (type, payload, index = 0) => {
      if (!payload) return;
      setDraftRoute((current) => {
        const existing = Array.isArray(current.metadata?.waypoints) ? current.metadata.waypoints : [];
        const isOrderedType = type === "stop";
        const filtered = existing.filter((item) => item.type !== type || (isOrderedType && item.order !== index));
        const nextWaypoint = normalizeStopOrders([
          ...filtered,
          {
            ...payload,
            id: payload.id || uid(),
            type,
            order: isOrderedType ? index : payload.order,
          },
        ]);
        return { ...current, metadata: { ...(current.metadata || {}), waypoints: nextWaypoint } };
      });
    },
    [],
  );

  const removeWaypoint = useCallback((type) => {
    setDraftRoute((current) => {
      const waypointsList = Array.isArray(current.metadata?.waypoints) ? current.metadata.waypoints : [];
      const filtered = normalizeStopOrders(waypointsList.filter((item) => item.type !== type));
      return { ...current, metadata: { ...(current.metadata || {}), waypoints: filtered } };
    });
  }, []);

  const removeStop = useCallback((index) => {
    setDraftRoute((current) => {
      const waypointsList = Array.isArray(current.metadata?.waypoints) ? current.metadata.waypoints : [];
      const filtered = normalizeStopOrders(waypointsList.filter((item) => !(item.type === "stop" && item.order === index)));
      return { ...current, metadata: { ...(current.metadata || {}), waypoints: filtered } };
    });
  }, []);

  const clearStop = useCallback(
    (index, stopId) => {
      updateWaypoint("stop", { id: stopId || uid(), type: "stop", lat: null, lng: null, label: "" }, index);
    },
    [updateWaypoint],
  );

  const reorderStops = useCallback((fromIndex, toIndex) => {
    setDraftRoute((current) => {
      const waypointsList = Array.isArray(current.metadata?.waypoints) ? current.metadata.waypoints : [];
      const normalized = normalizeStopOrders(waypointsList);
      const { origin: currentOrigin, destination: currentDestination, stops: currentStops } = splitWaypoints(normalized);
      if (fromIndex === toIndex) return current;
      if (fromIndex < 0 || fromIndex >= currentStops.length) return current;
      if (toIndex < 0 || toIndex >= currentStops.length) return current;
      const reordered = [...currentStops];
      const [moved] = reordered.splice(fromIndex, 1);
      reordered.splice(toIndex, 0, moved);
      const merged = normalizeStopOrders([currentOrigin, ...reordered, currentDestination].filter(Boolean));
      return { ...current, metadata: { ...(current.metadata || {}), waypoints: merged } };
    });
  }, []);

  const handleAddStopFromMap = (coords) => {
    const [lat, lng] = coords;
    updateWaypoint("stop", { id: uid(), type: "stop", lat, lng, label: `Destino (${lat.toFixed(4)}, ${lng.toFixed(4)})` }, stops.length);
  };

  const handleAddStop = useCallback(() => {
    const id = uid();
    updateWaypoint("stop", { id, type: "stop", lat: null, lng: null, label: "" }, stops.length);
    setPendingFocusId(id);
  }, [stops.length, updateWaypoint]);

  const handleStopDragStart = useCallback(
    (stopId) => (event) => {
      if (!stopId) return;
      setDraggingStopId(stopId);
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", String(stopId));
    },
    [],
  );

  const handleStopDragEnd = useCallback(() => {
    setDraggingStopId(null);
    setDragOverIndex(null);
  }, []);

  const handleStopDragOver = useCallback(
    (index) => (event) => {
      event.preventDefault();
      if (dragOverIndex !== index) {
        setDragOverIndex(index);
      }
    },
    [dragOverIndex],
  );

  const handleStopDrop = useCallback(
    (index) => (event) => {
      event.preventDefault();
      const payloadId = draggingStopId || event.dataTransfer.getData("text/plain");
      if (!payloadId) return;
      const fromIndex = stops.findIndex((stop) => String(stop.id) === String(payloadId));
      if (fromIndex < 0) {
        setDraggingStopId(null);
        setDragOverIndex(null);
        return;
      }
      reorderStops(fromIndex, index);
      setDraggingStopId(null);
      setDragOverIndex(null);
    },
    [draggingStopId, reorderStops, stops],
  );

  const buildRouteFromWaypoints = async () => {
    if (!originPoint || !destinationPoint) {
      showToast("Defina origem (A) e destino (B) para gerar a rota.", "warning");
      return;
    }
    const invalidStops = stops.filter((stop) => !isValidLatLng(stop));
    if (invalidStops.length) {
      showToast("Preencha ou remova os destinos adicionais vazios.", "warning");
      return;
    }
    const ordered = normalizeRoutingWaypoints([originPoint, destinationPoint, ...stops]);
    setIsRouting(true);
    try {
      let path = [];
      try {
        path = await buildOsrmPath(ordered);
      } catch (osrmError) {
        console.warn("OSRM indisponível, tentando GraphHopper", osrmError);
      }
      if (!path?.length) {
        const graphhopperPath = await buildGraphHopperPath(ordered);
        if (graphhopperPath?.length) path = graphhopperPath;
      }
      if (!path?.length) {
        showToast("Não foi possível calcular a rota agora. Verifique conexão e tente novamente.", "warning");
        return;
      }
      const simplified = simplifyPath(deduplicatePath(path), 0.00005);
      const nextRoute = {
        ...draftRoute,
        points: simplified,
        metadata: {
          ...(draftRoute.metadata || {}),
          source: draftRoute.metadata?.source || "osrm",
          waypoints: normalizeStopOrders(ordered.map((item) => ({ ...item, id: item.id || uid(), type: item.type || "stop" }))),
        },
      };
      userActionRef.current = true;
      setDraftRoute(nextRoute);
    } catch (error) {
      console.error(error);
      showToast(error?.message || "Falha ao gerar rota.", "warning");
    } finally {
      setIsRouting(false);
    }
  };

  const handleHistoryRoute = async (event) => {
    event.preventDefault();
    if (!draftRoute.name || !draftRoute.name.trim()) {
      showToast("Informe um nome para a rota antes de salvar.", "warning");
      return;
    }
    if (!historyDeviceId || !historyForm.from || !historyForm.to) {
      showToast("Selecione um veículo com equipamento vinculado e informe o período.", "warning");
      return;
    }
    setLoadingHistory(true);
    try {
      const params = {
        deviceId: historyDeviceId,
        vehicleId: historyForm.vehicleId || vehicleByDeviceId.get(String(historyDeviceId))?.id,
        from: new Date(historyForm.from).toISOString(),
        to: new Date(historyForm.to).toISOString(),
      };
      let positions = [];
      try {
        const response = await api.get("reports/route", { params });
        positions = extractPositionsFromPayload(response?.data);
      } catch (firstError) {
        console.warn("Fallback para /traccar/reports/route", firstError);
      }
      if (!positions.length) {
        try {
          const response = await api.get(API_ROUTES.reports.route, { params });
          positions = extractPositionsFromPayload(response?.data);
        } catch (secondError) {
          console.warn("Falha no fallback /traccar/reports/route", secondError);
        }
      }
      if (!positions.length) {
        throw new Error("Nenhum ponto encontrado para o período informado.");
      }
      const simplified = simplifyPath(deduplicatePath(positions), 0.00005);
      const historyRoute = withWaypoints({
        ...draftRoute,
        id: null,
        name: draftRoute.name.trim(),
        points: simplified,
        metadata: {
          ...(draftRoute.metadata || {}),
          source: "history",
          history: {
            vehicleId: historyForm.vehicleId || vehicleByDeviceId.get(String(historyDeviceId))?.id,
            deviceId: historyDeviceId,
            from: params.from,
            to: params.to,
          },
        },
      });
      userActionRef.current = true;
      setDraftRoute(historyRoute);
      const saved = await createRoute(historyRoute);
    } catch (error) {
      console.error(error);
      showToast(error?.message || "Não foi possível gerar a rota do histórico.", "warning");
    } finally {
      setLoadingHistory(false);
    }
  };

  const handleImportKml = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    const placemarks = parseKmlPlacemarks(text).filter((item) => item.type === "polyline");
    if (!placemarks.length) {
      showToast("Nenhuma rota encontrada no KML", "warning");
      return;
    }
    for (const item of placemarks) {
      const route = withWaypoints({
        ...emptyRoute(),
        name: item.name || "Rota importada",
        points: item.points,
        metadata: { source: "kml" },
      });
      try {
      const saved = await createRoute(route);
      if (saved) {
        userActionRef.current = true;
      }
    } catch (importError) {
        console.error("Falha ao salvar rota importada", importError);
      }
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleExportKml = () => {
    const exportable = draftRoute.points?.length
      ? [...routes.filter((item) => String(item.id) !== String(draftRoute.id)), draftRoute]
      : routes;
    const kml = exportRoutesToKml(exportable);
    downloadKml("routes.kml", kml);
  };

  const handleAddressChange = useCallback((value) => {
    setAddressValue(value || { formattedAddress: "" });
  }, []);

  const handleSelectAddress = useCallback(
    (payload) => {
      if (!payload) return;
      setAddressValue(payload);
      const lat = Number(payload.lat);
      const lng = Number(payload.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
      focusDevice({ lat, lng }, { zoom: 17, animate: true, reason: "ADDRESS_SELECT" });
      setSearchMarker({ lat, lng, label: payload.formattedAddress || payload.label || "Endereço encontrado" });
    },
    [focusDevice],
  );
  const handleClearSearch = useCallback(() => {
    setAddressValue({ formattedAddress: "" });
    setSearchMarker(null);
  }, []);

  const normalizedDraftPoints = useMemo(() => normalizeRoutePoints(draftRoute.points), [draftRoute.points]);
  const normalizedRoutes = useMemo(
    () =>
      (Array.isArray(routes) ? routes : []).map((route) => ({
        ...route,
        points: normalizeRoutePoints(route.points),
      })),
    [routes],
  );
  useEffect(() => {
    if (!userActionRef.current) return;
    if (!normalizedDraftPoints.length) return;
    focusGeometry(normalizedDraftPoints, { padding: [32, 32], maxZoom: 16 }, "ROUTE_SELECT");
    userActionRef.current = false;
  }, [focusGeometry, normalizedDraftPoints]);

  const showEditorCard = showEditorPanel && activePanel === "editor";
  const showRoutesCard = showRoutesPanel && activePanel === "routes";
  const showToolsCard = true;
  const editorTitle = editorMode === "history" ? "Modo histórico" : "Modo manual";
  const editorModeLabel = isEditing ? "Editando rota" : "Nova rota";

  useEffect(() => {
    refreshMap();
  }, [mapInvalidateKey, refreshMap]);

  if (accessError) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center px-4 py-10">
        <div className="w-full max-w-xl rounded-2xl border border-white/10 bg-white/5 p-6 text-white">
          <h2 className="text-lg font-semibold">Sem acesso a este módulo</h2>
          <p className="mt-2 text-sm text-white/60">{accessError.message || "Você não tem acesso às rotas deste cliente."}</p>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="btn btn-outline"
              onClick={() => navigate(-1)}
            >
              Voltar
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => navigate("/home")}
            >
              Trocar cliente
            </button>
          </div>
        </div>
      </div>
    );
  }

  const baseLayer = mapLayer || MAP_LAYER_FALLBACK;
  const tileUrl = baseLayer?.url || "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
  const tileAttribution =
    baseLayer?.attribution || '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';
  const tileSubdomains = baseLayer?.subdomains ?? "abc";
  const tileMaxZoom = baseLayer?.maxZoom;

  return (
    <div className="map-page">
      {toast && (
        <div
          className={
            "fixed right-4 top-4 z-50 rounded-lg border px-4 py-3 text-sm shadow-lg " +
            (toast.type === "warning"
              ? "border-amber-500/40 bg-amber-500/20 text-amber-50"
              : "border-emerald-500/40 bg-emerald-500/20 text-emerald-50")
          }
        >
          {toast.message}
        </div>
      )}
      <div className="map-container">
        <AppMap
          ref={mapRef}
          scrollWheelZoom
          zoomControl={false}
          zoom={12}
          invalidateKey={mapInvalidateKey}
          whenReady={handleMapReady}
        >
          <TileLayer url={tileUrl} attribution={tileAttribution} subdomains={tileSubdomains} maxZoom={tileMaxZoom} />
          <MapClickHandler enabled={mapAddsStops} onAdd={handleAddStopFromMap} />
          {searchMarker && searchIcon && (
            <Marker position={[searchMarker.lat, searchMarker.lng]} icon={searchIcon}>
              <Tooltip direction="top" sticky>
                {searchMarker.label || "Endereço encontrado"}
              </Tooltip>
            </Marker>
          )}
          {normalizedRoutes
            .filter((route) => route.points.length && (!draftRoute.id || route.id !== draftRoute.id))
            .map((route) => (
              <Polyline key={route.id} positions={route.points} pathOptions={{ color: "#475569", weight: 3, opacity: 0.4 }} />
            ))}
          {normalizedDraftPoints.length ? (
            <Polyline positions={normalizedDraftPoints} pathOptions={{ color: "#22d3ee", weight: 5 }} />
          ) : null}
          {originPoint && originIcon ? (
            <Marker position={[originPoint.lat, originPoint.lng]} icon={originIcon} />
          ) : null}
          {destinationPoint && destinationIcon ? (
            <Marker position={[destinationPoint.lat, destinationPoint.lng]} icon={destinationIcon} />
          ) : null}
          {stops.map((stop, index) =>
            isValidLatLng(stop) ? (
              <Marker key={stop.id} position={[stop.lat, stop.lng]} icon={stopIcons[index]} />
            ) : null,
          )}
        </AppMap>
      </div>

      <div className="pointer-events-none absolute inset-0 z-20">
        <div className="pointer-events-auto absolute left-4 top-4 flex w-fit max-w-[calc(100vw-2rem)] max-h-[calc(100vh-2rem)] flex-col items-start gap-3 overflow-y-auto pr-1">
          {showToolsCard && (
            <SidebarCard className="w-[640px] max-w-[calc(100vw-2rem)] md:w-[700px] lg:w-[740px]">
              <div className="flex flex-nowrap items-center gap-3 overflow-x-auto pb-1">
                <div className="flex min-w-[280px] flex-1 items-center gap-2">
                  <AddressAutocomplete
                    label={null}
                    value={addressValue}
                    onChange={handleAddressChange}
                    onSelect={handleSelectAddress}
                    onClear={handleClearSearch}
                    variant="toolbar"
                    portalSuggestions
                    containerClassName="flex-1 min-w-0"
                    placeholder="Buscar endereço rápido"
                    mapPreferences={mapPreferences}
                  />
                  <div className="flex shrink-0 items-center gap-1">
                    <ToolbarButton
                      icon={List}
                      title="Minhas rotas"
                      iconSize={18}
                      active={activePanel === "routes"}
                      onClick={() => handlePanelToggle("routes")}
                    />
                    <ToolbarButton
                      icon={Clock3}
                      title="Criar rotas por histórico"
                      iconSize={18}
                      active={activePanel === "editor" && editorMode === "history"}
                      onClick={() => {
                        setEditorMode("history");
                        setActivePanel("editor");
                        setShowEditorPanel(true);
                        resetAutocomplete();
                      }}
                    />
                  </div>
                </div>
                <div className="flex min-w-max shrink-0 items-center gap-2">
                  <ToolbarButton icon={Square} title="Nova rota" iconSize={18} onClick={handleStartManualRoute} />
                  <ToolbarButton icon={FileUp} title="Importar KML" iconSize={18} onClick={() => fileInputRef.current?.click()} />
                  <ToolbarButton icon={Download} title="Exportar KML" iconSize={18} onClick={handleExportKml} />
                  <ToolbarButton icon={Save} title="Salvar rota" iconSize={18} onClick={handleSave} disabled={saving} />
                  <ToolbarButton icon={Undo2} title="Cancelar alterações" iconSize={18} onClick={handleCancel} disabled={!isDraftDirty} />
                </div>
              </div>
            </SidebarCard>
          )}

          {showRoutesCard && (
            <SidebarCard className="w-[440px] md:w-[460px]">
              <RoutePanel
                routes={filteredRoutes}
                activeRouteId={activeRouteId}
                searchTerm={routeFilter}
                onSearch={setRouteFilter}
                onSelect={handleSelectRoute}
                onEdit={handleEditRoute}
                onDelete={handleDeleteRoute}
                onExport={handleExportSingle}
                loading={loadingRoutes}
              />
            </SidebarCard>
          )}

          {showEditorCard && (
            <SidebarCard className="w-[440px] md:w-[460px] min-h-[calc(100vh-8rem)]">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-[11px] uppercase tracking-[0.1em] text-white/60">Rotas</p>
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-sm font-semibold text-white">{editorTitle}</h2>
                    <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] uppercase tracking-[0.12em] text-white/60">
                      {editorModeLabel}
                    </span>
                  </div>
                </div>
              </div>

              <div className="mt-3 max-h-[calc(100vh-20rem)] overflow-y-auto pr-1">
                {editorMode === "history" ? (
                  <form className="space-y-3" onSubmit={handleHistoryRoute}>
                    <Input
                      label="Nome da rota"
                      value={draftRoute.name}
                      onChange={(event) => setDraftRoute((current) => ({ ...current, name: event.target.value }))}
                      className="map-compact-input"
                    />
                    <Input
                      label="Largura do corredor (m)"
                      type="number"
                      min="10"
                      step="10"
                      value={draftRoute.metadata?.xdmBufferMeters ?? 150}
                      onChange={(event) => {
                        const rawValue = event.target.value;
                        const parsed = rawValue === "" ? null : Number(rawValue);
                        setDraftRoute((current) => ({
                          ...current,
                          metadata: {
                            ...(current.metadata || {}),
                            xdmBufferMeters: Number.isFinite(parsed) && parsed > 0 ? parsed : null,
                          },
                        }));
                      }}
                      className="map-compact-input"
                    />
                    <Select
                      value={historyForm.vehicleId}
                      onChange={(event) => setHistoryForm((current) => ({ ...current, vehicleId: event.target.value }))}
                      className="map-compact-input text-xs"
                    >
                      <option value="">Selecione um veículo</option>
                      {vehicleOptions.map((vehicle) => (
                        <option key={vehicle.value} value={vehicle.value}>
                          {vehicle.label} {vehicle.hasDevice ? "" : "— Sem equipamento vinculado"}
                        </option>
                      ))}
                    </Select>
                    {loadingVehicles && <p className="text-xs text-white/60">Carregando veículos…</p>}
                    {vehiclesError && <p className="text-xs text-red-300">{vehiclesError.message}</p>}
                    {historyForm.vehicleId && !historyDeviceId && (
                      <p className="text-xs text-amber-200/80">Sem equipamento vinculado para este veículo.</p>
                    )}

                    <div className="grid gap-2 md:grid-cols-2">
                      <Input
                        label="Início"
                        type="datetime-local"
                        value={historyForm.from}
                        onChange={(event) => setHistoryForm((current) => ({ ...current, from: event.target.value }))}
                        className="map-compact-input"
                      />
                      <Input
                        label="Fim"
                        type="datetime-local"
                        value={historyForm.to}
                        onChange={(event) => setHistoryForm((current) => ({ ...current, to: event.target.value }))}
                        className="map-compact-input"
                      />
                    </div>

                    {(historyVehicle || historyForm.from || historyForm.to) && (
                      <div className="rounded-xl border border-white/10 bg-white/5 p-3 text-xs text-white/70">
                        <p>Veículo: {historyVehicle?.plate || historyVehicle?.name || "—"}</p>
                        <p>Período: {historyForm.from || "—"} → {historyForm.to || "—"}</p>
                      </div>
                    )}

                    <Button
                      type="submit"
                      disabled={loadingHistory || !historyDeviceId}
                      icon={Clock3}
                      variant={loadingHistory ? "danger" : "primary"}
                    >
                      {loadingHistory ? "Buscando histórico..." : "Gerar rota do histórico"}
                    </Button>
                  </form>
                ) : (
                  <div className="space-y-3">
                    <Input
                      label="Nome da rota"
                      value={draftRoute.name}
                      onChange={(event) => setDraftRoute((current) => ({ ...current, name: event.target.value }))}
                      className="map-compact-input"
                    />
                    <Input
                      label="Largura do corredor (m)"
                      type="number"
                      min="10"
                      step="10"
                      value={draftRoute.metadata?.xdmBufferMeters ?? 150}
                      onChange={(event) => {
                        const rawValue = event.target.value;
                        const parsed = rawValue === "" ? null : Number(rawValue);
                        setDraftRoute((current) => ({
                          ...current,
                          metadata: {
                            ...(current.metadata || {}),
                            xdmBufferMeters: Number.isFinite(parsed) && parsed > 0 ? parsed : null,
                          },
                        }));
                      }}
                      className="map-compact-input"
                    />

                    <div className="space-y-2">
                      <p className="text-sm font-semibold text-white">Pontos da rota</p>
                      <div className="route-waypoint-list">
                        <div className="route-waypoint-row">
                          <span className="route-waypoint-marker">A</span>
                          <div className="route-waypoint-body">
                            <WaypointInput
                              label="Origem"
                              hideLabel
                              placeholder="Digite um endereço..."
                              value={origin}
                              onChange={(value) => updateWaypoint("origin", value)}
                              onClear={() => removeWaypoint("origin")}
                              resetKey={autocompleteResetKey}
                            />
                          </div>
                        </div>
                        <div className="route-waypoint-row">
                          <span className="route-waypoint-marker">B</span>
                          <div className="route-waypoint-body">
                            <WaypointInput
                              label="Destino"
                              hideLabel
                              placeholder="Digite um endereço..."
                              value={destination}
                              onChange={(value) => updateWaypoint("destination", value)}
                              onClear={() => removeWaypoint("destination")}
                              resetKey={autocompleteResetKey}
                            />
                          </div>
                        </div>
                        {stops.map((stop, index) => {
                          const letter = waypointLetter(index + 2);
                          const isDragging = String(draggingStopId) === String(stop.id);
                          const isOver = dragOverIndex === index;
                          return (
                            <div
                              key={stop.id}
                              className={`route-waypoint-row ${isOver ? "is-over" : ""} ${isDragging ? "is-dragging" : ""}`.trim()}
                              onDragOver={handleStopDragOver(index)}
                              onDrop={handleStopDrop(index)}
                            >
                              <span className="route-waypoint-marker">{letter}</span>
                              <div className="route-waypoint-body">
                                <WaypointInput
                                  label={`Destino ${letter}`}
                                  hideLabel
                                  placeholder="Digite um endereço..."
                                  value={{ ...stop, order: index }}
                                  onChange={(value) => updateWaypoint("stop", value, index)}
                                  onClear={() => clearStop(index, stop.id)}
                                  resetKey={autocompleteResetKey}
                                  autoFocus={pendingFocusId === stop.id}
                                  onFocus={() => {
                                    if (pendingFocusId === stop.id) {
                                      setPendingFocusId(null);
                                    }
                                  }}
                                />
                              </div>
                              <div className="route-waypoint-actions">
                                <button
                                  type="button"
                                  className="route-waypoint-handle"
                                  draggable
                                  onDragStart={handleStopDragStart(stop.id)}
                                  onDragEnd={handleStopDragEnd}
                                  title="Arrastar para reordenar"
                                >
                                  <GripVertical size={14} />
                                </button>
                                <button
                                  type="button"
                                  className="route-waypoint-remove"
                                  onClick={() => removeStop(index)}
                                  title="Remover destino"
                                >
                                  <X size={14} />
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                      <button type="button" className="route-waypoint-add" onClick={handleAddStop}>
                        + Adicionar destino
                      </button>
                      <label className="flex cursor-pointer items-center gap-2 text-xs text-white/70">
                        <input
                          type="checkbox"
                          className="rounded border-white/30 bg-transparent"
                          checked={mapAddsStops}
                          onChange={(event) => setMapAddsStops(event.target.checked)}
                        />
                        Clique no mapa para adicionar destinos.
                      </label>
                    </div>

                    <div className="flex flex-wrap gap-3">
                      <Button
                        onClick={buildRouteFromWaypoints}
                        disabled={isRouting}
                        icon={Play}
                        variant={isRouting ? "danger" : "primary"}
                      >
                        {isRouting ? "Gerando rota..." : "Gerar rota"}
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </SidebarCard>
          )}
        </div>

        <MapToolbar
          className="floating-toolbar pointer-events-auto"
          map={mapInstance}
          zoomControls={
            <div ref={mapLayerButtonRef} className="map-layer-control">
              <button
                type="button"
                className={`map-tool-button map-toolbar-zoom-button ${mapLayerMenuOpen ? "is-active" : ""}`.trim()}
                onClick={() => setMapLayerMenuOpen((open) => !open)}
                title="Selecionar mapa"
                aria-label="Selecionar mapa"
              >
                <Layers style={{ width: 16, height: 16 }} />
              </button>
              {mapLayerMenuOpen && (
                <div className="map-layer-popover">
                  <p className="map-layer-popover-title">Selecionar mapa</p>
                  <div className="map-layer-options">
                    {mapLayerOptions.map((option) => {
                      const isActive = option.layer?.key === mapLayer?.key;
                      return (
                        <button
                          key={option.id}
                          type="button"
                          className={`map-layer-option ${isActive ? "is-active" : ""}`.trim()}
                          onClick={() => {
                            if (option.layer?.key) {
                              setMapLayerKey(option.layer.key);
                            }
                            setMapLayerMenuOpen(false);
                          }}
                        >
                          <span className="map-layer-option-label">{option.label}</span>
                          {option.layer?.description ? (
                            <span className="map-layer-option-subtitle">{option.layer.description}</span>
                          ) : null}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          }
        >
          <div className="relative">
            <ToolbarButton
              icon={LayoutGrid}
              title="Layout"
              className={layoutMenuOpen ? "is-active" : ""}
              onClick={() => setLayoutMenuOpen((open) => !open)}
            />
            {layoutMenuOpen && (
              <div className="layout-popover right-14 top-0">
                <label className="layout-toggle">
                  <input
                    type="checkbox"
                    checked={routesTopbarVisible}
                    onChange={() => setRoutesTopbarVisible(!routesTopbarVisible)}
                  />
                  <span>Mostrar Topbar</span>
                </label>
                <label className="layout-toggle">
                  <input
                    type="checkbox"
                    checked={showEditorPanel}
                    onChange={() => setShowEditorPanel((value) => !value)}
                  />
                  <span>Editor</span>
                </label>
                <label className="layout-toggle">
                  <input
                    type="checkbox"
                    checked={showRoutesPanel}
                    onChange={() => setShowRoutesPanel((value) => !value)}
                  />
                  <span>Minhas rotas</span>
                </label>
              </div>
            )}
          </div>
        </MapToolbar>
      </div>

      <div className="geofence-status-stack">
        <span className="map-status-pill">
          <span className="dot" />
          {routes.length} rotas
        </span>
        {mapAddsStops && (
          <span className="map-status-pill border-primary/50 bg-primary/10 text-cyan-100">
            Clique no mapa para adicionar destinos
          </span>
        )}
        {saving && <span className="map-status-pill border-primary/50 bg-primary/10 text-cyan-100">Salvando...</span>}
      </div>

      <input ref={fileInputRef} type="file" accept=".kml" className="hidden" onChange={handleImportKml} />
      <PageToast toast={toast} />
    </div>
  );
}
