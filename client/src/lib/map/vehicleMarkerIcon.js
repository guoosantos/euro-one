import L from "leaflet";

import { getVehicleIconSvg, resolveVehicleIconType } from "../icons/vehicleIcons.js";

const markerIconCache = new Map();

function normalizeCandidate(value) {
  if (value === null || value === undefined) return null;
  const stringValue = String(value).trim();
  return stringValue || null;
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
  const heading = Number.isFinite(bearing) ? Math.round(bearing) : 0;
  const labelText = (label || plate || "").trim();
  const cacheKey = `${resolvedType || "default"}-${color || "default"}-${accentColor || "none"}-${heading}-${muted}-${
    labelText || "-"
  }`;
  if (markerIconCache.has(cacheKey)) return markerIconCache.get(cacheKey);

  const iconSvg = getVehicleIconSvg(resolvedType);
  const arrowColor = color || "#60a5fa";
  const ringColor = accentColor || "rgba(148,163,184,0.35)";
  const baseColor = color || "#94a3b8";
  const opacity = muted ? 0.55 : 1;
  const labelHtml = labelText
    ? `<div style="margin-top:4px;max-width:120px;padding:2px 6px;border-radius:999px;background:rgba(15,23,42,0.85);border:1px solid rgba(148,163,184,0.35);color:#f8fafc;font-size:10px;font-weight:700;letter-spacing:0.03em;text-transform:uppercase;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
        ${labelText}
      </div>`
    : "";

  const html = `
    <div style="position:relative;display:flex;flex-direction:column;align-items:center;justify-content:center;width:120px;height:56px;opacity:${opacity};filter:drop-shadow(0 8px 14px rgba(0,0,0,0.35));">
      <div style="position:absolute;top:4px;left:50%;transform:translate(-50%,-70%) rotate(${heading}deg);transform-origin:50% 100%;width:20px;height:20px;filter:drop-shadow(0 2px 4px rgba(0,0,0,0.45));">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="${arrowColor}" stroke="rgba(15,23,42,0.8)" stroke-width="1.2">
          <path d="M12 2l7 9h-4v11h-6V11H5z" />
        </svg>
      </div>
      <div style="display:flex;align-items:center;justify-content:center;width:32px;height:32px;border-radius:12px;background:rgba(15,23,42,0.9);border:1px solid ${ringColor};box-shadow:0 6px 12px rgba(0,0,0,0.35);color:${baseColor};">
        <div style="width:18px;height:18px;display:flex;align-items:center;justify-content:center;">${iconSvg}</div>
      </div>
      ${labelHtml}
    </div>
  `;

  const icon = L.divIcon({
    className: "fleet-marker",
    html,
    iconSize: [120, 56],
    iconAnchor: [60, 26],
    popupAnchor: [0, -30],
  });

  markerIconCache.set(cacheKey, icon);
  return icon;
}

export default createVehicleMarkerIcon;
