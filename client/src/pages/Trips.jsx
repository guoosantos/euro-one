import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { MapContainer, Marker, Polyline, TileLayer, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

import useDevices from "../lib/hooks/useDevices";
import { useTranslation } from "../lib/i18n.js";
import useReportsRoute from "../lib/hooks/useReportsRoute";
import { useReports } from "../lib/hooks/useReports";
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

function formatDuration(seconds) {
  if (!Number.isFinite(seconds)) return "—";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const parts = [hours, minutes, secs].map((value) => String(value).padStart(2, "0"));
  return `${parts[0]}:${parts[1]}:${parts[2]}`;
}

function formatDistance(distanceMeters) {
  if (!Number.isFinite(distanceMeters)) return "—";
  if (distanceMeters >= 1000) return `${(distanceMeters / 1000).toFixed(1)} km`;
  return `${Math.round(distanceMeters)} m`;
}

function formatSpeed(value) {
  if (!Number.isFinite(value)) return "—";
  return `${Math.round(value)} km/h`;
}

function normalizeSeverityFromPoint(point) {
  const raw = point?.alarm ?? point?.attributes?.alarm ?? point?.event ?? point?.attributes?.event ?? point?.type ?? "normal";
  const normalized = String(raw).toLowerCase();
  if (normalized.includes("crit")) return "critical";
  if (normalized.includes("high") || normalized.includes("alto") || normalized.includes("alerta")) return "high";
  if (normalized.includes("low") || normalized.includes("baixo")) return "low";
  if (normalized.includes("info")) return "info";
  return "normal";
}

function formatPointAddress(point) {
  if (typeof point?.address === "string" && point.address.trim()) return point.address.trim();
  if (typeof point?.attributes?.address === "string" && point.attributes.address.trim()) return point.attributes.address.trim();
  if (typeof point?.attributes?.formattedAddress === "string" && point.attributes.formattedAddress.trim()) {
    return point.attributes.formattedAddress.trim();
  }
  if (typeof point?.attributes?.rawAddress === "string" && point.attributes.rawAddress.trim()) {
    return point.attributes.rawAddress.trim();
  }
  return "Endereço indisponível";
}

function buildEventIcon(severity = "normal", active = false) {
  const palette = {
    critical: "#ef4444",
    high: "#ef4444",
    medium: "#f59e0b",
    low: "#10b981",
    info: "#3b82f6",
    normal: "#94a3b8",
  };
  const color = palette[severity] || palette.normal;
  const ring = active ? `box-shadow:0 0 0 6px rgba(34,197,94,0.25);` : "";
  return L.divIcon({
    className: "audit-marker",
    html: `
      <div style="${ring}display:flex;align-items:center;justify-content:center;width:18px;height:18px;border-radius:10px;background:${color};border:2px solid rgba(255,255,255,0.85);"></div>
    `,
    iconSize: [18, 18],
    iconAnchor: [9, 9],
  });
}

function validateRange({ deviceId, from, to }) {
  if (!deviceId) return "Selecione um dispositivo para gerar o relatório.";
  const fromDate = parseDate(from);
  const toDate = parseDate(to);
  if (!fromDate || !toDate) return "Informe datas válidas para início e fim.";
  if (fromDate.getTime() >= toDate.getTime()) return "A data inicial deve ser antes da final.";
  return null;
}

function ReplayMap({ points, activeIndex, onSelectIndex }) {
  const routePoints = useMemo(
    () =>
      points
        .map((point, index) => {
          if (!Number.isFinite(point.lat) || !Number.isFinite(point.lng)) return null;
          return { ...point, index };
        })
        .filter(Boolean),
    [points],
  );

  const positions = routePoints.map((point) => [point.lat, point.lng]);
  const activePoint = routePoints[activeIndex] || routePoints[0];
  const center = activePoint ? [activePoint.lat, activePoint.lng] : DEFAULT_CENTER;

  return (
    <div className="overflow-hidden rounded-xl border border-white/10">
      <MapContainer center={center} zoom={DEFAULT_ZOOM} style={{ height: "420px", width: "100%" }} scrollWheelZoom>
        <TileLayer
          attribution='&copy; <a href="http://osm.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {positions.length ? <Polyline positions={positions} color="#22c55e" weight={5} opacity={0.7} /> : null}
        {routePoints.map((point) => (
          <Marker
            key={`${point.lat}-${point.lng}-${point.index}`}
            position={[point.lat, point.lng]}
            icon={buildEventIcon(point.__severity, point.index === activeIndex)}
            eventHandlers={{ click: () => onSelectIndex?.(point.index) }}
          />
        ))}
        {activePoint ? <Marker position={[activePoint.lat, activePoint.lng]} icon={replayMarkerIcon} /> : null}
        <MapFocus point={activePoint} />
      </MapContainer>
    </div>
  );
}

function MapFocus({ point }) {
  const map = useMap();
  useEffect(() => {
    if (!point) return;
    if (Number.isFinite(point.lat) && Number.isFinite(point.lng)) {
      map.setView([point.lat, point.lng], DEFAULT_ZOOM, { animate: true });
    }
  }, [map, point]);
  return null;
}

export default function Trips() {
  const { locale } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const { devices: rawDevices } = useDevices();
  const devices = useMemo(() => (Array.isArray(rawDevices) ? rawDevices : []), [rawDevices]);
  const { data, loading, error, generateTripsReport, downloadTripsCsv } = useReports();
  const {
    data: routeData,
    loading: routeLoading,
    error: routeError,
    generate: generateRoute,
  } = useReportsRoute();

  const [deviceId, setDeviceId] = useState("");
  const [from, setFrom] = useState(DEFAULT_FROM);
  const [to, setTo] = useState(DEFAULT_TO);
  const [formError, setFormError] = useState("");
  const [feedback, setFeedback] = useState(null);
  const [downloading, setDownloading] = useState(false);
  const [selectedTrip, setSelectedTrip] = useState(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);

  const trips = useMemo(
    () => (Array.isArray(data?.trips) ? data.trips : Array.isArray(data) ? data : []),
    [data],
  );

  const routePoints = useMemo(() => {
    const positions = Array.isArray(routeData?.positions)
      ? routeData.positions
      : Array.isArray(routeData?.data)
        ? routeData.data
        : [];

    const normalized = positions
      .map((point, index) => {
        const lat = pickCoordinate([point.latitude, point.lat, point.lat_deg]);
        const lng = pickCoordinate([point.longitude, point.lon, point.lng]);
        const time = parseDate(point.fixTime || point.deviceTime || point.serverTime || point.time);
        return {
          ...point,
          lat,
          lng,
          __time: time,
          __severity: normalizeSeverityFromPoint(point),
          __address: formatPointAddress(point),
          __speed: pickSpeed(point),
          __label:
            point.event ||
            point.type ||
            point.attributes?.event ||
            point.attributes?.alarm ||
            point.attributes?.status ||
            "Posição registrada",
          __index: index,
        };
      })
      .filter((point) => point.__time || (Number.isFinite(point.lat) && Number.isFinite(point.lng)));

    const sorted = normalized.sort((a, b) => {
      const aTime = a.__time ? a.__time.getTime() : 0;
      const bTime = b.__time ? b.__time.getTime() : 0;
      if (aTime === bTime) return a.__index - b.__index;
      return aTime - bTime;
    });

    return sorted.map((point, index) => ({ ...point, index }));
  }, [routeData]);

  const activePoint = useMemo(() => routePoints[activeIndex] || routePoints[0] || null, [activeIndex, routePoints]);

  const totalPoints = routePoints.length;
  const timelineMax = Math.max(totalPoints - 1, 0);

  const summary = useMemo(() => {
    if (!routePoints.length) return null;
    const validPoints = routePoints.filter((point) => point.__time instanceof Date);
    if (!validPoints.length) return null;
    const speeds = routePoints.map((point) => point.__speed).filter((value) => value !== null && Number.isFinite(value));
    return {
      start: validPoints[0]?.__time ?? null,
      end: validPoints[validPoints.length - 1]?.__time ?? null,
      averageSpeed: speeds.length ? Math.round(speeds.reduce((acc, value) => acc + value, 0) / speeds.length) : null,
      maxSpeed: speeds.length ? Math.max(...speeds) : null,
    };
  }, [routePoints]);

  const timelineEntries = useMemo(
    () =>
      routePoints.map((point, index) => ({
        index,
        time: point.__time,
        label: point.__label,
        severity: point.__severity,
        address: point.__address,
        speed: point.__speed,
      })),
    [routePoints],
  );

  useEffect(() => {
    const search = new URLSearchParams(location.search || "");
    const queryDevice = search.get("deviceId") || search.get("device");
    const queryFrom = search.get("from");
    const queryTo = search.get("to");

    if (queryDevice) setDeviceId(queryDevice);
    if (queryFrom) setFrom(asLocalInput(queryFrom, DEFAULT_FROM));
    if (queryTo) setTo(asLocalInput(queryTo, DEFAULT_TO));

    if (queryDevice && queryFrom && queryTo && !trips.length) {
      handleGenerate(queryDevice, queryFrom, queryTo);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.search]);

  useEffect(() => {
    setActiveIndex(0);
    setIsPlaying(false);
  }, [routePoints]);

  useEffect(() => {
    if (!isPlaying || totalPoints <= 1) return undefined;
    const interval = setInterval(() => {
      setActiveIndex((current) => {
        const next = Math.min(current + 1, totalPoints - 1);
        if (next === totalPoints - 1) {
          setIsPlaying(false);
        }
        return next;
      });
    }, 800 / speed);
    return () => clearInterval(interval);
  }, [isPlaying, totalPoints, speed]);

  const loadRouteForTrip = useCallback(
    async (trip) => {
      if (!trip) return;
      const tripDeviceId = trip.deviceId || trip.device_id || deviceId;
      const start = trip.startTime || trip.start || trip.from;
      const end = trip.endTime || trip.end || trip.to;
      const startDate = parseDate(start);
      const endDate = parseDate(end);
      if (!tripDeviceId || !startDate || !endDate) return;
      try {
        await generateRoute({
          deviceId: tripDeviceId,
          from: startDate.toISOString(),
          to: endDate.toISOString(),
        });
      } catch (_err) {
        // handled by hook state
      }
    },
    [deviceId, generateRoute],
  );

  const handleGenerate = useCallback(
    async (nextDeviceId, fromValue, toValue) => {
      setFeedback(null);
      const device = nextDeviceId || deviceId;
      const rangeFrom = fromValue || from;
      const rangeTo = toValue || to;
      const validation = validateRange({ deviceId: device, from: rangeFrom, to: rangeTo });
      if (validation) {
        setFormError(validation);
        return;
      }
      setFormError("");
      try {
        const response = await generateTripsReport({
          deviceId: device,
          from: new Date(rangeFrom).toISOString(),
          to: new Date(rangeTo).toISOString(),
        });
        const nextTrip = Array.isArray(response?.trips) ? response.trips[0] : null;
        if (nextTrip) {
          setSelectedTrip(nextTrip);
          await loadRouteForTrip(nextTrip);
        }
        navigate(
          `/trips?deviceId=${encodeURIComponent(device)}&from=${encodeURIComponent(rangeFrom)}&to=${encodeURIComponent(rangeTo)}`,
          { replace: true },
        );
        setFeedback({ type: "success", message: "Relatório gerado com sucesso." });
      } catch (requestError) {
        setFeedback({ type: "error", message: requestError?.message || "Erro ao gerar relatório." });
      }
    },
    [deviceId, from, to, generateTripsReport, navigate, loadRouteForTrip],
  );

  const handleSubmit = useCallback(
    (event) => {
      event.preventDefault();
      void handleGenerate();
    },
    [handleGenerate],
  );

  const handleDownload = useCallback(async () => {
    const validation = validateRange({ deviceId, from, to });
    if (validation) {
      setFormError(validation);
      return;
    }
    setFormError("");
    setDownloading(true);
    try {
      await downloadTripsCsv({ deviceId, from: new Date(from).toISOString(), to: new Date(to).toISOString() });
      setFeedback({ type: "success", message: "Exportação iniciada." });
    } catch (requestError) {
      setFeedback({ type: "error", message: requestError?.message || "Erro ao exportar CSV." });
    } finally {
      setDownloading(false);
    }
  }, [deviceId, from, to, downloadTripsCsv]);

  const handleSelectTrip = useCallback(
    async (trip) => {
      setSelectedTrip(trip);
      setActiveIndex(0);
      setIsPlaying(false);
      await loadRouteForTrip(trip);
    },
    [loadRouteForTrip],
  );

  const handleSelectPoint = useCallback((nextIndex) => {
    setIsPlaying(false);
    setActiveIndex(nextIndex);
  }, []);

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold text-white">Trajetos</h1>
        <p className="text-sm text-white/60">Gere e acompanhe relatórios de viagens dos dispositivos.</p>
      </div>

      <form
        onSubmit={handleSubmit}
        className="grid gap-4 rounded-2xl border border-white/10 bg-white/5 p-4 sm:grid-cols-2 lg:grid-cols-4"
      >
        <label className="space-y-1 text-sm text-white/80">
          <span className="text-white/60">Dispositivo</span>
          <select
            value={deviceId}
            onChange={(event) => setDeviceId(event.target.value)}
            className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-white focus:border-primary/40 focus:outline-none"
          >
            <option value="">Selecione um dispositivo</option>
            {devices.map((device) => (
              <option key={device.id ?? device.uniqueId} value={device.id ?? device.uniqueId}>
                {device.name || device.vehicle || device.uniqueId}
              </option>
            ))}
          </select>
        </label>

        <label className="space-y-1 text-sm text-white/80">
          <span className="text-white/60">De</span>
          <input
            type="datetime-local"
            value={from}
            onChange={(event) => setFrom(event.target.value)}
            className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-white focus:border-primary/40 focus:outline-none"
          />
        </label>

        <label className="space-y-1 text-sm text-white/80">
          <span className="text-white/60">Até</span>
          <input
            type="datetime-local"
            value={to}
            onChange={(event) => setTo(event.target.value)}
            className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-white focus:border-primary/40 focus:outline-none"
          />
        </label>

        <div className="flex items-end justify-end gap-2">
          <button type="submit" className="btn" disabled={loading || !deviceId}>
            {loading ? "Gerando..." : "Gerar"}
          </button>
          <button type="button" className="btn btn-ghost" onClick={handleDownload} disabled={downloading || !deviceId}>
            {downloading ? "Exportando..." : "Exportar CSV"}
          </button>
        </div>
      </form>

      {formError ? <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-100">{formError}</div> : null}
      {feedback && feedback.type === "success" && (
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-100">
          {feedback.message}
        </div>
      )}
      {(feedback?.type === "error" || error) && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">
          {feedback?.type === "error" ? feedback.message : error?.message}
        </div>
      )}

      <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
        <div className="flex items-center justify-between gap-2 pb-3">
          <div>
            <div className="text-sm font-semibold text-white">Viagens encontradas</div>
            <div className="text-xs text-white/60">{trips.length} registros</div>
          </div>
          {data?.__meta?.generatedAt ? (
            <div className="text-xs text-white/60">
              Última geração: {formatDateTime(new Date(data.__meta.generatedAt), locale)}
            </div>
          ) : null}
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="text-white/50">
              <tr className="border-b border-white/10 text-left">
                <th className="py-2 pr-4">Início</th>
                <th className="py-2 pr-4">Fim</th>
                <th className="py-2 pr-4">Duração</th>
                <th className="py-2 pr-4">Distância</th>
                <th className="py-2 pr-4">Vel. média</th>
                <th className="py-2 pr-4">Origem</th>
                <th className="py-2 pr-4">Destino</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={7} className="py-4 text-center text-white/60">
                    Processando relatório...
                  </td>
                </tr>
              )}
              {!loading && trips.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-4 text-center text-white/60">
                    Gere um relatório para visualizar os trajetos.
                  </td>
                </tr>
              )}
              {trips.map((trip) => {
                const isSelected = selectedTrip?.id === trip.id && selectedTrip?.startTime === trip.startTime;
                return (
                  <tr
                    key={`${trip.deviceId || trip.device_id}-${trip.startTime}-${trip.endTime}`}
                    className={`border-b border-white/5 cursor-pointer transition hover:bg-white/5 ${
                      isSelected ? "bg-primary/5 border-l-4 border-primary" : ""
                    }`}
                    onClick={() => handleSelectTrip(trip)}
                  >
                    <td className="py-2 pr-4 text-white">{formatDateTime(parseDate(trip.startTime), locale)}</td>
                    <td className="py-2 pr-4 text-white/80">{formatDateTime(parseDate(trip.endTime), locale)}</td>
                    <td className="py-2 pr-4 text-white/70">{formatDuration(trip.duration)}</td>
                    <td className="py-2 pr-4 text-white/70">{formatDistance(trip.distance)}</td>
                    <td className="py-2 pr-4 text-white/70">{formatSpeed(trip.averageSpeed)}</td>
                    <td className="py-2 pr-4 text-white/70">{trip.startShortAddress || trip.startAddress || "—"}</td>
                    <td className="py-2 pr-4 text-white/70">{trip.endShortAddress || trip.endAddress || "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="text-sm font-semibold text-white">Reprodução do trajeto selecionado</div>
            <div className="text-xs text-white/60">{totalPoints ? `${totalPoints} pontos carregados` : "Selecione um trajeto para visualizar."}</div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="btn"
              onClick={() => setIsPlaying((value) => !value)}
              disabled={!totalPoints || routeLoading}
            >
              {isPlaying ? "Pausar" : "Reproduzir"}
            </button>
            <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/80">
              <span className="text-white/50">Velocidade</span>
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

        {routeLoading && <div className="mt-3 text-sm text-white/60">Carregando trajeto...</div>}
        {routeError && (
          <div className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">
            {routeError.message}
          </div>
        )}

        {totalPoints ? (
          <>
            <div className="mt-4">
              <ReplayMap points={routePoints} activeIndex={activeIndex} onSelectIndex={handleSelectPoint} />
            </div>

            <div className="mt-4 space-y-3">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex flex-wrap items-center gap-3 text-sm text-white/70">
                  <div>
                    <span className="text-white/50">Ponto atual:</span>
                    <span className="ml-1 text-white">{activeIndex + 1} / {Math.max(totalPoints, 1)}</span>
                  </div>
                  {activePoint?.__speed !== undefined && activePoint?.__speed !== null ? (
                    <div>
                      <span className="text-white/50">Velocidade:</span>
                      <span className="ml-1 text-white">{Math.round(activePoint.__speed)} km/h</span>
                    </div>
                  ) : null}
                  {activePoint?.__time ? (
                    <div>
                      <span className="text-white/50">Horário:</span>
                      <span className="ml-1 text-white">{formatDateTime(activePoint.__time, locale)}</span>
                    </div>
                  ) : null}
                </div>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    className="rounded-lg border border-white/10 px-3 py-2 text-xs text-white hover:border-white/30"
                    onClick={() => handleSelectPoint(Math.max(0, activeIndex - 1))}
                    disabled={activeIndex <= 0}
                  >
                    Anterior
                  </button>
                  <button
                    type="button"
                    className="rounded-lg border border-white/10 px-3 py-2 text-xs text-white hover:border-white/30"
                    onClick={() => handleSelectPoint(Math.min(timelineMax, activeIndex + 1))}
                    disabled={activeIndex >= timelineMax}
                  >
                    Próximo
                  </button>
                </div>
              </div>

              <input
                type="range"
                min={0}
                max={timelineMax}
                value={Math.min(activeIndex, timelineMax)}
                onChange={(event) => handleSelectPoint(Number(event.target.value))}
                className="w-full accent-primary"
              />
            </div>

            <div className="mt-6 grid gap-4 lg:grid-cols-3">
              <div className="lg:col-span-2 rounded-lg border border-white/10 bg-white/5 p-3">
                <div className="mb-3 flex items-center justify-between">
                  <div className="text-sm font-semibold text-white">Linha do tempo de auditoria</div>
                  <div className="text-xs text-white/60">{timelineEntries.length} registros</div>
                </div>
                <div className="max-h-96 space-y-2 overflow-y-auto pr-1">
                  {timelineEntries.length === 0 ? (
                    <div className="rounded-md border border-white/10 bg-white/5 p-3 text-sm text-white/60">
                      Nenhum ponto carregado para este trajeto.
                    </div>
                  ) : (
                    timelineEntries.map((entry) => (
                      <TimelineItem
                        key={`${entry.index}-${entry.time?.toISOString?.() ?? entry.index}`}
                        entry={entry}
                        active={entry.index === activeIndex}
                        onSelect={handleSelectPoint}
                        locale={locale}
                      />
                    ))
                  )}
                </div>
              </div>
              {summary ? (
                <div className="space-y-3">
                  <div className="rounded-lg border border-white/10 bg-white/5 p-3 text-sm text-white/70">
                    <div className="text-white/50">Início</div>
                    <div className="font-semibold text-white">{summary.start ? formatDateTime(summary.start, locale) : "—"}</div>
                  </div>
                  <div className="rounded-lg border border-white/10 bg-white/5 p-3 text-sm text-white/70">
                    <div className="text-white/50">Fim</div>
                    <div className="font-semibold text-white">{summary.end ? formatDateTime(summary.end, locale) : "—"}</div>
                  </div>
                  <div className="rounded-lg border border-white/10 bg-white/5 p-3 text-sm text-white/70">
                    <div className="text-white/50">Vel. média</div>
                    <div className="font-semibold text-white">{summary.averageSpeed !== null ? `${summary.averageSpeed} km/h` : "—"}</div>
                  </div>
                  <div className="rounded-lg border border-white/10 bg-white/5 p-3 text-sm text-white/70">
                    <div className="text-white/50">Vel. máxima</div>
                    <div className="font-semibold text-white">{summary.maxSpeed !== null ? `${summary.maxSpeed} km/h` : "—"}</div>
                  </div>
                </div>
              ) : null}
            </div>
          </>
        ) : (
          <div className="mt-4 rounded-lg border border-white/10 bg-white/5 p-4 text-sm text-white/60">
            Selecione um trajeto para visualizar o mapa.
          </div>
        )}
      </div>
    </div>
  );
}

function TimelineItem({ entry, active, onSelect, locale }) {
  return (
    <button
      type="button"
      onClick={() => onSelect?.(entry.index)}
      className={`w-full rounded-lg border px-3 py-2 text-left text-sm transition ${
        active
          ? "border-primary/60 bg-primary/10 text-white"
          : "border-white/10 bg-white/5 text-white/80 hover:border-primary/40"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="text-xs text-white/60">{entry.time ? formatDateTime(entry.time, locale) : "Horário indisponível"}</div>
          <div className="font-semibold text-white">{entry.label}</div>
          <div className="text-xs text-white/60">{entry.address}</div>
        </div>
        <div className="flex flex-col items-end gap-1 text-xs text-white/60">
          <SeverityPill severity={entry.severity} />
          <div className="rounded bg-white/10 px-2 py-1 text-[11px] text-white/70">
            Vel.: {entry.speed !== undefined && entry.speed !== null ? `${Math.round(entry.speed)} km/h` : "—"}
          </div>
        </div>
      </div>
    </button>
  );
}

function SeverityPill({ severity }) {
  const palette = {
    critical: "bg-red-500/20 text-red-200 border-red-500/40",
    high: "bg-red-500/20 text-red-200 border-red-500/40",
    medium: "bg-yellow-500/20 text-yellow-200 border-yellow-500/40",
    low: "bg-green-500/20 text-green-200 border-green-500/40",
    info: "bg-blue-500/20 text-blue-200 border-blue-500/40",
    normal: "bg-white/10 text-white/70 border-white/20",
  };

  const label =
    severity === "critical"
      ? "Crítico"
      : severity === "high"
        ? "Alto"
        : severity === "medium"
          ? "Médio"
          : severity === "low"
            ? "Baixo"
            : "Info";

  return <span className={`rounded-full border px-3 py-1 text-[11px] font-semibold ${palette[severity] ?? palette.normal}`}>{label}</span>;
}
