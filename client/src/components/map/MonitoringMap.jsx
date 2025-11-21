import React, { useEffect, useMemo, useRef, useState } from "react";
import MapImpl from "../_MapImpl.jsx";

const MAPTILER_FALLBACK_STYLE = "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json";
const TILE_STYLE = import.meta.env.VITE_MAP_TILE_URL || MAPTILER_FALLBACK_STYLE;

function injectStylesheet(href) {
  if (typeof document === "undefined") return;
  if (document.querySelector(`link[href="${href}"]`)) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = href;
  document.head.appendChild(link);
}

function createPopupContent(marker) {
  const rows = [
    marker.label && `<div class="text-sm font-semibold text-white">${marker.label}</div>`,
    marker.address && `<div class="text-xs text-white/70">${marker.address}</div>`,
    marker.speedLabel &&
      `<div class="text-xs text-white/80 flex justify-between"><span>${marker.speedTitle ?? "Speed"}</span><span>${marker.speedLabel}</span></div>`,
    marker.statusLabel &&
      `<div class="text-xs text-white/80 flex justify-between"><span>${marker.statusTitle ?? "Status"}</span><span>${marker.statusLabel}</span></div>`,
    marker.lastUpdateLabel &&
      `<div class="text-xs text-white/80 flex justify-between"><span>${marker.updatedTitle ?? "Updated"}</span><span>${marker.lastUpdateLabel}</span></div>`,
  ].filter(Boolean);
  return `<div class="space-y-1">${rows.join("")}</div>`;
}

function useLazyMaplibre() {
  const [lib, setLib] = useState({ maplibregl: null, googleMaps: null, failed: false });

  useEffect(() => {
    if (typeof window === "undefined") return;

    let cancelled = false;
    (async () => {
      try {
        const [maplibreModule, googleModule] = await Promise.all([
          import(/* @vite-ignore */ "https://unpkg.com/maplibre-gl@3.6.1/dist/maplibre-gl.js"),
          import(/* @vite-ignore */ "https://unpkg.com/maplibre-gl@3.6.1/dist/maplibre-gl.js?plugins=maplibre-google-maps"),
        ]);
        if (cancelled) return;
        injectStylesheet("https://unpkg.com/maplibre-gl@3.6.1/dist/maplibre-gl.css");
        setLib({ maplibregl: maplibreModule.default ?? maplibreModule, googleMaps: googleModule?.default ?? googleModule, failed: false });
      } catch (error) {
        console.error("Failed to load MapLibre, falling back to Leaflet", error);
        if (!cancelled) {
          setLib({ maplibregl: null, googleMaps: null, failed: true });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return lib;
}

function buildTileStyle(url) {
  if (!url) return MAPTILER_FALLBACK_STYLE;
  const hasTemplate = url.includes("{z}") && url.includes("{x}") && url.includes("{y}");
  const isStyleJson = url.endsWith(".json") || url.startsWith("http") && !hasTemplate;
  if (isStyleJson) return url;
  if (hasTemplate) {
    return {
      version: 8,
      sources: {
        base: {
          type: "raster",
          tiles: [url],
          tileSize: 256,
          attribution: "© OpenStreetMap contributors",
        },
      },
      layers: [
        {
          id: "base",
          type: "raster",
          source: "base",
        },
      ],
    };
  }
  return MAPTILER_FALLBACK_STYLE;
}

export default function MonitoringMap({ markers = [], geofences = [], focusMarkerId = null, height = 360 }) {
  const containerRef = useRef(null);
  const { maplibregl, failed } = useLazyMaplibre();
  const mapStyle = useMemo(() => buildTileStyle(TILE_STYLE), []);
  const mapRef = useRef(null);
  const markerRefs = useRef([]);
  const containerHeight = useMemo(() => (typeof height === "number" ? `${height}px` : height || "360px"), [height]);

  const safeMarkers = useMemo(() => markers.filter((marker) => Number.isFinite(marker.lat) && Number.isFinite(marker.lng)), [markers]);

  useEffect(() => {
    if (!maplibregl || !containerRef.current || failed) return undefined;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: mapStyle,
      center: [safeMarkers[0]?.lng ?? -46.63, safeMarkers[0]?.lat ?? -23.55],
      zoom: 11,
    });

    mapRef.current = map;

    return () => {
      markerRefs.current.forEach((marker) => marker.remove());
      markerRefs.current = [];
      map.remove();
      mapRef.current = null;
    };
  }, [failed, mapStyle, maplibregl]);

  useEffect(() => {
    if (!mapRef.current || !maplibregl) return;

    markerRefs.current.forEach((marker) => marker.remove());
    markerRefs.current = [];

    safeMarkers.forEach((marker) => {
      const popupContent = createPopupContent(marker);
      const popup = new maplibregl.Popup({ offset: 12 }).setHTML(popupContent);
      const element = document.createElement("div");
      element.className = "fleet-marker";
      element.style.width = "16px";
      element.style.height = "16px";
      element.style.borderRadius = "9999px";
      element.style.background = marker.color || "#22c55e";
      element.style.boxShadow = "0 0 0 2px rgba(11,15,23,0.9)";
      element.style.border = "2px solid rgba(255,255,255,0.9)";

      const mapMarker = new maplibregl.Marker({ element })
        .setLngLat([marker.lng, marker.lat])
        .setPopup(popup)
        .addTo(mapRef.current);

      markerRefs.current.push(mapMarker);
    });

    if (safeMarkers.length > 0) {
      const bounds = new maplibregl.LngLatBounds();
      safeMarkers.forEach((marker) => bounds.extend([marker.lng, marker.lat]));
      mapRef.current.fitBounds(bounds, { padding: 48, duration: 600, maxZoom: 16 });
    } else {
      mapRef.current.easeTo({ center: [-46.63, -23.55], zoom: 10, duration: 300 });
    }
  }, [maplibregl, safeMarkers]);

  useEffect(() => {
    if (!mapRef.current || !focusMarkerId) return;
    const target = safeMarkers.find((marker) => marker.id === focusMarkerId);
    if (target) {
      mapRef.current.flyTo({ center: [target.lng, target.lat], zoom: 14, essential: true });
    }
  }, [focusMarkerId, safeMarkers]);

  if (failed || typeof window === "undefined") {
    return <MapImpl markers={markers} height={height} />;
  }

  return <div ref={containerRef} className="rounded-xl border border-white/5 bg-[#0b0f17]" style={{ height: containerHeight }} />;
}
