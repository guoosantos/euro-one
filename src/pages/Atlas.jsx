import React, { useEffect, useMemo, useState } from "react";
import {
  Crosshair,
  Gauge,
  Layers,
  Loader2,
  MapPin,
  Navigation2,
  RefreshCcw,
  Satellite,
  TimerReset,
  Video,
  RadioTower,
} from "lucide-react";

import LeafletMap from "../components/LeafletMap";
import FleetPopup from "../components/FleetPopup";
import { useFleetDevices, FLEET_STATUS_LABELS } from "../lib/useFleetDevices";

export default function Atlas() {
  const { devices, isFetching, refetch, source, lastUpdated, lastRealtime } = useFleetDevices({
    autoRefresh: 45_000,
    enableRealtime: true,
  });
  const [selectedId, setSelectedId] = useState(null);
  const [onlyLive, setOnlyLive] = useState(false);

  const filteredDevices = useMemo(() => {
    return devices.filter((device) => (onlyLive ? device.isCommunicating : true));
  }, [devices, onlyLive]);

  useEffect(() => {
    if (selectedId && filteredDevices.some((item) => item.id === selectedId)) return;
    if (filteredDevices.length) {
      setSelectedId(filteredDevices[0].id);
    }
  }, [filteredDevices, selectedId]);

  const markers = useMemo(
    () =>
      filteredDevices
        .filter((device) => Number.isFinite(device.lat) && Number.isFinite(device.lng))
        .map((device) => ({
          id: device.id,
          lat: device.lat,
          lng: device.lng,
          status: device.status,
          speed: device.speed,
          ignition: device.ignition,
          course: device.course,
          label: `${device.name} · ${device.plate ?? device.id}`,
          popup: <FleetPopup device={device} />,
        })),
    [filteredDevices],
  );

  const selectedDevice = filteredDevices.find((device) => device.id === selectedId) ?? null;

  const center = useMemo(() => {
    if (selectedDevice && Number.isFinite(selectedDevice.lat) && Number.isFinite(selectedDevice.lng)) {
      return [selectedDevice.lat, selectedDevice.lng];
    }
    if (markers.length) return [markers[0].lat, markers[0].lng];
    return undefined;
  }, [markers, selectedDevice]);

  return (
    <div className="relative flex h-[calc(100vh-120px)] flex-col overflow-hidden rounded-3xl border border-white/10 bg-[#0b1019]">
      <LeafletMap
        fullscreen
        markers={markers}
        autoFit={!selectedDevice}
        highlightedId={selectedId}
        center={center}
        onMarkerClick={(marker) => setSelectedId(marker.id)}
      />

      <div className="pointer-events-none absolute left-6 top-6 z-[500] flex flex-wrap items-center gap-3">
        <SourceBadge source={source} isFetching={isFetching} />
        {(lastRealtime || lastUpdated) && (
          <span className="pointer-events-auto rounded-full border border-white/10 bg-black/40 px-3 py-1 text-xs text-white/70 backdrop-blur">
            Atualizado em {formatTime(lastRealtime ?? lastUpdated)}
          </span>
        )}
        <button
          type="button"
          className="pointer-events-auto inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/40 px-3 py-1 text-xs text-white/70 transition hover:border-primary/60 hover:text-white"
          onClick={() => refetch()}
          disabled={isFetching}
        >
          {isFetching ? <Loader2 size={14} className="animate-spin" /> : <RefreshCcw size={14} />}
          Sincronizar
        </button>
        <button
          type="button"
          className={`pointer-events-auto inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs transition ${
            onlyLive
              ? "border-emerald-400/50 bg-emerald-500/10 text-emerald-200"
              : "border-white/10 bg-black/40 text-white/70 hover:border-white/40"
          }`}
          onClick={() => setOnlyLive((value) => !value)}
        >
          <RadioTower size={14} /> Somente comunicando
        </button>
      </div>

      <CommandBar />

      <DeviceList
        devices={filteredDevices}
        selectedId={selectedId}
        onSelect={setSelectedId}
        isFetching={isFetching}
      />

      <DeviceDetails device={selectedDevice} />
    </div>
  );
}

function SourceBadge({ source, isFetching }) {
  const isLive = source === "realtime" || source === "socket";
  const tone = isLive
    ? "border-emerald-400/40 bg-emerald-500/10 text-emerald-200"
    : "border-white/10 bg-black/40 text-white/60";
  const label = isLive
    ? source === "socket"
      ? "Streaming ao vivo"
      : "Dados sincronizados"
    : "Dados de demonstração";
  return (
    <span className={`pointer-events-auto inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs ${tone}`}>
      {label}
      {isFetching && <Loader2 size={14} className="animate-spin" />}
    </span>
  );
}

function DeviceList({ devices, selectedId, onSelect, isFetching }) {
  return (
    <div className="pointer-events-auto absolute right-6 top-1/2 z-[400] flex h-[70vh] w-72 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#0f1523]/90 shadow-2xl backdrop-blur">
      <header className="flex items-center justify-between px-4 py-3 text-sm text-white/70">
        <div className="font-semibold text-white">Frota conectada</div>
        {isFetching && <Loader2 size={14} className="animate-spin" />}
      </header>
      <div className="flex-1 overflow-y-auto">
        {devices.length === 0 && (
          <div className="px-4 py-6 text-center text-xs text-white/50">Nenhum dispositivo disponível.</div>
        )}
        {devices.map((device) => (
          <button
            key={device.id}
            type="button"
            onClick={() => onSelect(device.id)}
            className={`flex w-full flex-col gap-1 border-b border-white/5 px-4 py-3 text-left text-sm transition ${
              selectedId === device.id ? "bg-white/10 text-white" : "hover:bg-white/5 text-white/80"
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="font-medium">{device.name}</span>
              <span className={statusTone(device.status)}>{FLEET_STATUS_LABELS[device.status] ?? device.status}</span>
            </div>
            <div className="flex flex-wrap items-center gap-3 text-xs text-white/50">
              {device.plate && <span>{device.plate}</span>}
              {device.speed != null && (
                <span className="inline-flex items-center gap-1">
                  <Gauge size={12} /> {Math.round(device.speed)} km/h
                </span>
              )}
              {device.lastUpdate && (
                <span className="inline-flex items-center gap-1">
                  <TimerReset size={12} /> {formatRelative(device.lastUpdate)}
                </span>
              )}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

function DeviceDetails({ device }) {
  if (!device) return null;
  return (
    <div className="pointer-events-auto absolute left-6 bottom-6 z-[400] w-96 max-w-full rounded-3xl border border-white/10 bg-[#0f1523]/95 p-5 text-sm text-white/70 shadow-2xl backdrop-blur">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-base font-semibold text-white">{device.name}</div>
          {device.plate && <div className="text-xs text-white/50">{device.plate}</div>}
        </div>
        <span className={`rounded-full px-3 py-1 text-xs font-medium ${statusTone(device.status)}`}>
          {FLEET_STATUS_LABELS[device.status] ?? device.status}
        </span>
      </div>

      {device.address && (
        <div className="mt-4 flex items-start gap-2 text-xs text-white/60">
          <MapPin size={14} className="mt-0.5" />
          <span>{device.address}</span>
        </div>
      )}

      <div className="mt-4 grid grid-cols-2 gap-3 text-xs text-white/60">
        <Metric icon={Gauge} label="Velocidade" value={formatValue(device.speed, "km/h")} />
        <Metric icon={RadioTower} label="Sinal" value={formatValue(device.signal, "dBm")} />
        <Metric icon={Satellite} label="Satélites" value={device.satellites} />
        <Metric icon={Navigation2} label="Direção" value={formatHeading(device.course)} />
        <Metric icon={TimerReset} label="Último envio" value={formatTime(device.lastUpdate)} fullWidth />
        <Metric icon={Gauge} label="Ignição" value={device.ignition ? "Ligada" : "Desligada"} fullWidth />
        <Metric icon={Video} label="Driver" value={device.driver ?? "—"} fullWidth />
        <Metric icon={Crosshair} label="Coordenadas" value={formatCoords(device)} fullWidth />
      </div>
    </div>
  );
}

function CommandBar() {
  const buttons = [
    { icon: Crosshair, label: "Centralizar" },
    { icon: Layers, label: "Camadas" },
    { icon: Satellite, label: "Satélite" },
    { icon: Video, label: "Câmeras" },
  ];
  return (
    <div className="pointer-events-auto absolute left-6 top-1/2 z-[400] -translate-y-1/2">
      <div className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-[#0f1523]/90 p-3 text-white/70 shadow-2xl backdrop-blur">
        {buttons.map((button) => (
          <button
            key={button.label}
            type="button"
            className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-white/70 transition hover:border-primary/60 hover:text-white"
            title={button.label}
          >
            <button.icon size={18} />
          </button>
        ))}
      </div>
    </div>
  );
}

function Metric({ icon: Icon, label, value, fullWidth = false }) {
  if (!value) return null;
  return (
    <div className={`flex items-center gap-2 rounded-2xl border border-white/5 bg-white/5 px-3 py-2 ${fullWidth ? "col-span-2" : ""}`}>
      <Icon size={14} className="text-white/50" />
      <div>
        <div className="text-[11px] uppercase tracking-wide text-white/40">{label}</div>
        <div className="text-sm text-white/80">{value}</div>
      </div>
    </div>
  );
}

function statusTone(status) {
  switch (status) {
    case "online":
      return "rounded-full border border-emerald-400/40 bg-emerald-500/10 px-2 py-1 text-[11px] text-emerald-200";
    case "alert":
      return "rounded-full border border-amber-400/40 bg-amber-500/10 px-2 py-1 text-[11px] text-amber-200";
    case "blocked":
      return "rounded-full border border-purple-400/40 bg-purple-500/10 px-2 py-1 text-[11px] text-purple-200";
    default:
      return "rounded-full border border-white/15 bg-white/5 px-2 py-1 text-[11px] text-white/70";
  }
}

function formatValue(value, unit) {
  if (value == null || Number.isNaN(Number(value))) return "—";
  return `${Math.round(Number(value))} ${unit}`;
}

function formatHeading(value) {
  if (value == null || Number.isNaN(Number(value))) return "—";
  return `${Math.round(Number(value))}°`;
}

function formatCoords(device) {
  if (!device || device.lat == null || device.lng == null) return "—";
  return `${device.lat.toFixed(5)}, ${device.lng.toFixed(5)}`;
}

function formatTime(value) {
  if (!value) return "—";
  try {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "—";
    return date.toLocaleString();
  } catch (error) {
    return "—";
  }
}

function formatRelative(value) {
  try {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "—";
    const diff = Date.now() - date.getTime();
    const minutes = Math.round(diff / 60000);
    if (minutes <= 1) return "agora";
    if (minutes < 60) return `${minutes} min`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `${hours} h`;
    const days = Math.round(hours / 24);
    return `${days} d`;
  } catch (error) {
    return "—";
  }
}
