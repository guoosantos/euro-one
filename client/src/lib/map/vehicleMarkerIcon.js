import L from "leaflet";

import { getVehicleIconSvg, resolveVehicleIconType } from "../icons/vehicleIcons.js";

const markerIconCache = new Map();
const HEADING_STEP_DEGREES = 5;
const MARKER_ICON_SIZE = [64, 58];
const MARKER_ICON_ANCHOR = [32, 56];
const MARKER_POPUP_ANCHOR = [0, -48];

function normalizeCandidate(value) {
  if (value === null || value === undefined) return null;
  const stringValue = String(value).trim();
  return stringValue || null;
}

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function resolveMarkerIconType(payload = {}, fallbackCandidates = []) {
  const attributes = payload?.attributes || {};
  const extraCandidates = Array.isArray(fallbackCandidates) ? fallbackCandidates : [fallbackCandidates];
  const candidates = [
    payload?.iconType,
    attributes.iconType,
    attributes.vehicleType,
    payload?.vehicleType,
    payload?.type,
    attributes.type,
    attributes.category,
    payload?.category,
    ...extraCandidates,
  ]
    .map(normalizeCandidate)
    .filter(Boolean);

  const chosen = candidates.find(Boolean) || "default";
  return resolveVehicleIconType(chosen);
}

export function createVehicleMarkerIcon({
  bearing = 0,
  color,
  accentColor,
  iconType,
  label,
  plate,
  muted = false,
} = {}) {
  if (!L?.divIcon) return null;

  const resolvedType = resolveMarkerIconType({ iconType });
  const rawHeading = Number.isFinite(bearing) ? Number(bearing) : 0;
  const heading = Math.round(rawHeading / HEADING_STEP_DEGREES) * HEADING_STEP_DEGREES;
  const labelText = escapeHtml((label || plate || "").trim());
  const cacheKey = `${resolvedType || "default"}-${color || "default"}-${accentColor || "none"}-${heading}-${muted}-${
    labelText || "-"
  }`;
  if (markerIconCache.has(cacheKey)) return markerIconCache.get(cacheKey);

  const arrowColor = color || "#60a5fa";
  const ringColor = accentColor || "rgba(148,163,184,0.35)";
  const baseColor = color || "#94a3b8";
  const rawIconSvg = getVehicleIconSvg(resolvedType);
  const iconSvg = rawIconSvg
    ? rawIconSvg
        .replace(/stroke=["']currentColor["']/g, `stroke="${baseColor}"`)
        .replace(/fill=["']currentColor["']/g, `fill="${baseColor}"`)
        .replace("<svg", `<svg style="color:${baseColor};stroke:${baseColor};"`)
    : "";
  const opacity = muted ? 0.55 : 1;
  const labelHtml = labelText ? `<div class="fleet-marker__label">${labelText}</div>` : "";

  const html = `
    <div class="fleet-marker__wrap" style="opacity:${opacity};">
      <div class="fleet-marker__stack" style="--fleet-marker-heading:${heading}deg;">
        <div class="fleet-marker__base" style="border:1px solid ${ringColor};color:${baseColor};">
          <div class="fleet-marker__icon">${iconSvg}</div>
          <div class="fleet-marker__arrow">
            <svg viewBox="0 0 24 24" fill="${arrowColor}" stroke="rgba(15,23,42,0.8)" stroke-width="1.2">
              <path d="M12 2l7 9h-4v11h-6V11H5z" />
            </svg>
          </div>
        </div>
        ${labelHtml}
      </div>
    </div>
  `;

  const icon = L.divIcon({
    className: "fleet-marker",
    html,
    iconSize: MARKER_ICON_SIZE,
    iconAnchor: MARKER_ICON_ANCHOR,
    popupAnchor: MARKER_POPUP_ANCHOR,
  });

  markerIconCache.set(cacheKey, icon);
  return icon;
}

export default createVehicleMarkerIcon;
