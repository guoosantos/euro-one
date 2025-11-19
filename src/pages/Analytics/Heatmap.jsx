import React, { useMemo, useState } from "react";
import { MapContainer, TileLayer, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

import { useTranslation } from "../../lib/i18n.js";
import { useHeatmapEvents } from "../../lib/hooks/useHeatmapEvents.js";

function HeatCircles({ points }) {
  const map = useMap();
  const layers = useMemo(() => L.layerGroup(), []);

  React.useEffect(() => {
    if (!map) return undefined;
    layers.addTo(map);
    layers.clearLayers();

    points.forEach((point) => {
      const intensity = Math.max(1, Math.min(point.count || 1, 20));
      const radius = 120 * intensity;
      const opacity = Math.min(0.15 + intensity * 0.03, 0.8);
      L.circle([point.lat, point.lng], {
        radius,
        color: "#ef4444",
        fillColor: "#ef4444",
        weight: 0,
        fillOpacity: opacity,
      }).addTo(layers);
    });

    return () => {
      layers.clearLayers();
      layers.removeFrom(map);
    };
  }, [map, layers, points]);

  return null;
}

export default function HeatmapAnalytics() {
  const { t } = useTranslation();
  const [filters, setFilters] = useState({ from: "", to: "", eventType: "" });
  const { points, topZones, total, loading, error, refresh } = useHeatmapEvents(filters);

  const center = useMemo(() => {
    if (points.length) {
      const [first] = points;
      return [first.lat, first.lng];
    }
    return [-23.5505, -46.6333];
  }, [points]);

  const totalPoints = useMemo(() => points.reduce((sum, item) => sum + (item.count || 0), 0), [points]);

  const handleChange = (event) => {
    const { name, value } = event.target;
    setFilters((current) => ({ ...current, [name]: value }));
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{t("analyticsHeatmap")}</h1>
          <p className="text-sm text-gray-600">{t("analyticsHeatmapDescription")}</p>
        </div>
        <div className="flex flex-wrap gap-2 text-sm">
          <label className="flex flex-col">
            <span className="text-gray-600">{t("from")}</span>
            <input
              type="datetime-local"
              name="from"
              value={filters.from}
              onChange={handleChange}
              className="rounded border px-2 py-1"
            />
          </label>
          <label className="flex flex-col">
            <span className="text-gray-600">{t("to")}</span>
            <input
              type="datetime-local"
              name="to"
              value={filters.to}
              onChange={handleChange}
              className="rounded border px-2 py-1"
            />
          </label>
          <label className="flex flex-col">
            <span className="text-gray-600">{t("eventType")}</span>
            <input
              type="text"
              name="eventType"
              value={filters.eventType}
              onChange={handleChange}
              placeholder={t("eventTypePlaceholder")}
              className="rounded border px-2 py-1"
            />
          </label>
          <button
            type="button"
            onClick={refresh}
            className="self-end rounded bg-blue-600 px-3 py-2 text-white hover:bg-blue-700"
          >
            {loading ? t("loading") : t("refresh")}
          </button>
        </div>
      </div>

      {error ? <div className="rounded border border-red-200 bg-red-50 p-3 text-red-700">{error.message}</div> : null}

      <div className="grid gap-4 md:grid-cols-3">
        <div className="md:col-span-2 overflow-hidden rounded-lg border bg-white shadow-sm">
          <div className="flex items-center justify-between border-b px-4 py-2 text-sm text-gray-700">
            <span>
              {t("pointsPlotted", { count: totalPoints })} · {t("eventsCount", { count: total })}
            </span>
            {loading ? <span className="text-xs text-gray-500">{t("loading")}</span> : null}
          </div>
          <MapContainer center={center} zoom={points.length ? 12 : 4} style={{ height: 420 }} scrollWheelZoom>
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            <HeatCircles points={points} />
          </MapContainer>
        </div>

        <div className="space-y-3 rounded-lg border bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">{t("topZones")}</h2>
            <span className="text-xs text-gray-500">{t("topZonesHint")}</span>
          </div>
          <div className="divide-y text-sm">
            {topZones.length === 0 && <p className="py-2 text-gray-500">{t("noData")}</p>}
            {topZones.map((zone, index) => (
              <div key={`${zone.lat}-${zone.lng}`} className="flex items-center justify-between py-2">
                <div>
                  <p className="font-medium text-gray-800">
                    #{index + 1} · {zone.lat.toFixed(4)}, {zone.lng.toFixed(4)}
                  </p>
                  <p className="text-xs text-gray-500">{t("eventsInZone", { count: zone.count })}</p>
                </div>
                <span className="rounded-full bg-rose-100 px-3 py-1 text-xs font-semibold text-rose-700">{zone.count}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
