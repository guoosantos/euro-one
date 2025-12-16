const DEFAULT_TILE_URL =
  import.meta.env.VITE_MAP_TILE_URL || "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";

const GOOGLE_MAPS_KEY = import.meta.env.VITE_GOOGLE_MAPS_KEY;
const GOOGLE_TILE_KEY_PARAM = GOOGLE_MAPS_KEY ? `&key=${GOOGLE_MAPS_KEY}` : "";
const buildGoogleTileUrl = (layer) =>
  GOOGLE_MAPS_KEY ? `https://{s}.google.com/vt/lyrs=${layer}&x={x}&y={y}&z={z}&hl=pt-BR${GOOGLE_TILE_KEY_PARAM}` : null;

const GOOGLE_ROAD_TILE_URL = import.meta.env.VITE_GOOGLE_ROAD_TILE_URL || buildGoogleTileUrl("m");
const GOOGLE_SATELLITE_TILE_URL = import.meta.env.VITE_GOOGLE_SATELLITE_TILE_URL || buildGoogleTileUrl("s");
const GOOGLE_HYBRID_TILE_URL = import.meta.env.VITE_GOOGLE_HYBRID_TILE_URL || buildGoogleTileUrl("y");

export const MAP_LAYER_STORAGE_KEYS = {
  monitoring: "monitoring.map.layer",
  trips: "trips.map.layer",
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
    description: "Tema claro estilo Traccar",
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
    label: "Híbrido",
    description: "Sátelite + labels (Esri)",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}",
    attribution: 'Tiles &copy; Esri — Source: Esri',
    maxZoom: 20,
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
    label: "Google Híbrido",
    description: "Satélite + labels Google (se habilitado)",
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

export const MAP_LAYER_FALLBACK = ENABLED_MAP_LAYERS[0] || BASE_MAP_LAYERS[0];
export const DEFAULT_MAP_LAYER_KEY = MAP_LAYER_FALLBACK?.key || BASE_MAP_LAYERS[0]?.key || "openstreetmap";

export function getValidMapLayer(key) {
  if (key && ENABLED_MAP_LAYERS.some((layer) => layer.key === key)) {
    return key;
  }
  return DEFAULT_MAP_LAYER_KEY;
}
