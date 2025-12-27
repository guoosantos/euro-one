import React from "react";
import { formatAddress } from "../../lib/format-address.js";
import {
  deriveStatus,
  formatDateTime,
  getIgnition,
  getLastUpdate,
  pickCoordinate,
  pickSpeed,
} from "../../lib/monitoring-helpers.js";
import { resolveEventLabelFromPayload } from "../../lib/event-translations.js";

const FALLBACK = "—";

function getAttributes(row) {
  return row?.position?.rawAttributes || row?.position?.attributes || row?.device?.attributes || row?.rawAttributes || {};
}

export const TELEMETRY_COLUMNS = [
  {
    key: "client",
    labelKey: "monitoring.columns.client",
    defaultVisible: true,
    getValue: (row) => {
      const attributes = getAttributes(row);
      return (
        row.clientName ||
        row.device?.client ||
        row.device?.customer ||
        row.device?.customerName ||
        attributes.client ||
        attributes.customer ||
        FALLBACK
      );
    },
  },
  {
    key: "vehicle",
    labelKey: "monitoring.columns.vehicle",
    defaultVisible: true,
    getValue: (row) => row.deviceName || row.vehicleName || row.vehicle?.name || FALLBACK,
  },
  {
    key: "plate",
    labelKey: "monitoring.columns.plate",
    defaultVisible: true,
    getValue: (row) => row.plate || row.vehicle?.plate || row.vehicleName || FALLBACK,
  },
  {
    key: "deviceId",
    labelKey: "monitoring.columns.deviceId",
    defaultVisible: true,
    getValue: (row) => row.principalDeviceId || row.deviceId || row.traccarId || row.device?.traccarId || FALLBACK,
  },
  {
    key: "id",
    labelKey: "monitoring.columns.id",
    defaultVisible: false,
    getValue: (row) => row.position?.id ?? FALLBACK,
  },
  {
    key: "protocol",
    labelKey: "monitoring.columns.protocol",
    defaultVisible: true,
    getValue: (row) => {
      const attributes = getAttributes(row);
      return row.position?.protocol || row.device?.protocol || attributes.protocol || FALLBACK;
    },
  },
  {
    key: "serverTime",
    labelKey: "monitoring.columns.serverTime",
    defaultVisible: true,
    getValue: (row, helpers = {}) =>
      formatDateTime(
        getLastUpdate(row.position) || (row.lastCommunication ? new Date(row.lastCommunication) : null),
        helpers.locale,
      ),
  },
  {
    key: "deviceTime",
    labelKey: "monitoring.columns.deviceTime",
    defaultVisible: true,
    getValue: (row, helpers = {}) =>
      formatDateTime(row.position?.deviceTime ? new Date(row.position.deviceTime) : null, helpers.locale),
  },
  {
    key: "gpsTime",
    labelKey: "monitoring.columns.fixTime",
    defaultVisible: true,
    getValue: (row, helpers = {}) => {
      const date = row.position?.fixTime || row.position?.time;
      return formatDateTime(date ? new Date(date) : null, helpers.locale);
    },
  },
  {
    key: "lastEvent",
    labelKey: "monitoring.columns.lastEvent",
    defaultVisible: true,
    getValue: (row, helpers = {}) => {
      const { label, raw, isFallback, icon } = resolveEventLabelFromPayload(row, helpers.locale, helpers.t);
      if (!label) return FALLBACK;
      const content = icon ? (
        <span className="inline-flex items-center gap-1">
          <span>{icon}</span>
          <span>{label}</span>
        </span>
      ) : (
        label
      );
      return isFallback && raw ? <span title={`Código bruto: ${raw}`}>{content}</span> : content;
    },
  },
  {
    key: "valid",
    labelKey: "monitoring.columns.valid",
    defaultVisible: true,
    getValue: (row, helpers = {}) => {
      const yes = helpers.t ? helpers.t("common.yes") : "Sim";
      const no = helpers.t ? helpers.t("common.no") : "Não";
      return row.position?.valid ? yes : no;
    },
  },
  {
    key: "latitude",
    labelKey: "monitoring.columns.latitude",
    defaultVisible: true,
    getValue: (row) => {
      const value = pickCoordinate([
        row.lat,
        row.latitude,
        row.position?.latitude,
        row.position?.lat,
        row.position?.attributes?.latitude,
        row.position?.rawAttributes?.latitude,
        row.position?.rawAttributes?.lat,
      ]);
      return Number.isFinite(value) ? value.toFixed(5) : FALLBACK;
    },
  },
  {
    key: "longitude",
    labelKey: "monitoring.columns.longitude",
    defaultVisible: true,
    getValue: (row) => {
      const value = pickCoordinate([
        row.lng,
        row.longitude,
        row.position?.longitude,
        row.position?.lon,
        row.position?.attributes?.longitude,
        row.position?.rawAttributes?.longitude,
        row.position?.rawAttributes?.lon,
        row.position?.rawAttributes?.lng,
      ]);
      return Number.isFinite(value) ? value.toFixed(5) : FALLBACK;
    },
  },
  {
    key: "altitude",
    labelKey: "monitoring.columns.altitude",
    defaultVisible: false,
    getValue: (row) => {
      const attributes = getAttributes(row);
      const value = row.position?.altitude ?? attributes.altitude;
      return value ?? FALLBACK;
    },
  },
  {
    key: "speed",
    labelKey: "monitoring.columns.speed",
    defaultVisible: true,
    getValue: (row) => {
      const speed = pickSpeed(row.position || {});
      return speed !== null ? `${speed} km/h` : FALLBACK;
    },
  },
  {
    key: "course",
    labelKey: "monitoring.columns.course",
    defaultVisible: false,
    getValue: (row) => {
      const attributes = getAttributes(row);
      return row.position?.course ?? attributes.course ?? FALLBACK;
    },
  },
  {
    key: "address",
    labelKey: "monitoring.columns.address",
    defaultVisible: true,
    getValue: (row) => {
      const value = formatAddress(row.position || row.device || row.vehicle);
      if (!value || value === "—") return FALLBACK;
      return value;
    },
  },
  {
    key: "accuracy",
    labelKey: "monitoring.columns.accuracy",
    defaultVisible: false,
    getValue: (row) => {
      const attributes = getAttributes(row);
      return row.position?.accuracy ?? attributes.accuracy ?? FALLBACK;
    },
  },
  {
    key: "geofenceIds",
    labelKey: "monitoring.columns.geofenceIds",
    defaultVisible: false,
    getValue: (row) => (row.position?.geofenceIds ? [].concat(row.position.geofenceIds).join(", ") : FALLBACK),
  },
  {
    key: "geofences",
    labelKey: "monitoring.columns.geofences",
    defaultVisible: false,
    getValue: (row) => {
      const names = row.position?.geofences || row.device?.geofences;
      if (Array.isArray(names) && names.length) return names.join(", ");
      if (row.position?.geofenceIds) return [].concat(row.position.geofenceIds).join(", ");
      return FALLBACK;
    },
  },
  {
    key: "mappedAttributes",
    labelKey: "monitoring.columns.customTelemetry",
    defaultVisible: false,
    getValue: (row) => {
      const entries = Object.entries(row.position?.mappedAttributes || {});
      if (!entries.length) return FALLBACK;
      return entries
        .map(([label, value]) => `${label}: ${value}`)
        .join(" · ");
    },
  },
  {
    key: "type",
    labelKey: "monitoring.columns.type",
    defaultVisible: false,
    getValue: (row) => {
      const attributes = getAttributes(row);
      return row.position?.type ?? attributes.type ?? FALLBACK;
    },
  },
  {
    key: "status",
    labelKey: "monitoring.columns.status",
    defaultVisible: true,
    getValue: (row) => {
      if (row.statusBadge?.label) return row.statusBadge.label;
      const status = deriveStatus(row.position);
      if (status === "online") return "Online";
      if (status === "alert") return "Alerta";
      if (status === "blocked") return "Bloqueado";
      return row.connectionStatusLabel || "Offline";
    },
  },
  {
    key: "ignition",
    labelKey: "monitoring.columns.ignition",
    defaultVisible: true,
    getValue: (row, helpers = {}) => {
      const yes = helpers.t ? helpers.t("common.yes") : "Sim";
      const no = helpers.t ? helpers.t("common.no") : "Não";
      const ignition = typeof row.ignition === "boolean" ? row.ignition : getIgnition(row.position, row.device);
      if (ignition === true) return helpers.t ? helpers.t("monitoring.ignitionOn") : yes;
      if (ignition === false) return helpers.t ? helpers.t("monitoring.ignitionOff") : no;
      return FALLBACK;
    },
  },
  {
    key: "voltage",
    labelKey: "monitoring.columns.voltage",
    defaultVisible: true,
    getValue: (row) => {
      const attributes = getAttributes(row);
      const value =
        row.position?.voltage ??
        row.position?.attributes?.voltage ??
        row.position?.attributes?.externalVoltage ??
        row.position?.attributes?.vbat ??
        row.position?.attributes?.batteryVoltage ??
        row.position?.attributes?.power ??
        row.position?.attributes?.adc ??
        attributes.voltage ??
        attributes.externalVoltage ??
        attributes.vbat ??
        attributes.batteryVoltage ??
        attributes.power ??
        attributes.adc ??
        null;
      const numeric = Number(value);
      if (!Number.isFinite(numeric)) return FALLBACK;
      return `${numeric.toFixed(1)} V`;
    },
  },
  {
    key: "charge",
    labelKey: "monitoring.columns.charge",
    defaultVisible: false,
    getValue: (row) => {
      const attributes = getAttributes(row);
      return row.position?.charge ?? attributes.charge ?? FALLBACK;
    },
  },
  {
    key: "blocked",
    labelKey: "monitoring.columns.blocked",
    defaultVisible: false,
    getValue: (row, helpers = {}) => {
      const yes = helpers.t ? helpers.t("common.yes") : "Sim";
      const no = helpers.t ? helpers.t("common.no") : "Não";
      const attributes = getAttributes(row);
      return row.position?.blocked || attributes.blocked ? yes : no;
    },
  },
  {
    key: "batteryLevel",
    labelKey: "monitoring.columns.batteryLevel",
    defaultVisible: false,
    getValue: (row) => {
      const attributes = getAttributes(row);
      return row.position?.batteryLevel ?? attributes.batteryLevel ?? attributes.battery ?? FALLBACK;
    },
  },
  {
    key: "faceRecognition",
    labelKey: "monitoring.columns.faceRecognition",
    defaultVisible: false,
    getValue: (row) => {
      const attributes = row.position?.attributes || row.device?.attributes || {};
      const mediaUrl = attributes.faceRecognitionMediaUrl || attributes.faceRecognitionUrl || attributes.faceRecognition;
      const thumbnail = attributes.faceRecognitionThumbnail || attributes.faceRecognitionThumb || mediaUrl;
      const status = attributes.faceRecognitionStatus ?? attributes.faceRecognitionSuccess ?? attributes.faceRecognition;

      if (!mediaUrl && !thumbnail && !status) return "—";

      return (
        <FaceRecognitionCell
          mediaUrl={mediaUrl || thumbnail}
          thumbnail={thumbnail || mediaUrl}
          status={status}
        />
      );
    },
  },
  {
    key: "rssi",
    labelKey: "monitoring.columns.rssi",
    defaultVisible: false,
    getValue: (row) => {
      const attributes = getAttributes(row);
      return row.position?.rssi ?? attributes.rssi ?? FALLBACK;
    },
  },
  {
    key: "distance",
    labelKey: "monitoring.columns.distance",
    defaultVisible: false,
    getValue: (row) => {
      const attributes = getAttributes(row);
      return row.position?.distance ?? attributes.distance ?? FALLBACK;
    },
  },
  {
    key: "totalDistance",
    labelKey: "monitoring.columns.totalDistance",
    defaultVisible: false,
    getValue: (row) => {
      const attributes = getAttributes(row);
      return row.position?.totalDistance ?? attributes.totalDistance ?? attributes.odometer ?? FALLBACK;
    },
  },
  {
    key: "motion",
    labelKey: "monitoring.columns.motion",
    defaultVisible: false,
    getValue: (row, helpers = {}) => {
      const yes = helpers.t ? helpers.t("common.yes") : "Sim";
      const no = helpers.t ? helpers.t("common.no") : "Não";
      const attributes = getAttributes(row);
      return row.position?.motion || attributes.motion ? yes : no;
    },
  },
  {
    key: "hours",
    labelKey: "monitoring.columns.hours",
    defaultVisible: false,
    getValue: (row) => {
      const attributes = getAttributes(row);
      return row.position?.hours ?? attributes.hours ?? FALLBACK;
    },
  },
  {
    key: "notes",
    labelKey: "monitoring.columns.notes",
    defaultVisible: false,
    getValue: (row) => row.device?.notes || row.device?.observations || row.device?.attributes?.notes || FALLBACK,
  },
];

function FaceRecognitionCell({ mediaUrl, thumbnail, status }) {
  const hasMedia = Boolean(mediaUrl || thumbnail);
  const success = status === true || status === "success" || status === "ok" || status === 1;

  if (!hasMedia) return "—";

  return (
    <div className="group relative inline-flex items-center gap-2 text-emerald-300">
      <span className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-emerald-400/40 bg-emerald-500/10 text-[11px] font-semibold">
        📷
      </span>
      <span className="text-[10px] uppercase tracking-wide">{success ? "OK" : "Registrado"}</span>

      <div className="pointer-events-none absolute left-1/2 top-full z-40 hidden w-56 -translate-x-1/2 translate-y-2 rounded-xl border border-white/10 bg-[#0b0f17] p-2 text-white shadow-3xl group-hover:block">
        <div className="mb-2 text-[10px] uppercase tracking-wide text-white/60">Reconhecimento facial</div>
        <div className="overflow-hidden rounded-lg border border-white/10 bg-black/30">
          {mediaUrl?.endsWith(".mp4") || mediaUrl?.endsWith(".webm") ? (
            <video className="h-full w-full" src={mediaUrl} controls muted playsInline />
          ) : (
            <img src={thumbnail || mediaUrl} alt="Reconhecimento facial" className="h-full w-full object-cover" />
          )}
        </div>
      </div>
    </div>
  );
}

export function getTelemetryColumnByKey(key) {
  return TELEMETRY_COLUMNS.find((column) => column.key === key) || null;
}

export function resolveTelemetryColumns(keys) {
  if (!Array.isArray(keys) || !keys.length) return TELEMETRY_COLUMNS;
  return keys
    .map((key) => getTelemetryColumnByKey(key))
    .filter(Boolean)
    .concat(TELEMETRY_COLUMNS.filter((column) => keys.includes(column.key) === false));
}
