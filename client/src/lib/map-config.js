const DEFAULT_SELECT_ZOOM = 15;
const PROVIDER_MAX_ZOOM_FALLBACK = 18;

function coerceNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function pickAttribute(attributes, key) {
  if (!attributes) return null;
  if (Object.prototype.hasOwnProperty.call(attributes, key)) return attributes[key];
  if (!key.includes(".")) return null;
  const [root, nested] = key.split(".");
  return attributes[root]?.[nested] ?? null;
}

export function normaliseGeocoderUrl(raw, { defaultValue = null } = {}) {
  const fallback = defaultValue || null;
  if (!raw) return fallback;
  const trimmed = String(raw).trim();
  if (!trimmed) return fallback;
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed.replace(/^\/*/, "")}`;
  try {
    const url = new URL(withProtocol);
    url.pathname = url.pathname.replace(/\/+$/, "");
    return url.toString();
  } catch (_error) {
    return fallback;
  }
}

export function resolveMapPreferences(attributes = null, env = import.meta?.env ?? {}) {
  const selectZoomRaw =
    pickAttribute(attributes, "web.selectZoom") ?? pickAttribute(attributes, "selectZoom") ?? env?.VITE_WEB_SELECT_ZOOM ?? env?.VITE_SELECT_ZOOM;
  const maxZoomRaw =
    pickAttribute(attributes, "web.maxZoom") ?? pickAttribute(attributes, "maxZoom") ?? env?.VITE_WEB_MAX_ZOOM ?? env?.VITE_MAX_ZOOM;
  const geocoderUrlRaw =
    pickAttribute(attributes, "web.geocoderUrl") ?? pickAttribute(attributes, "geocoderUrl") ?? env?.VITE_WEB_GEOCODER_URL ?? env?.VITE_GEOCODER_URL;

  const selectZoom = coerceNumber(selectZoomRaw) || DEFAULT_SELECT_ZOOM;
  const maxZoom = coerceNumber(maxZoomRaw) && Number(maxZoomRaw) > 0 ? Number(maxZoomRaw) : null;
  const geocoderUrl = normaliseGeocoderUrl(geocoderUrlRaw, { defaultValue: null });
  const shouldWarnMaxZoom = Number.isFinite(maxZoom) && maxZoom < 3;

  return { selectZoom, maxZoom, geocoderUrl, shouldWarnMaxZoom };
}

export function buildEffectiveMaxZoom(configMaxZoom, providerMaxZoom = PROVIDER_MAX_ZOOM_FALLBACK) {
  const provider = coerceNumber(providerMaxZoom) && providerMaxZoom > 0 ? Number(providerMaxZoom) : PROVIDER_MAX_ZOOM_FALLBACK;
  const configured = coerceNumber(configMaxZoom);
  if (!configured || configured <= 0) return provider;
  return Math.min(configured, provider);
}

export function resolveFocusZoom({
  requestedZoom,
  selectZoom = DEFAULT_SELECT_ZOOM,
  currentZoom = null,
  maxZoom = null,
  providerMaxZoom = PROVIDER_MAX_ZOOM_FALLBACK,
} = {}) {
  const baseSelect = Number.isFinite(selectZoom) && selectZoom > 0 ? selectZoom : DEFAULT_SELECT_ZOOM;
  const desired = Number.isFinite(requestedZoom) && requestedZoom > 0 ? requestedZoom : baseSelect;
  const effectiveMaxZoom = buildEffectiveMaxZoom(maxZoom, providerMaxZoom);
  const current = Number.isFinite(currentZoom) ? currentZoom : null;
  const target = Math.min(Math.max(desired, baseSelect, current ?? desired), effectiveMaxZoom);
  return { zoom: target, effectiveMaxZoom };
}

export { DEFAULT_SELECT_ZOOM, PROVIDER_MAX_ZOOM_FALLBACK };
