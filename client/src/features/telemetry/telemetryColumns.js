import { formatAddress } from "../../lib/format-address.js";
import {
  deriveStatus,
  formatDateTime,
  getIgnition,
  getLastUpdate,
  pickCoordinate,
  pickSpeed,
} from "../../lib/monitoring-helpers.js";

const FALLBACK = "—";

export const TELEMETRY_COLUMNS = [
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
    getValue: (row) => row.plate || row.vehicle?.plate || FALLBACK,
  },
  {
    key: "deviceId",
    labelKey: "monitoring.columns.deviceId",
    defaultVisible: true,
    getValue: (row) => row.deviceId || row.traccarId || row.device?.traccarId || FALLBACK,
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
    getValue: (row) => row.position?.protocol || row.device?.protocol || FALLBACK,
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
    getValue: (row) =>
      row.lastEventName || row.lastEvent?.type || row.lastEvent?.attributes?.alarm || row.position?.type || FALLBACK,
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
      ]);
      return Number.isFinite(value) ? value.toFixed(5) : FALLBACK;
    },
  },
  {
    key: "altitude",
    labelKey: "monitoring.columns.altitude",
    defaultVisible: false,
    getValue: (row) => row.position?.altitude ?? FALLBACK,
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
    getValue: (row) => row.position?.course ?? FALLBACK,
  },
  {
    key: "address",
    labelKey: "monitoring.columns.address",
    defaultVisible: true,
    getValue: (row) =>
      formatAddress(
        row.position?.formattedAddress ||
          row.position?.address ||
          row.position?.attributes?.address ||
          row.device?.address,
      ) || FALLBACK,
  },
  {
    key: "accuracy",
    labelKey: "monitoring.columns.accuracy",
    defaultVisible: false,
    getValue: (row) => row.position?.accuracy ?? FALLBACK,
  },
  {
    key: "geofenceIds",
    labelKey: "monitoring.columns.geofenceIds",
    defaultVisible: false,
    getValue: (row) => (row.position?.geofenceIds ? [].concat(row.position.geofenceIds).join(", ") : FALLBACK),
  },
  {
    key: "type",
    labelKey: "monitoring.columns.type",
    defaultVisible: false,
    getValue: (row) => row.position?.type ?? FALLBACK,
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
      const ignition = getIgnition(row.position, row.device);
      if (ignition === true) return helpers.t ? helpers.t("monitoring.ignitionOn") : yes;
      if (ignition === false) return helpers.t ? helpers.t("monitoring.ignitionOff") : no;
      return FALLBACK;
    },
  },
  {
    key: "charge",
    labelKey: "monitoring.columns.charge",
    defaultVisible: false,
    getValue: (row) => row.position?.charge ?? row.position?.attributes?.charge ?? FALLBACK,
  },
  {
    key: "blocked",
    labelKey: "monitoring.columns.blocked",
    defaultVisible: false,
    getValue: (row, helpers = {}) => {
      const yes = helpers.t ? helpers.t("common.yes") : "Sim";
      const no = helpers.t ? helpers.t("common.no") : "Não";
      return row.position?.blocked ? yes : no;
    },
  },
  {
    key: "batteryLevel",
    labelKey: "monitoring.columns.batteryLevel",
    defaultVisible: false,
    getValue: (row) => row.position?.batteryLevel ?? row.position?.attributes?.batteryLevel ?? FALLBACK,
  },
  {
    key: "rssi",
    labelKey: "monitoring.columns.rssi",
    defaultVisible: false,
    getValue: (row) => row.position?.rssi ?? row.position?.attributes?.rssi ?? FALLBACK,
  },
  {
    key: "distance",
    labelKey: "monitoring.columns.distance",
    defaultVisible: false,
    getValue: (row) => row.position?.distance ?? FALLBACK,
  },
  {
    key: "totalDistance",
    labelKey: "monitoring.columns.totalDistance",
    defaultVisible: false,
    getValue: (row) => row.position?.totalDistance ?? FALLBACK,
  },
  {
    key: "motion",
    labelKey: "monitoring.columns.motion",
    defaultVisible: false,
    getValue: (row, helpers = {}) => {
      const yes = helpers.t ? helpers.t("common.yes") : "Sim";
      const no = helpers.t ? helpers.t("common.no") : "Não";
      return row.position?.motion ? yes : no;
    },
  },
  {
    key: "hours",
    labelKey: "monitoring.columns.hours",
    defaultVisible: false,
    getValue: (row) => row.position?.hours ?? row.position?.attributes?.hours ?? FALLBACK,
  },
];

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
