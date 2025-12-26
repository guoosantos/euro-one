import React, { useEffect, useMemo, useRef, useState } from "react";
import { MapContainer, TileLayer, useMap } from "react-leaflet";
import { useLocation, useSearchParams } from "react-router-dom";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "leaflet.heat";

import { useTranslation } from "../../lib/i18n.js";
import { translateEventType } from "../../lib/event-translations.js";
import useGroups from "../../lib/hooks/useGroups.js";
import { useHeatmapEvents } from "../../lib/hooks/useHeatmapEvents.js";

const CRIME_TYPES = ["crime", "theft", "assalto", "robbery"];
const EVENT_TYPE_OPTIONS = [
  "alarm",
  "ignitionOn",
  "ignitionOff",
  "deviceOnline",
  "deviceOffline",
  "theft",
  "sos",
  "geofenceEnter",
  "geofenceExit",
  "harshAcceleration",
  "harshBraking",
];

function HeatLayer({ points }) {
  const map = useMap();
  const layerRef = useRef(null);

  useEffect(() => {
    if (!map) return undefined;
    if (!layerRef.current) {
      layerRef.current = L.heatLayer([], { radius: 20, blur: 25, minOpacity: 0.2, maxZoom: 14 }).addTo(map);
    }

    return () => {
      if (layerRef.current) {
        layerRef.current.remove();
        layerRef.current = null;
      }
    };
  }, [map]);

  useEffect(() => {
    const layer = layerRef.current;
    if (!layer || !layer._map) return;
    const formatted = points.map((p) => [p.lat, p.lng, Math.max(0.2, Math.min(p.count || 1, 20))]);
    layer.setLatLngs(formatted);
    if (layer._map) {
      layer.redraw();
    }
  }, [points]);

  return null;
}

export default function HeatmapAnalytics() {
  const { t, locale } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const { search } = useLocation();
  const [filters, setFilters] = useState({ from: "", to: "", eventTypes: [], groupId: "" });
  const { groups } = useGroups();
  const tileUrl = useMemo(
    () => import.meta.env.VITE_MAP_TILE_URL || "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    [],
  );
  const requestFilters = useMemo(
    () => ({
      ...filters,
      from: filters.from ? new Date(filters.from).toISOString() : undefined,
      to: filters.to ? new Date(filters.to).toISOString() : undefined,
    }),
    [filters],
  );
  const { points, topZones, total, loading, error, refresh } = useHeatmapEvents(requestFilters);
  const hasPoints = points.length > 0;
  const plottedPoints = useMemo(() => points.length, [points]);
  const eventsCount = useMemo(() => (Number.isFinite(total) ? total : points.reduce((sum, item) => sum + (item.count || 0), 0)), [points, total]);

  useEffect(() => {
    const now = new Date();
    const defaultTo = now.toISOString().slice(0, 16);
    const defaultFrom = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString().slice(0, 16);
    setFilters((prev) => ({
      ...prev,
      from: prev.from || defaultFrom,
      to: prev.to || defaultTo,
    }));
  }, []);

  useEffect(() => {
    const filterParam = searchParams.get("filter");
    if (filterParam === "crime") {
      setFilters((prev) => ({ ...prev, eventTypes: CRIME_TYPES }));
    }
  }, [searchParams]);

  const center = useMemo(() => {
    if (points.length) {
      const [first] = points;
      return [first.lat, first.lng];
    }
    return [-23.5505, -46.6333];
  }, [points]);

  const handleDateChange = (event) => {
    const { name, value } = event.target;
    setFilters((current) => ({ ...current, [name]: value }));
  };

  const toggleEventType = (value) => {
    setFilters((current) => {
      const exists = current.eventTypes.includes(value);
      const nextTypes = exists ? current.eventTypes.filter((item) => item !== value) : [...current.eventTypes, value];
      return { ...current, eventTypes: nextTypes };
    });
  };

  const handleGroupChange = (event) => {
    setFilters((current) => ({ ...current, groupId: event.target.value }));
  };

  const applyFilters = () => {
    const nextParams = new URLSearchParams(search);
    if (filters.eventTypes?.length) {
      nextParams.set("types", filters.eventTypes.join(","));
    } else {
      nextParams.delete("types");
    }
    if (filters.groupId) nextParams.set("groupId", filters.groupId);
    if (filters.from) nextParams.set("from", filters.from);
    if (filters.to) nextParams.set("to", filters.to);
    setSearchParams(nextParams);
    refresh();
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
              onChange={handleDateChange}
              className="rounded border px-2 py-1"
            />
          </label>
          <label className="flex flex-col">
            <span className="text-gray-600">{t("to")}</span>
            <input
              type="datetime-local"
              name="to"
              value={filters.to}
              onChange={handleDateChange}
              className="rounded border px-2 py-1"
            />
          </label>
          <div className="flex flex-col">
            <span className="text-gray-600">{t("eventType")}</span>
            <div className="flex flex-wrap gap-2 rounded border px-2 py-1">
              {EVENT_TYPE_OPTIONS.map((option) => {
                const active = filters.eventTypes.includes(option);
                return (
                  <button
                    key={option}
                    type="button"
                    onClick={() => toggleEventType(option)}
                    className={`rounded px-2 py-1 text-xs ${active ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-700"}`}
                  >
                    {translateEventType(option, locale, t)}
                  </button>
                );
              })}
            </div>
          </div>
          <label className="flex flex-col">
            <span className="text-gray-600">{t("group")}</span>
            <select value={filters.groupId} onChange={handleGroupChange} className="rounded border px-2 py-1">
              <option value="">{t("all")}</option>
              {groups.map((group) => (
                <option key={group.id} value={group.id}>
                  {group.name}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={applyFilters}
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
              {t("pointsPlotted", { count: plottedPoints })} · {t("eventsCount", { count: eventsCount })}
            </span>
            {loading ? <span className="text-xs text-gray-500">{t("loading")}</span> : null}
          </div>
          <div className="relative">
            <MapContainer center={center} zoom={points.length ? 12 : 4} style={{ height: 420 }} scrollWheelZoom>
              <TileLayer
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                url={tileUrl}
              />
              <HeatLayer points={points} />
            </MapContainer>
            {!hasPoints && !loading ? (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-white/70 text-sm text-gray-700">
                Sem dados para o período
              </div>
            ) : null}
          </div>
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
