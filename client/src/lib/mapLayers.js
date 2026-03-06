const DEFAULT_TILE_URL =
  import.meta.env.VITE_MAP_TILE_URL || "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";

const MAPBOX_TOKEN = (import.meta.env.VITE_MAPBOX_TOKEN || "").trim();

const GOOGLE_MAPS_KEY = import.meta.env.VITE_GOOGLE_MAPS_KEY;
const GOOGLE_TILE_KEY_PARAM = GOOGLE_MAPS_KEY ? `&key=${GOOGLE_MAPS_KEY}` : "";
const buildGoogleTileUrl = (layer) =>
  GOOGLE_MAPS_KEY ? `https://{s}.google.com/vt/lyrs=${layer}&x={x}&y={y}&z={z}&hl=pt-BR${GOOGLE_TILE_KEY_PARAM}` : null;

const normaliseMapboxStyleId = (primary, fallback) => {
  const candidate = String(primary || fallback || "").trim().replace(/^\/+|\/+$/g, "");
  if (!candidate) return null;
  if (candidate.includes("/")) return candidate;
  return `mapbox/${candidate}`;
};

const buildMapboxTileUrl = (styleId) => {
  if (!MAPBOX_TOKEN || !styleId) return null;
  return `https://api.mapbox.com/styles/v1/${styleId}/tiles/256/{z}/{x}/{y}{r}?access_token=${MAPBOX_TOKEN}`;
};

const buildMapboxStyleUrl = (styleId) => (styleId ? `mapbox://styles/${styleId}` : null);

const GOOGLE_ROAD_TILE_URL = import.meta.env.VITE_GOOGLE_ROAD_TILE_URL || buildGoogleTileUrl("m");
const GOOGLE_SATELLITE_TILE_URL = import.meta.env.VITE_GOOGLE_SATELLITE_TILE_URL || buildGoogleTileUrl("s");
const GOOGLE_HYBRID_TILE_URL = import.meta.env.VITE_GOOGLE_HYBRID_TILE_URL || buildGoogleTileUrl("y");

const MAPBOX_STREETS_STYLE_ID = normaliseMapboxStyleId("mapbox/streets-v12", "mapbox/streets-v12");
const MAPBOX_NAV_DAY_STYLE_ID = normaliseMapboxStyleId("mapbox/navigation-day-v1", "mapbox/streets-v12");
const MAPBOX_NAV_NIGHT_STYLE_ID = normaliseMapboxStyleId("mapbox/navigation-night-v1", "mapbox/navigation-night-v1");
const MAPBOX_SATELLITE_STYLE_ID = normaliseMapboxStyleId("mapbox/satellite-streets-v12", "mapbox/satellite-streets-v12");
const MAPBOX_HYBRID_STYLE_ID = normaliseMapboxStyleId("mapbox/satellite-streets-v12", "mapbox/satellite-streets-v12");

const MAPBOX_STREETS_TILE_URL = buildMapboxTileUrl(MAPBOX_STREETS_STYLE_ID);
const MAPBOX_LIGHT_TILE_URL = buildMapboxTileUrl(MAPBOX_NAV_DAY_STYLE_ID);
const MAPBOX_DARK_TILE_URL = buildMapboxTileUrl(MAPBOX_NAV_NIGHT_STYLE_ID);
const MAPBOX_SATELLITE_TILE_URL = buildMapboxTileUrl(MAPBOX_SATELLITE_STYLE_ID);
const MAPBOX_HYBRID_TILE_URL = buildMapboxTileUrl(MAPBOX_HYBRID_STYLE_ID);

const MAPBOX_STREETS_STYLE_URL = buildMapboxStyleUrl(MAPBOX_STREETS_STYLE_ID);
const MAPBOX_LIGHT_STYLE_URL = buildMapboxStyleUrl(MAPBOX_NAV_DAY_STYLE_ID);
const MAPBOX_DARK_STYLE_URL = buildMapboxStyleUrl(MAPBOX_NAV_NIGHT_STYLE_ID);
const MAPBOX_SATELLITE_STYLE_URL = buildMapboxStyleUrl(MAPBOX_SATELLITE_STYLE_ID);
const MAPBOX_HYBRID_STYLE_URL = buildMapboxStyleUrl(MAPBOX_HYBRID_STYLE_ID);

export const MAP_LAYER_STORAGE_KEYS = {
  monitoring: "monitoring.map.layer",
  trips: "trips.map.layer",
  routes: "routes.map.layer",
  geofences: "geofences.map.layer",
  targets: "targets.map.layer",
  itineraries: "itineraries.map.layer",
};

export const BASE_MAP_LAYERS = [
  {
    key: "openstreetmap",
    label: "OpenStreetMap",
    description: "Mapa padrão de ruas",
    url: DEFAULT_TILE_URL,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  },
  {
    key: "osm-hot",
    label: "OpenStreetMap HOT",
    description: "Estilo humanitário (HOT)",
    url: "https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png",
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  },
  {
    key: "opentopomap",
    label: "OpenTopoMap",
    description: "Topografia com relevo",
    url: "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png",
    attribution: 'Map data: &copy; OpenStreetMap contributors, SRTM',
    maxZoom: 17,
  },
  {
    key: "carto-light",
    label: "Carto Basemaps",
    description: "Tema claro estilo Euro One",
    url: "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
    attribution: '&copy; <a href="https://carto.com/attributions">CARTO</a>',
  },
  {
    key: "carto-dark",
    label: "Carto Dark",
    description: "Tema escuro",
    url: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
    attribution: '&copy; <a href="https://carto.com/attributions">CARTO</a>',
  },
  {
    key: "satellite",
    label: "Satélite",
    description: "Imagem de alta resolução (Esri World Imagery)",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    attribution: 'Tiles &copy; Esri — Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community',
    maxZoom: 19,
  },
  {
    key: "hybrid",
    label: "Satélite",
    description: "Satélite com ruas (Esri)",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}",
    attribution: 'Tiles &copy; Esri — Source: Esri',
    maxZoom: 20,
  },
];

const HAS_MAPBOX_LAYERS = Boolean(MAPBOX_TOKEN || MAPBOX_LIGHT_TILE_URL || MAPBOX_DARK_TILE_URL || MAPBOX_STREETS_TILE_URL || MAPBOX_SATELLITE_TILE_URL || MAPBOX_HYBRID_TILE_URL);
const MAPBOX_ATTRIBUTION = '&copy; <a href="https://www.mapbox.com/about/maps/" target="_blank" rel="noreferrer">Mapbox</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

const MAPBOX_LAYERS = [
  {
    key: "mapbox-light",
    label: "Mapbox Claro",
    description: "Mesmo estilo do Mapbox Ruas",
    url: MAPBOX_STREETS_TILE_URL || MAPBOX_LIGHT_TILE_URL,
    styleUrl: MAPBOX_STREETS_STYLE_URL || MAPBOX_LIGHT_STYLE_URL,
    maxZoom: 22,
    attribution: MAPBOX_ATTRIBUTION,
    available: HAS_MAPBOX_LAYERS && Boolean(MAPBOX_LIGHT_TILE_URL),
  },
  {
    key: "mapbox-dark",
    label: "Mapbox Escuro",
    description: "Tema noturno para operação",
    url: MAPBOX_DARK_TILE_URL,
    styleUrl: MAPBOX_DARK_STYLE_URL,
    maxZoom: 22,
    attribution: MAPBOX_ATTRIBUTION,
    available: HAS_MAPBOX_LAYERS && Boolean(MAPBOX_DARK_TILE_URL),
  },
  {
    key: "mapbox-streets",
    label: "Mapbox Ruas",
    description: "Ruas com estilo Mapbox",
    url: MAPBOX_STREETS_TILE_URL,
    styleUrl: MAPBOX_STREETS_STYLE_URL,
    maxZoom: 22,
    attribution: MAPBOX_ATTRIBUTION,
    available: HAS_MAPBOX_LAYERS && Boolean(MAPBOX_STREETS_TILE_URL),
  },
  {
    key: "mapbox-satellite",
    label: "Mapbox Satélite",
    description: "Imagem de satélite com nomes de ruas",
    url: MAPBOX_SATELLITE_TILE_URL,
    styleUrl: MAPBOX_SATELLITE_STYLE_URL,
    maxZoom: 22,
    attribution: MAPBOX_ATTRIBUTION,
    available: HAS_MAPBOX_LAYERS && Boolean(MAPBOX_SATELLITE_TILE_URL),
  },
  {
    key: "mapbox-hybrid",
    label: "Mapbox Híbrido",
    description: "Satélite com ruas Mapbox",
    url: MAPBOX_HYBRID_TILE_URL,
    styleUrl: MAPBOX_HYBRID_STYLE_URL,
    maxZoom: 22,
    attribution: MAPBOX_ATTRIBUTION,
    available: HAS_MAPBOX_LAYERS && Boolean(MAPBOX_HYBRID_TILE_URL),
  },
];

const HAS_GOOGLE_LAYERS = Boolean(GOOGLE_ROAD_TILE_URL || GOOGLE_SATELLITE_TILE_URL || GOOGLE_HYBRID_TILE_URL);

const GOOGLE_LAYERS = [
  {
    key: "google-road",
    label: "Google Estrada",
    description: "Mapa padrão do Google (se habilitado)",
    url: GOOGLE_ROAD_TILE_URL,
    subdomains: ["mt0", "mt1", "mt2", "mt3"],
    maxZoom: 20,
    attribution: "Map data ©2024 Google",
    available: HAS_GOOGLE_LAYERS && Boolean(GOOGLE_ROAD_TILE_URL),
  },
  {
    key: "google-satellite",
    label: "Google Satélite",
    description: "Imagem de satélite Google (se habilitado)",
    url: GOOGLE_SATELLITE_TILE_URL,
    subdomains: ["mt0", "mt1", "mt2", "mt3"],
    maxZoom: 20,
    attribution: "Map data ©2024 Google",
    available: HAS_GOOGLE_LAYERS && Boolean(GOOGLE_SATELLITE_TILE_URL),
  },
  {
    key: "google-hybrid",
    label: "Google Satélite",
    description: "Satélite com ruas Google (se habilitado)",
    url: GOOGLE_HYBRID_TILE_URL,
    subdomains: ["mt0", "mt1", "mt2", "mt3"],
    maxZoom: 20,
    attribution: "Map data ©2024 Google",
    available: HAS_GOOGLE_LAYERS && Boolean(GOOGLE_HYBRID_TILE_URL),
  },
];

export const MAP_LAYER_SECTIONS = [
  { key: "core", label: "OpenStreetMap / Carto / Topo", layers: BASE_MAP_LAYERS },
  {
    key: "mapbox",
    label: "Mapbox",
    disabledMessage: "Mapbox não configurado (adicione VITE_MAPBOX_TOKEN no client/.env)",
    layers: MAPBOX_LAYERS,
  },
  {
    key: "google",
    label: "Google",
    disabledMessage: "Google Maps não configurado (adicione VITE_GOOGLE_MAPS_KEY ou URLs de tile)",
    layers: GOOGLE_LAYERS,
  },
];

export const ENABLED_MAP_LAYERS = MAP_LAYER_SECTIONS.flatMap((section) =>
  section.layers
    .filter((layer) => layer.available !== false && layer.url)
    .map((layer) => ({ ...layer, section: section.key })),
);

const PREFERRED_DEFAULT_LAYER_KEY = "mapbox-light";
const preferredDefaultLayer = ENABLED_MAP_LAYERS.find((layer) => layer.key === PREFERRED_DEFAULT_LAYER_KEY) || null;

export const MAP_LAYER_FALLBACK = ENABLED_MAP_LAYERS[0] || BASE_MAP_LAYERS[0];
export const DEFAULT_MAP_LAYER_KEY =
  preferredDefaultLayer?.key || MAP_LAYER_FALLBACK?.key || BASE_MAP_LAYERS[0]?.key || "openstreetmap";
export const DEFAULT_MAP_LAYER = preferredDefaultLayer || MAP_LAYER_FALLBACK || BASE_MAP_LAYERS[0];

export function getValidMapLayer(key) {
  if (key && ENABLED_MAP_LAYERS.some((layer) => layer.key === key)) {
    return key;
  }
  return DEFAULT_MAP_LAYER_KEY;
}
