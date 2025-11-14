import React from "react";
import {
  BatteryCharging,
  Gauge,
  MapPin,
  RadioTower,
  Satellite,
  TimerReset,
} from "lucide-react";

import { FLEET_STATUS_LABELS } from "../lib/useFleetDevices";

const STATUS_BADGES = {
  online: "text-emerald-300 border-emerald-400/40 bg-emerald-500/10",
  alert: "text-amber-300 border-amber-400/40 bg-amber-500/10",
  offline: "text-slate-300 border-slate-400/40 bg-slate-500/10",
  blocked: "text-purple-200 border-purple-400/40 bg-purple-500/10",
};

export function FleetPopup({ device }) {
  if (!device) return null;

  const statusTone = STATUS_BADGES[device.status] ?? STATUS_BADGES.offline;

  return (
    <div className="fleet-popup__body">
      <header className="fleet-popup__header">
        <div>
          <div className="text-sm font-semibold text-white">{device.name ?? "Dispositivo"}</div>
          {device.plate && <div className="text-xs text-white/50">{device.plate}</div>}
        </div>
        <span className={`fleet-popup__badge ${statusTone}`}>
          {FLEET_STATUS_LABELS[device.status] ?? device.status}
        </span>
      </header>

      {device.address && (
        <div className="fleet-popup__row">
          <MapPin size={14} className="fleet-popup__icon" />
          <span>{device.address}</span>
        </div>
      )}

      <div className="fleet-popup__grid">
        <Metric icon={Gauge} label="Velocidade" value={formatValue(device.speed, "km/h")} />
        <Metric icon={TimerReset} label="Último envio" value={formatTime(device.lastUpdate)} />
        <Metric icon={BatteryCharging} label="Bateria" value={formatPercent(device.battery)} />
        <Metric icon={RadioTower} label="Sinal" value={formatSignal(device.signal)} />
        <Metric icon={Satellite} label="Satélites" value={formatCount(device.satellites)} />
        {device.ignition != null && (
          <Metric icon={Gauge} label="Ignição" value={device.ignition ? "Ligada" : "Desligada"} />
        )}
      </div>

      {device.alerts?.length ? (
        <div className="fleet-popup__alerts">
          {device.alerts.map((alert) => (
            <span key={alert} className="fleet-popup__alert">
              {alert}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function Metric({ icon: Icon, label, value }) {
  if (!value) return null;
  return (
    <div className="fleet-popup__metric">
      <Icon size={14} className="fleet-popup__icon" />
      <div>
        <div className="fleet-popup__metric-label">{label}</div>
        <div className="fleet-popup__metric-value">{value}</div>
      </div>
    </div>
  );
}

function formatValue(value, unit) {
  if (value == null) return null;
  return `${Math.round(Number(value))} ${unit}`;
}

function formatPercent(value) {
  if (value == null) return null;
  return `${Math.round(Number(value))}%`;
}

function formatSignal(value) {
  if (value == null) return null;
  return `${Math.round(Number(value))} dBm`;
}

function formatCount(value) {
  if (value == null) return null;
  return String(value);
}

function formatTime(value) {
  if (!value) return null;
  try {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return date.toLocaleString();
  } catch (error) {
    return null;
  }
}

export default FleetPopup;
