import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { MapContainer, Marker, Polyline, TileLayer } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

import useDevices from "../lib/hooks/useDevices";
import { useTranslation } from "../lib/i18n.js";
import useReportsRoute from "../lib/hooks/useReportsRoute";
import { formatDateTime, pickCoordinate, pickSpeed } from "../lib/monitoring-helpers.js";

const DEFAULT_CENTER = [-19.9167, -43.9345];
const DEFAULT_ZOOM = 12;
const DEFAULT_FROM = () => new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 16);
const DEFAULT_TO = () => new Date().toISOString().slice(0, 16);
const REPLAY_SPEEDS = [1, 2, 4, 8];

const replayMarkerIcon = L.divIcon({
  className: "replay-marker",
  html: `
    <div style="display:flex;align-items:center;justify-content:center;width:36px;height:36px;border-radius:16px;background:#22c55e;box-shadow:0 10px 18px rgba(0,0,0,0.35),0 0 0 2px rgba(0,0,0,0.65);border:2px solid rgba(255,255,255,0.85);">
      <span style="font-size:16px;">▶</span>
    </div>
  `,
  iconSize: [36, 36],
  iconAnchor: [18, 18],
});

function parseDate(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function asLocalInput(value, fallbackFactory) {
  if (value) {
    const parsed = parseDate(value);
    if (parsed) return parsed.toISOString().slice(0, 16);
  }
  return fallbackFactory ? fallbackFactory() : "";
}

function ReplayMap({ points, activeIndex }) {
  const routePoints = useMemo(
    () =>
      points
        .map((point) => {
          const lat = pickCoordinate([point.latitude, point.lat, point.lat_deg]);
          const lng = pickCoordinate([point.longitude, point.lon, point.lng]);
          if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
          return { ...point, lat, lng };
        })
        .filter(Boolean),
    [points],
  );

  const positions = routePoints.map((point) => [point.lat, point.lng]);
  const activePoint = routePoints[activeIndex] || routePoints[0];
  const center = activePoint ? [activePoint.lat, activePoint.lng] : DEFAULT_CENTER;

  return (
    <div className="overflow-hidden rounded-xl border border-white/10">
      <MapContainer
        center={center}
        zoom={DEFAULT_ZOOM}
        style={{ height: "420px", width: "100%" }}
        scrollWheelZoom
      >
        <TileLayer
          attribution='&copy; <a href="http://osm.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {positions.length ? <Polyline positions={positions} color="#22c55e" weight={5} opacity={0.7} /> : null}
        {activePoint ? <Marker position={[activePoint.lat, activePoint.lng]} icon={replayMarkerIcon} /> : null}
      </MapContainer>
    </div>
  );
}

export default function Trips() {
  const { t, locale } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const { devices: rawDevices } = useDevices();
  const devices = useMemo(() => (Array.isArray(rawDevices) ? rawDevices : []), [rawDevices]);
  const { data, loading, error, generate } = useReportsRoute();

  const [deviceId, setDeviceId] = useState("");
  const [from, setFrom] = useState(DEFAULT_FROM);
  const [to, setTo] = useState(DEFAULT_TO);
  const [fetching, setFetching] = useState(false);
  const [formError, setFormError] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);

  const points = useMemo(() => (Array.isArray(data?.positions) ? data.positions : []), [data?.positions]);

  useEffect(() => {
    const search = new URLSearchParams(location.search || "");
    const queryDevice = search.get("deviceId") || search.get("device");
    const queryFrom = search.get("from");
    const queryTo = search.get("to");

    if (queryDevice) setDeviceId(queryDevice);
    if (queryFrom) setFrom(asLocalInput(queryFrom, DEFAULT_FROM));
    if (queryTo) setTo(asLocalInput(queryTo, DEFAULT_TO));

    if (queryDevice && queryFrom && queryTo && !points.length) {
      handleGenerate(queryDevice, queryFrom, queryTo);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.search]);

  useEffect(() => {
    setActiveIndex(0);
    setIsPlaying(false);
  }, [points]);

  useEffect(() => {
    if (!isPlaying || points.length <= 1) return undefined;
    const interval = setInterval(() => {
      setActiveIndex((current) => {
        const next = Math.min(current + 1, points.length - 1);
        if (next === points.length - 1) {
          setIsPlaying(false);
        }
        return next;
      });
    }, 800 / speed);
    return () => clearInterval(interval);
  }, [isPlaying, points.length, speed]);

  const handleGenerate = useCallback(
    async (nextDeviceId, fromValue, toValue) => {
      const device = nextDeviceId || deviceId;
      const rangeFrom = fromValue || from;
      const rangeTo = toValue || to;
      setFormError("");
      if (!device || !rangeFrom || !rangeTo) {
        setFormError(t("replay.validation"));
        return;
      }
      const fromDate = parseDate(rangeFrom);
      const toDate = parseDate(rangeTo);
      if (!fromDate || !toDate) {
        setFormError(t("replay.invalidRange"));
        return;
      }
      try {
        setFetching(true);
        await generate({ deviceId: device, from: fromDate.toISOString(), to: toDate.toISOString() });
        navigate(`/trips?deviceId=${encodeURIComponent(device)}&from=${encodeURIComponent(fromDate.toISOString())}&to=${encodeURIComponent(toDate.toISOString())}`, { replace: true });
      } catch (_err) {
        setFormError(t("replay.loadError"));
      } finally {
        setFetching(false);
      }
    },
    [deviceId, from, generate, navigate, t, to],
  );

  const handleSubmit = useCallback(
    (event) => {
      event.preventDefault();
      handleGenerate();
    },
    [handleGenerate],
  );

  const routePoints = useMemo(
    () =>
      points
        .map((point) => {
          const lat = pickCoordinate([point.latitude, point.lat, point.lat_deg]);
          const lng = pickCoordinate([point.longitude, point.lon, point.lng]);
          if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
          return { ...point, lat, lng };
        })
        .filter(Boolean),
    [points],
  );

  const activePoint = routePoints[activeIndex] || routePoints[0];
  const totalPoints = routePoints.length;
  const timelineMax = Math.max(totalPoints - 1, 0);

  const summary = useMemo(() => {
    if (!routePoints.length) return null;
    const first = routePoints[0];
    const last = routePoints[routePoints.length - 1];
    const start = parseDate(first.fixTime || first.deviceTime || first.serverTime);
    const end = parseDate(last.fixTime || last.deviceTime || last.serverTime);
    const speeds = routePoints
      .map((point) => pickSpeed(point))
      .filter((value) => value !== null && Number.isFinite(value));
    return {
      start,
      end,
      averageSpeed: speeds.length ? Math.round(speeds.reduce((acc, value) => acc + value, 0) / speeds.length) : null,
      maxSpeed: speeds.length ? Math.max(...speeds) : null,
    };
  }, [routePoints]);

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold text-white">{t("replay.title")}</h1>
        <p className="text-sm text-white/60">{t("replay.subtitle")}</p>
      </div>

      <form
        onSubmit={handleSubmit}
        className="grid gap-4 rounded-2xl border border-white/10 bg-white/5 p-4 sm:grid-cols-2 lg:grid-cols-4"
      >
        <label className="space-y-1 text-sm text-white/80">
          <span className="text-white/60">{t("replay.device")}</span>
          <select
            value={deviceId}
            onChange={(event) => setDeviceId(event.target.value)}
            className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-white focus:border-primary/40 focus:outline-none"
          >
            <option value="">{t("replay.selectDevice")}</option>
            {devices.map((device) => (
              <option key={device.id ?? device.uniqueId} value={device.id ?? device.uniqueId}>
                {device.name || device.vehicle || device.uniqueId}
              </option>
            ))}
          </select>
        </label>

        <label className="space-y-1 text-sm text-white/80">
          <span className="text-white/60">{t("replay.from")}</span>
          <input
            type="datetime-local"
            value={from}
            onChange={(event) => setFrom(event.target.value)}
            className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-white focus:border-primary/40 focus:outline-none"
          />
        </label>

        <label className="space-y-1 text-sm text-white/80">
          <span className="text-white/60">{t("replay.to")}</span>
          <input
            type="datetime-local"
            value={to}
            onChange={(event) => setTo(event.target.value)}
            className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-white focus:border-primary/40 focus:outline-none"
          />
        </label>

        <div className="flex items-end justify-end">
          <button type="submit" className="btn" disabled={fetching}>
            {fetching || loading ? t("replay.loading") : t("replay.loadRoute")}
          </button>
        </div>
      </form>

      {formError ? <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-100">{formError}</div> : null}
      {error ? <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-100">{error.message}</div> : null}

      <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="text-sm font-semibold text-white">{t("replay.mapTitle")}</div>
            <div className="text-xs text-white/60">
              {totalPoints ? t("replay.points", { count: totalPoints }) : t("replay.noPoints")}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="btn"
              onClick={() => setIsPlaying((value) => !value)}
              disabled={!totalPoints}
            >
              {isPlaying ? t("replay.pause") : t("replay.play")}
            </button>
            <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/80">
              <span className="text-white/50">{t("replay.speed")}</span>
              <select
                value={speed}
                onChange={(event) => setSpeed(Number(event.target.value))}
                className="rounded-md border border-white/10 bg-transparent px-2 py-1 text-sm focus:border-primary/40 focus:outline-none"
              >
                {REPLAY_SPEEDS.map((value) => (
                  <option key={value} value={value}>
                    {value}x
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        <div className="mt-4">
          <ReplayMap points={routePoints} activeIndex={activeIndex} />
        </div>

        <div className="mt-4 space-y-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap items-center gap-3 text-sm text-white/70">
              <div>
                <span className="text-white/50">{t("replay.currentPoint")}:</span>
                <span className="ml-1 text-white">{activeIndex + 1} / {Math.max(totalPoints, 1)}</span>
              </div>
              {activePoint?.speed !== undefined ? (
                <div>
                  <span className="text-white/50">{t("replay.speedLabel")}:</span>
                  <span className="ml-1 text-white">{pickSpeed(activePoint)} km/h</span>
                </div>
              ) : null}
              {activePoint?.fixTime || activePoint?.deviceTime || activePoint?.serverTime ? (
                <div>
                  <span className="text-white/50">{t("replay.time")}:</span>
                  <span className="ml-1 text-white">
                    {formatDateTime(
                      parseDate(activePoint.fixTime || activePoint.deviceTime || activePoint.serverTime),
                      locale,
                    )}
                  </span>
                </div>
              ) : null}
            </div>
            <div className="flex items-center gap-3">
              <button
                type="button"
                className="rounded-lg border border-white/10 px-3 py-2 text-xs text-white hover:border-white/30"
                onClick={() => setActiveIndex((value) => Math.max(0, value - 1))}
                disabled={activeIndex <= 0}
              >
                {t("replay.previous")}
              </button>
              <button
                type="button"
                className="rounded-lg border border-white/10 px-3 py-2 text-xs text-white hover:border-white/30"
                onClick={() => setActiveIndex((value) => Math.min(timelineMax, value + 1))}
                disabled={activeIndex >= timelineMax}
              >
                {t("replay.next")}
              </button>
            </div>
          </div>

          <input
            type="range"
            min={0}
            max={timelineMax}
            value={Math.min(activeIndex, timelineMax)}
            onChange={(event) => setActiveIndex(Number(event.target.value))}
            className="w-full accent-primary"
          />
        </div>

        {summary ? (
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-lg border border-white/10 bg-white/5 p-3 text-sm text-white/70">
              <div className="text-white/50">{t("replay.start")}</div>
              <div className="font-semibold text-white">
                {summary.start ? formatDateTime(summary.start, locale) : "—"}
              </div>
            </div>
            <div className="rounded-lg border border-white/10 bg-white/5 p-3 text-sm text-white/70">
              <div className="text-white/50">{t("replay.end")}</div>
              <div className="font-semibold text-white">
                {summary.end ? formatDateTime(summary.end, locale) : "—"}
              </div>
            </div>
            <div className="rounded-lg border border-white/10 bg-white/5 p-3 text-sm text-white/70">
              <div className="text-white/50">{t("replay.averageSpeed")}</div>
              <div className="font-semibold text-white">
                {summary.averageSpeed !== null ? `${summary.averageSpeed} km/h` : "—"}
              </div>
            </div>
            <div className="rounded-lg border border-white/10 bg-white/5 p-3 text-sm text-white/70">
              <div className="text-white/50">{t("replay.maxSpeed")}</div>
              <div className="font-semibold text-white">
                {summary.maxSpeed !== null ? `${summary.maxSpeed} km/h` : "—"}
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
