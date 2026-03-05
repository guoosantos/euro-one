import React, { useMemo } from "react";
import { Info } from "lucide-react";
import { resolveTelemetryDescriptor, telemetryAliases } from "../../../../shared/telemetryDictionary.js";
import { getIgnition } from "../../lib/monitoring-helpers.js";

const MAX_VALUE_LENGTH = 180;

const MAIN_SENSOR_KEYS = [
  { key: "motion", label: "Movimento", attributeKeys: ["motion", "moving"] },
  { key: "speed", label: "Velocidade", attributeKeys: ["speed", "spd", "velocity"], unit: "km/h" },
  { key: "sat", label: "Satélites", attributeKeys: ["sat", "satellites", "satelliteCount"] },
  { key: "hdop", label: "Precisão GPS", attributeKeys: ["hdop", "horizontalDilution"] },
  { key: "rssi", label: "Sinal", attributeKeys: ["rssi", "signal", "gsm"], }
];

const POWER_SENSOR_KEYS = [
  { key: "batteryLevel", label: "Bateria", attributeKeys: ["batteryLevel"] },
  { key: "battery", label: "Bateria Dispositivo", attributeKeys: ["battery"] },
  { key: "vehicleVoltage", label: "Tensão do Veículo", attributeKeys: ["vehicleVoltage", "voltage", "vcc", "vbat", "power"] },
];

const IOTM_ITINERARY_KEYS = [
  {
    key: "geozoneId",
    label: "Itinerário",
    attributeKeys: [
      "geozoneId",
      "geozoneName",
      "geozoneGroupName",
      "geozoneGroup",
      "geozone",
      "geofenceId",
      "geofenceName",
      "geofence",
      "routeName",
      "itineraryName",
      "itineraryId",
      "itinerary",
      "itineraryLabel",
      "zone",
      "zoneName",
    ],
  },
  {
    key: "geozoneInside",
    label: "Dentro do Itinerário",
    attributeKeys: [
      "geozoneInsidePrimary",
      "geozoneInside",
      "geofenceInside",
      "insideGeofence",
      "zoneInside",
      "insideZone",
    ],
    isInside: true,
  },
];

const INPUT_KEY_REGEX = /^(?:in|input|entrada|digitalinput|digitalInput|di)_?(\d+)$/i;
const OUTPUT_KEY_REGEX = /^(?:out|output|saida|saída|digitaloutput|digitalOutput|do)_?(\d+)$/i;
const SIGNAL_IN_REGEX = /^signalIn(\d+)$/i;
const SIGNAL_OUT_REGEX = /^signalOut(\d+)$/i;
const IO_KEY_REGEX = /^io(\d+)$/i;

const SERIAL_PREFIXES = ["rs232", "rs485"];

const normalizeProtocolKey = (value) => String(value || "").trim().toLowerCase();

const toTitleCase = (value) =>
  String(value || "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");

const normalizeKey = (rawKey) => {
  if (!rawKey) return "";
  const cleaned = String(rawKey).trim();
  if (!cleaned) return "";
  const normalized = cleaned.toLowerCase();
  const compact = normalized.replace(/[^a-z0-9]/g, "");
  if (telemetryAliases?.[normalized]) return telemetryAliases[normalized];
  if (compact && telemetryAliases?.[compact]) return telemetryAliases[compact];
  return cleaned;
};

const normalizeIoState = (value) => {
  if (value === null || value === undefined) return null;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (!normalized) return null;
    if (["1", "true", "on", "high", "ativo", "ligado", "sim"].includes(normalized)) return true;
    if (["0", "false", "off", "low", "inativo", "desligado", "nao", "não"].includes(normalized)) return false;
  }
  return null;
};

const formatYesNo = (value) => {
  const normalized = normalizeIoState(value);
  if (normalized === null) return null;
  return normalized ? "Sim" : "Não";
};

const normalizeBlockedFlag = (value) => {
  const normalized = normalizeIoState(value);
  if (normalized !== null) return normalized;
  if (value === null || value === undefined) return null;
  const text = String(value).trim().toLowerCase();
  if (!text) return null;
  if (["blocked", "bloqueado", "lock", "locked", "immobilized", "imobilizado"].includes(text)) return true;
  if (["unblocked", "desbloqueado", "unlock", "unlocked", "enabled"].includes(text)) return false;
  return null;
};

const NUMERIC_META = {
  speed: { precision: 1, min: 0, max: 300 },
  distance: { precision: 2, scale: 0.001, min: 0, unit: "km" },
  totalDistance: { precision: 2, scale: 0.001, min: 0, unit: "km" },
  totalDistanceHighRes: { precision: 2, scale: 0.001, min: 0, unit: "km" },
  odometer: { precision: 2, scale: 0.001, min: 0, unit: "km" },
  obdOdometer: { precision: 2, scale: 0.001, min: 0, unit: "km" },
  tachoOdometer: { precision: 2, scale: 0.001, min: 0, unit: "km" },
  slot1Distance: { precision: 2, scale: 0.001, min: 0, unit: "km" },
  slot2Distance: { precision: 2, scale: 0.001, min: 0, unit: "km" },
  serviceDistance: { precision: 2, scale: 0.001, min: 0, unit: "km" },
  rangeKm: { precision: 1, min: 0, unit: "km" },
  batteryLevel: { precision: 0, min: 0, max: 100, unit: "%" },
  battery: { precision: 2, min: 0, max: 30, unit: "V" },
  vehicleVoltage: { precision: 2, min: 0, max: 60, unit: "V" },
  vcc: { precision: 2, min: 0, max: 60, unit: "V" },
  vbat: { precision: 2, min: 0, max: 60, unit: "V" },
  power: { precision: 2, min: 0, max: 60, unit: "V" },
  temperature: { precision: 1, min: -60, max: 200, unit: "°C" },
  deviceTemp: { precision: 1, min: -60, max: 200, unit: "°C" },
  engineTemperature: { precision: 1, min: -60, max: 200, unit: "°C" },
  acceleration: { precision: 2, min: -50, max: 50, unit: "m/s²" },
  hdop: { precision: 1, min: 0, max: 50 },
  sat: { precision: 0, min: 0, max: 100 },
  rssi: { precision: 0, min: -200, max: 200 },
  rpm: { precision: 0, min: 0, max: 20000, unit: "rpm" },
  hours: { precision: 1, min: 0, secondsToHours: true, unit: "h" },
  totalEngineHours: { precision: 1, min: 0, secondsToHours: true, unit: "h" },
  fuelUsed: { precision: 1, min: 0, unit: "L" },
  fuelUsedHighRes: { precision: 1, min: 0, unit: "L" },
  fuelLevel1: { precision: 0, min: 0, max: 100, unit: "%" },
  fuelLevel2: { precision: 0, min: 0, max: 100, unit: "%" },
  wheelSpeed: { precision: 1, min: 0, max: 300, unit: "km/h" },
  topSpeed: { precision: 1, min: 0, max: 300, unit: "km/h" },
  obdSpeed: { precision: 1, min: 0, max: 300, unit: "km/h" },
};

const formatNumber = (value, { unit = null, precision = 2 } = {}) => {
  const parsed = typeof value === "number" ? value : Number(String(value).replace(",", "."));
  if (!Number.isFinite(parsed)) return String(value);
  const rounded = Number(parsed.toFixed(precision));
  if (!Number.isFinite(rounded)) return String(value);
  return unit ? `${rounded} ${unit}` : String(rounded);
};

const formatValue = (value, descriptor = null, keyHint = null) => {
  if (value === null || value === undefined) return null;
  if (descriptor?.type === "boolean") {
    const normalized = normalizeIoState(value);
    if (normalized === null) return String(value);
    return normalized ? "ON" : "OFF";
  }
  if (typeof value === "boolean") return value ? "ON" : "OFF";
  const metaKey = keyHint ? String(keyHint) : null;
  const meta = metaKey && NUMERIC_META[metaKey] ? NUMERIC_META[metaKey] : null;
  if (descriptor?.type === "number" || typeof value === "number") {
    let parsed = typeof value === "number" ? value : Number(String(value).replace(",", "."));
    if (!Number.isFinite(parsed)) return String(value);
    if (meta?.scale) {
      if (meta.scale < 1 && Math.abs(parsed) > 1000) {
        parsed *= meta.scale;
      } else if (meta.scale >= 1) {
        parsed *= meta.scale;
      }
    }
    if (meta?.secondsToHours && parsed > 100_000) {
      parsed = parsed / 3600;
    }
    if ((meta?.min != null && parsed < meta.min) || (meta?.max != null && parsed > meta.max)) {
      return "Valor inválido";
    }
    return formatNumber(parsed, {
      unit: meta?.unit || descriptor?.unit || null,
      precision: meta?.precision ?? 2,
    });
  }
  if (typeof value === "string") {
    const text = value.trim();
    return text || "—";
  }
  try {
    const json = JSON.stringify(value);
    return json || "—";
  } catch {
    return String(value);
  }
};

const extractTimestamp = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return (
    value.time ||
    value.timestamp ||
    value.updatedAt ||
    value.lastUpdate ||
    value.lastUpdatedAt ||
    null
  );
};

const resolveLabel = (rawKey, descriptor, protocolKey) => {
  const baseLabel = descriptor?.labelPt || descriptor?.label || toTitleCase(rawKey);
  if (!protocolKey || !baseLabel) return baseLabel;
  if (protocolKey.includes("suntech")) {
    let cleaned = baseLabel
      .replace(/^status\s+para\s+indicar\s+que\s+/i, "")
      .replace(/^status\s+para\s+indicar\s+/i, "")
      .replace(/^status\s+/i, "")
      .replace(/^indicador\s+de\s+/i, "Indicador ")
      .trim();

    const digitalMatch = cleaned.match(/entrada\s+digital\s+(\d+)/i);
    if (digitalMatch) {
      cleaned = `Entrada Digital ${digitalMatch[1]}`;
    }

    return cleaned || baseLabel;
  }
  return baseLabel;
};

const resolveTextValue = (value) => {
  if (value === null || value === undefined) return "—";
  if (typeof value === "string") return value.trim() || "—";
  return String(value);
};

const findBlockedCandidate = (attributes = {}) => {
  if (!attributes || typeof attributes !== "object") return null;
  const entries = Object.entries(attributes);
  for (const [key, value] of entries) {
    const lower = String(key || "").toLowerCase();
    if (!lower) continue;
    if (lower.includes("blocked") || lower.includes("bloque") || lower.includes("lock") || lower.includes("immob")) {
      const normalized = normalizeBlockedFlag(value);
      if (normalized !== null) return { key, value };
    }
  }
  return null;
};

const resolveBlockedReason = (attributes = {}) => {
  if (!attributes || typeof attributes !== "object") return null;
  const directKeys = [
    "blockedReason",
    "blockReason",
    "blocked_reason",
    "block_reason",
    "blockedMessage",
    "blockMessage",
    "blocked_message",
    "block_message",
    "blockReasonMessage",
    "blockedReasonMessage",
  ];
  for (const key of directKeys) {
    if (attributes[key]) return resolveTextValue(attributes[key]);
  }

  const candidates = Object.entries(attributes)
    .filter(([key, value]) => {
      if (!value) return false;
      const normalized = String(key || "").toLowerCase();
      if (!normalized) return false;
      if (normalized.includes("block") || normalized.includes("bloque")) return true;
      if (normalized.includes("rs232")) return true;
      return false;
    })
    .map(([key, value]) => ({ key, value: resolveTextValue(value) }))
    .filter((item) => item.value && item.value !== "—");

  if (!candidates.length) return null;
  const withReason = candidates.find((item) => /reason|motivo|mensagem|message/i.test(item.key));
  return (withReason || candidates[0]).value;
};

const compactValue = (value) => {
  if (value === null || value === undefined) return "—";
  const text = typeof value === "string" ? value : String(value);
  if (text.length <= MAX_VALUE_LENGTH) return text;
  return `${text.slice(0, MAX_VALUE_LENGTH - 1).trim()}…`;
};

const extractIoMeta = (rawValue) => {
  if (rawValue && typeof rawValue === "object" && !Array.isArray(rawValue)) {
    return {
      state: normalizeIoState(rawValue.state ?? rawValue.value ?? rawValue.status ?? rawValue.active ?? rawValue.enabled ?? rawValue.on),
      updatedAt: rawValue.time || rawValue.timestamp || rawValue.updatedAt || rawValue.lastUpdate || rawValue.lastUpdatedAt || null,
      changedAt: rawValue.changedAt || rawValue.changeTime || rawValue.lastChange || null,
      origin: rawValue.origin || rawValue.source || rawValue.by || null,
    };
  }
  return { state: normalizeIoState(rawValue), updatedAt: null, changedAt: null, origin: null };
};

const extractIoIndexFromLabel = (label, kind) => {
  const text = String(label || "");
  if (!text) return null;
  if (kind === "input") {
    const digitalMatch = text.match(/entrada\s+digital\s+(\d+)/i);
    if (digitalMatch) return Number(digitalMatch[1]);
    const directMatch = text.match(/entrada\s+(\d+)/i);
    if (directMatch) return Number(directMatch[1]);
    const diMatch = text.match(/\bdi\s*(\d+)\b/i);
    if (diMatch) return Number(diMatch[1]);
    return null;
  }
  if (kind === "output") {
    const digitalMatch = text.match(/sa[ií]da\s+digital\s+(\d+)/i);
    if (digitalMatch) return Number(digitalMatch[1]);
    const directMatch = text.match(/sa[ií]da\s+(\d+)/i);
    if (directMatch) return Number(directMatch[1]);
    const doMatch = text.match(/\bdo\s*(\d+)\b/i);
    if (doMatch) return Number(doMatch[1]);
  }
  return null;
};

const resolveIoLabelFromAttributes = (attributes, kind, index) => {
  if (!attributes || !index) return null;
  const keyPrefixes = kind === "input"
    ? ["input", "in", "entrada", "di", "digitalInput", "digitalinput"]
    : ["output", "out", "saida", "saída", "do", "digitalOutput", "digitaloutput"];

  const keySuffixes = ["Label", "Name", "Nome", "Descricao", "Description"];
  for (const prefix of keyPrefixes) {
    for (const suffix of keySuffixes) {
      const direct = `${prefix}${index}${suffix}`;
      if (attributes[direct]) return resolveTextValue(attributes[direct]);
      const underscored = `${prefix}_${index}_${suffix.toLowerCase()}`;
      if (attributes[underscored]) return resolveTextValue(attributes[underscored]);
    }
  }

  const labelContainers = [
    attributes.ioLabels,
    attributes.inputLabels,
    attributes.outputLabels,
    attributes.inputs,
    attributes.outputs,
    attributes.digitalInputs,
    attributes.digitalOutputs,
  ];

  for (const container of labelContainers) {
    if (!container) continue;
    if (Array.isArray(container)) {
      const entry = container[index - 1];
      if (!entry) continue;
      if (typeof entry === "string") return resolveTextValue(entry);
      if (typeof entry === "object") {
        const label = entry.label || entry.name || entry.title;
        if (label) return resolveTextValue(label);
      }
      continue;
    }
    if (typeof container === "object") {
      const keyVariants = keyPrefixes.flatMap((prefix) => [
        `${prefix}${index}`,
        `${prefix}_${index}`,
      ]);
      for (const variant of keyVariants) {
        if (container[variant]) return resolveTextValue(container[variant]);
      }
    }
  }

  return null;
};

const collectDigitalIo = (attributes = {}, updatedAtLabel, protocolKey) => {
  const inputs = new Map();
  const outputs = new Map();
  const usedKeys = new Set();

  const assign = (target, index, rawValue, sourceKey, labelOverride = null) => {
    if (!Number.isFinite(index)) return;
    const existing = target.get(index) || { index, rawValue: null, state: null, updatedAt: null, changedAt: null, origin: null, labelOverride: null, sourceKeys: new Set() };
    const meta = extractIoMeta(rawValue);
    if (meta.state !== null) existing.state = meta.state;
    if (existing.rawValue === null) existing.rawValue = rawValue;
    existing.updatedAt = meta.updatedAt || existing.updatedAt || updatedAtLabel;
    existing.changedAt = meta.changedAt || existing.changedAt || null;
    existing.origin = meta.origin || existing.origin || null;
    if (labelOverride) existing.labelOverride = labelOverride;
    if (sourceKey) {
      existing.sourceKeys.add(sourceKey);
      usedKeys.add(sourceKey);
    }
    target.set(index, existing);
  };

  Object.entries(attributes || {}).forEach(([rawKey, rawValue]) => {
    const key = String(rawKey || "").trim();
    if (!key) return;
    const lowerKey = key.toLowerCase();
    if (lowerKey === "input") {
      assign(inputs, 1, rawValue, key);
      return;
    }
    if (lowerKey === "output") {
      assign(outputs, 1, rawValue, key);
      return;
    }
    let match = key.match(INPUT_KEY_REGEX) || key.match(SIGNAL_IN_REGEX);
    if (match) {
      const index = Number(match[1]);
      assign(inputs, index, rawValue, key);
      return;
    }
    match = key.match(OUTPUT_KEY_REGEX) || key.match(SIGNAL_OUT_REGEX);
    if (match) {
      const index = Number(match[1]);
      assign(outputs, index, rawValue, key);
      return;
    }

    const ioMatch = key.match(IO_KEY_REGEX);
    if (ioMatch) {
      const descriptor = resolveTelemetryDescriptor(key) || resolveTelemetryDescriptor(key.toLowerCase());
      const label = descriptor?.labelPt || "";
      const inputIndex = extractIoIndexFromLabel(label, "input");
      if (inputIndex) {
        const index = Number(inputIndex);
        assign(inputs, index, rawValue, key, label);
        return;
      }
      const outputIndex = extractIoIndexFromLabel(label, "output");
      if (outputIndex) {
        const index = Number(outputIndex);
        assign(outputs, index, rawValue, key, label);
        return;
      }
    }

    if (/^\\d+$/.test(key)) {
      const descriptor = resolveTelemetryDescriptor(key) || resolveTelemetryDescriptor(key.toLowerCase());
      const label = descriptor?.labelPt || "";
      const inputIndex = extractIoIndexFromLabel(label, "input");
      if (inputIndex) {
        const index = Number(inputIndex);
        assign(inputs, index, rawValue, key, label);
        return;
      }
      const outputIndex = extractIoIndexFromLabel(label, "output");
      if (outputIndex) {
        const index = Number(outputIndex);
        assign(outputs, index, rawValue, key, label);
        return;
      }
    }
  });

  const collections = [
    { kind: "input", keys: ["inputs", "input", "digitalInputs", "digitalInput"] },
    { kind: "output", keys: ["outputs", "output", "digitalOutputs", "digitalOutput"] },
  ];

  collections.forEach(({ kind, keys }) => {
    keys.forEach((key) => {
      const collection = attributes?.[key];
      if (!collection) return;
      const target = kind === "input" ? inputs : outputs;
      if (Array.isArray(collection)) {
        collection.forEach((entry, idx) => {
          const index = idx + 1;
          if (entry && typeof entry === "object" && !Array.isArray(entry)) {
            const label = entry.label || entry.name || entry.title || null;
            assign(target, index, entry.state ?? entry.value ?? entry.raw ?? entry, key, label);
          } else {
            assign(target, index, entry, key);
          }
        });
        usedKeys.add(key);
        return;
      }
      if (typeof collection === "object") {
        Object.entries(collection).forEach(([entryKey, entryValue]) => {
          const index = Number(entryKey);
          if (Number.isFinite(index)) {
            assign(target, index, entryValue, key);
          }
        });
        usedKeys.add(key);
      }
    });
  });

  const formatEntry = (entry, kind) => {
    const rawLabel = entry.labelOverride || resolveIoLabelFromAttributes(attributes, kind, entry.index);
    const labelOverride = rawLabel ? resolveLabel(rawLabel, null, protocolKey) : null;
    const fallbackLabel = kind === "input"
      ? `Entrada ${entry.index} (DI${entry.index})`
      : `Saída ${entry.index} (DO${entry.index})`;
    return {
      index: entry.index,
      label: labelOverride || fallbackLabel,
      channel: kind === "input" ? `DI${entry.index}` : `DO${entry.index}`,
      state: entry.state,
      updatedAt: entry.updatedAt || updatedAtLabel,
      changedAt: entry.changedAt,
      origin: entry.origin,
      rawValue: entry.rawValue,
      sourceKeys: Array.from(entry.sourceKeys || []),
    };
  };

  return {
    inputs: Array.from(inputs.values()).map((entry) => formatEntry(entry, "input")),
    outputs: Array.from(outputs.values()).map((entry) => formatEntry(entry, "output")),
    usedKeys,
  };
};

const collectSerialEntries = (attributes = {}, updatedAtLabel) => {
  const groups = new Map();
  const usedKeys = new Set();

  Object.entries(attributes || {}).forEach(([rawKey, rawValue]) => {
    const key = String(rawKey || "").trim();
    if (!key) return;
    const lower = key.toLowerCase();
    const matchedPrefix = SERIAL_PREFIXES.find((prefix) => lower.includes(prefix));
    if (!matchedPrefix) return;
    const channel = matchedPrefix.toUpperCase();
    if (!groups.has(channel)) {
      groups.set(channel, []);
    }
    groups.get(channel).push({ key, value: rawValue });
    usedKeys.add(key);
  });

  const entries = Array.from(groups.entries()).map(([channel, fields]) => {
    const lines = fields.map((field) => {
      const cleanedKey = field.key.replace(new RegExp(channel.toLowerCase(), "i"), "").replace(/[_-]+/g, " ").trim();
      const label = cleanedKey ? toTitleCase(cleanedKey) : "Mensagem";
      const descriptor = resolveTelemetryDescriptor(normalizeKey(field.key));
      return {
        label: label || field.key,
        value: formatValue(field.value, descriptor) || resolveTextValue(field.value),
      };
    });

    const enabledField = fields.find((field) => /enabled|enable|ativo|active/i.test(field.key));
    const enabled = enabledField ? normalizeIoState(enabledField.value) : null;
    const hasPayload = fields.some((field) => field.value !== null && field.value !== undefined && String(field.value).trim() !== "");
    let status = "Sem dados";
    if (enabled === false) status = "Desabilitado";
    if (enabled !== false && hasPayload) status = "Ativo";

    return {
      channel,
      status,
      updatedAt: updatedAtLabel,
      lines,
    };
  });

  return { entries, usedKeys };
};

const collectMainSensors = ({ attributes, position, device, protocolKey, updatedAtLabel }) => {
  const usedKeys = new Set();
  const entries = [];
  let detectedInsideValue = null;

  const pickFromAttributes = (keys) => {
    for (const key of keys) {
      if (attributes?.[key] !== undefined && attributes?.[key] !== null) {
        usedKeys.add(key);
        return { value: attributes[key], sourceKey: key };
      }
      const normalized = normalizeKey(key);
      if (normalized !== key && attributes?.[normalized] !== undefined && attributes?.[normalized] !== null) {
        usedKeys.add(normalized);
        return { value: attributes[normalized], sourceKey: normalized };
      }
    }
    return null;
  };

  const buildEntry = ({ key, label, attributeKeys = [], fallbackValue = null, unit = null, formatter = null, isInside = false }) => {
    const picked = attributeKeys.length ? pickFromAttributes(attributeKeys) : null;
    const rawValue = picked?.value ?? fallbackValue;
    if (rawValue === null || rawValue === undefined) return;
    const descriptor = resolveTelemetryDescriptor(normalizeKey(key)) || resolveTelemetryDescriptor(normalizeKey(picked?.sourceKey));
    const resolvedLabel = resolveLabel(label || key, descriptor, protocolKey);
    const formatted = formatter
      ? formatter(rawValue, descriptor)
      : descriptor?.type === "number" || typeof rawValue === "number"
        ? formatValue(rawValue, descriptor, normalizeKey(key))
        : unit
          ? formatNumber(rawValue, { unit })
          : formatValue(rawValue, descriptor, normalizeKey(key));
    if (!formatted) return;
    if (isInside) {
      const normalized = normalizeIoState(rawValue);
      if (normalized !== null) detectedInsideValue = normalized;
    }
    entries.push({
      key,
      label: resolvedLabel,
      value: formatted,
      rawValue,
      updatedAt: updatedAtLabel,
      descriptor,
      sourceKey: picked?.sourceKey || null,
    });
  };

  const ignitionValue = getIgnition(position, device);
  buildEntry({ key: "ignitionState", label: "Ignição", attributeKeys: ["ignition", "ignitionState", "acc", "ign"], fallbackValue: ignitionValue });

  const blockedRawCandidate =
    position?.blocked ??
    position?.attributes?.blocked ??
    attributes?.blocked ??
    device?.blocked ??
    device?.attributes?.blocked ??
    null;
  const blockedFallback = blockedRawCandidate == null ? findBlockedCandidate(attributes) : null;
  const blockedRaw = blockedRawCandidate ?? blockedFallback?.value ?? null;
  const blockedValue = normalizeBlockedFlag(blockedRaw);
  if (blockedValue !== null && blockedValue !== undefined) {
    usedKeys.add("blocked");
    entries.push({
      key: "blocked",
      label: "Bloqueado",
      value: formatYesNo(blockedValue) || "—",
      rawValue: blockedRaw,
      updatedAt: updatedAtLabel,
      descriptor: null,
      sourceKey: "blocked",
    });
  }
  const blockedReason = blockedValue ? resolveBlockedReason(attributes) : null;
  if (blockedReason) {
    entries.push({
      key: "blockedReason",
      label: "Motivo do bloqueio",
      value: blockedReason,
      rawValue: blockedReason,
      updatedAt: updatedAtLabel,
      descriptor: null,
      sourceKey: null,
    });
  }

  MAIN_SENSOR_KEYS.forEach((entry) => {
    buildEntry({
      key: entry.key,
      label: entry.label,
      attributeKeys: entry.attributeKeys,
      fallbackValue: entry.key === "speed" ? position?.speed : null,
      unit: entry.unit,
    });
  });

  POWER_SENSOR_KEYS.forEach((entry) => {
    buildEntry({
      key: entry.key,
      label: entry.label,
      attributeKeys: entry.attributeKeys,
      fallbackValue: entry.key === "batteryLevel" ? position?.batteryLevel : null,
    });
  });

  IOTM_ITINERARY_KEYS.forEach((entry) => {
    buildEntry({
      key: entry.key,
      label: entry.label,
      attributeKeys: entry.attributeKeys,
      formatter: entry.key === "geozoneInside" ? (value) => formatYesNo(value) : null,
      isInside: entry.isInside === true,
    });
  });

  const insidePick = pickFromAttributes([
    "geozoneInsidePrimary",
    "geozoneInside",
    "geofenceInside",
    "insideGeofence",
    "zoneInside",
    "insideZone",
  ]);
  const insideValue = normalizeIoState(insidePick?.value) ?? detectedInsideValue;
  if (insideValue !== null) {
    entries.push({
      key: "itineraryDeviation",
      label: "Desvio do Itinerário",
      value: insideValue ? "Não" : "Sim",
      rawValue: insideValue,
      updatedAt: updatedAtLabel,
      descriptor: null,
      sourceKey: insidePick?.sourceKey || null,
    });
  }

  const promotedKeys = new Set(entries.map((entry) => entry.key));
  Object.entries(attributes || {}).forEach(([rawKey, rawValue]) => {
    if (!rawKey) return;
    if (usedKeys.has(rawKey)) return;
    const descriptor = resolveTelemetryDescriptor(normalizeKey(rawKey)) || resolveTelemetryDescriptor(String(rawKey).toLowerCase());
    const label = descriptor?.labelPt || descriptor?.label || "";
    if (!label) return;
    if (!promotedKeys.has("geozoneId") && /itiner[áa]rio/i.test(label) && !/dentro/i.test(label)) {
      const formatted = resolveTextValue(rawValue);
      if (formatted && formatted !== "—") {
        entries.push({
          key: "geozoneId",
          label: "Itinerário",
          value: formatted,
          rawValue,
          updatedAt: updatedAtLabel,
          descriptor,
          sourceKey: rawKey,
        });
        usedKeys.add(rawKey);
        promotedKeys.add("geozoneId");
      }
      return;
    }
    if (!promotedKeys.has("geozoneInside") && /dentro do itiner[áa]rio/i.test(label)) {
      const formatted = formatYesNo(rawValue) || resolveTextValue(rawValue);
      entries.push({
        key: "geozoneInside",
        label: "Dentro do Itinerário",
        value: formatted,
        rawValue,
        updatedAt: updatedAtLabel,
        descriptor,
        sourceKey: rawKey,
      });
      const normalized = normalizeIoState(rawValue);
      if (normalized !== null) detectedInsideValue = normalized;
      usedKeys.add(rawKey);
      promotedKeys.add("geozoneInside");
    }
  });

  return { entries, usedKeys };
};

const collectOtherEntries = ({ attributes, protocolKey, updatedAtLabel, usedKeys }) => {
  const entries = [];
  Object.entries(attributes || {}).forEach(([rawKey, rawValue]) => {
    if (!rawKey) return;
    if (usedKeys.has(rawKey)) return;
    if (rawValue === null || rawValue === undefined || rawValue === "") return;
    const normalizedKey = normalizeKey(rawKey);
    const descriptor = resolveTelemetryDescriptor(normalizedKey) || resolveTelemetryDescriptor(String(rawKey).toLowerCase());
    const label = resolveLabel(rawKey, descriptor, protocolKey);
    const formatted = formatValue(rawValue, descriptor, normalizedKey) || resolveTextValue(rawValue);
    entries.push({
      key: rawKey,
      label,
      value: formatted,
      rawValue,
      updatedAt: extractTimestamp(rawValue) || updatedAtLabel,
      description: descriptor?.descriptionPt || descriptor?.description || null,
    });
  });

  entries.sort((a, b) => String(a.label).localeCompare(String(b.label), "pt-BR"));
  return entries;
};

function StatusSection({ title, children, muted = false }) {
  return (
    <section className={`rounded-xl border border-white/5 px-4 py-3 shadow-inner shadow-black/20 ${muted ? "bg-white/5" : "bg-white/10"}`}>
      <h3 className="text-[12px] uppercase tracking-[0.14em] text-white/60">{title}</h3>
      <div className="mt-2 space-y-2 text-sm text-white/80">{children}</div>
    </section>
  );
}

function TruncatedText({ text, className = "", lines = 1 }) {
  const content = text ?? "—";
  const clampClass = lines > 1 ? "line-clamp-2" : "truncate";
  return (
    <span className={`${clampClass} ${className}`} title={content}>
      {content}
    </span>
  );
}

function StatusCard({ label, value, updatedAt }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-3">
      <div className="flex items-center gap-2 text-sm text-white">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/10 text-white/70">
          <Info size={16} />
        </span>
        <div className="min-w-0">
          <TruncatedText text={label} className="text-xs uppercase tracking-[0.12em] text-white/50" />
          <TruncatedText text={value} className="text-base font-semibold text-white" lines={2} />
        </div>
      </div>
      {updatedAt ? (
        <p className="mt-2 text-[10px] uppercase tracking-[0.12em] text-white/50">
          Última atualização • {updatedAt}
        </p>
      ) : null}
    </div>
  );
}

function IoCard({ label, channel, state, updatedAt, changedAt, origin }) {
  const stateLabel = state === null || state === undefined ? "—" : state ? "ON" : "OFF";
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <TruncatedText text={label} className="text-xs uppercase tracking-[0.12em] text-white/50" />
          <TruncatedText text={channel} className="text-[11px] text-white/40" />
        </div>
        <span className={`rounded-full px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] ${state ? "bg-emerald-500/20 text-emerald-200" : "bg-white/10 text-white/70"}`}>
          {stateLabel}
        </span>
      </div>
      <div className="mt-2 space-y-1 text-[11px] text-white/60">
        {updatedAt ? <p>Atualizado • {updatedAt}</p> : null}
        {changedAt ? <p>Última mudança • {resolveTextValue(changedAt)}</p> : null}
        {origin ? <p>Origem • {resolveTextValue(origin)}</p> : null}
      </div>
    </div>
  );
}

function SerialCard({ channel, status, updatedAt, lines }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-xs uppercase tracking-[0.12em] text-white/50">{channel}</p>
          <p className="mt-1 text-sm font-semibold text-white">{status}</p>
        </div>
        {updatedAt ? (
          <p className="text-[10px] uppercase tracking-[0.12em] text-white/40">{updatedAt}</p>
        ) : null}
      </div>
      <div className="mt-2 space-y-1 text-[11px] text-white/60">
        {lines.map((line) => (
          <div key={line.label} className="flex items-start justify-between gap-2">
            <span className="text-white/50">{line.label}</span>
            <TruncatedText text={compactValue(line.value)} className="max-w-[60%] text-right text-white" lines={2} />
          </div>
        ))}
      </div>
    </div>
  );
}

function OtherFieldCard({ label, value, description, updatedAt, rawKey }) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/70">
      <div className="flex items-center justify-between gap-2">
        <TruncatedText text={label} className="text-[10px] uppercase tracking-[0.12em] text-white/50" />
        <span className="text-[10px] text-white/30">{rawKey}</span>
      </div>
      <p className="mt-1 text-sm text-white" title={value}>{compactValue(value)}</p>
      {description ? <p className="mt-1 text-[11px] text-white/40">{description}</p> : null}
      {updatedAt ? <p className="mt-1 text-[10px] uppercase tracking-[0.12em] text-white/40">{updatedAt}</p> : null}
    </div>
  );
}

export default function ProtocolStatusRenderer({ device, position, protocol, latestPosition }) {
  const updatedAtLabel = latestPosition ? new Date(latestPosition).toLocaleString() : null;
  const protocolKey = normalizeProtocolKey(protocol || device?.protocol || position?.protocol || device?.attributes?.protocol);

  const attributes = useMemo(() => ({
    ...(device?.attributes || {}),
    ...(position?.attributes || {}),
  }), [device?.attributes, position?.attributes]);

  const { mainEntries, inputEntries, outputEntries, serialEntries, otherEntries } = useMemo(() => {
    const usedKeys = new Set();

    const main = collectMainSensors({ attributes, position, device, protocolKey, updatedAtLabel });
    main.usedKeys.forEach((key) => usedKeys.add(key));

    const io = collectDigitalIo(attributes, updatedAtLabel, protocolKey);
    io.usedKeys.forEach((key) => usedKeys.add(key));

    const serial = collectSerialEntries(attributes, updatedAtLabel);
    serial.usedKeys.forEach((key) => usedKeys.add(key));

    const others = collectOtherEntries({ attributes, protocolKey, updatedAtLabel, usedKeys });

    const promotedMain = [...main.entries];
    const remainingOthers = [];
    const mainKeys = new Set(promotedMain.map((entry) => String(entry.key)));
    const hasMainLabel = (label) =>
      promotedMain.some((entry) => String(entry.label || "").toLowerCase() === String(label || "").toLowerCase());

    const pushMain = (entry, overrides = {}) => {
      const key = overrides.key || entry.key;
      if (mainKeys.has(String(key)) && !overrides.force) return;
      if (overrides.label && hasMainLabel(overrides.label) && !overrides.force) return;
      const next = { ...entry, ...overrides, key };
      promotedMain.push(next);
      mainKeys.add(String(key));
    };

    others.forEach((entry) => {
      const label = String(entry.label || "").toLowerCase();
      const rawKey = String(entry.key || "").toLowerCase();
      if (/(itiner|itinerary|rota)/i.test(label) && !/dentro/i.test(label)) {
        pushMain(entry, { key: "geozoneId", label: "Itinerário" });
        return;
      }
      if (/dentro.*itiner/i.test(label)) {
        const normalized = normalizeIoState(entry.rawValue);
        pushMain(entry, {
          key: "geozoneInside",
          label: "Dentro do Itinerário",
          value: formatYesNo(entry.rawValue) || entry.value,
        });
        if (normalized !== null) {
          pushMain(entry, {
            key: "itineraryDeviation",
            label: "Desvio do Itinerário",
            value: normalized ? "Não" : "Sim",
          });
        }
        return;
      }
      if (/(bloque|blocked|lock|immob)/i.test(label) || /(bloque|blocked|lock|immob)/i.test(rawKey)) {
        const normalized = normalizeBlockedFlag(entry.rawValue);
        pushMain(entry, {
          key: "blocked",
          label: "Bloqueado",
          value: normalized === null ? entry.value : formatYesNo(normalized),
        });
        return;
      }
      if (/motivo.*bloque|bloqueio/i.test(label) || /block.*reason|reason.*block/i.test(rawKey)) {
        pushMain(entry, { key: "blockedReason", label: "Motivo do bloqueio" });
        return;
      }
      remainingOthers.push(entry);
    });

    return {
      mainEntries: promotedMain,
      inputEntries: io.inputs,
      outputEntries: io.outputs,
      serialEntries: serial.entries,
      otherEntries: remainingOthers,
    };
  }, [attributes, device, position, protocolKey, updatedAtLabel]);

  return (
    <>
      <StatusSection title="Sensores principais">
        {mainEntries.length ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {mainEntries.map((sensor) => (
              <StatusCard
                key={sensor.key}
                label={sensor.label}
                value={sensor.value}
                updatedAt={sensor.updatedAt}
              />
            ))}
          </div>
        ) : (
          <p className="text-xs text-white/60">Nenhum sensor principal disponível para este protocolo.</p>
        )}
      </StatusSection>

      <StatusSection title="Entradas">
        {inputEntries.length ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {inputEntries.map((entry) => (
              <IoCard
                key={`input-${entry.index}`}
                label={entry.label}
                channel={entry.channel}
                state={entry.state}
                updatedAt={entry.updatedAt}
                changedAt={entry.changedAt}
                origin={entry.origin}
              />
            ))}
          </div>
        ) : (
          <p className="text-xs text-white/60">Nenhuma entrada disponível.</p>
        )}
      </StatusSection>

      <StatusSection title="Saídas">
        {outputEntries.length ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {outputEntries.map((entry) => (
              <IoCard
                key={`output-${entry.index}`}
                label={entry.label}
                channel={entry.channel}
                state={entry.state}
                updatedAt={entry.updatedAt}
                changedAt={entry.changedAt}
                origin={entry.origin}
              />
            ))}
          </div>
        ) : (
          <p className="text-xs text-white/60">Nenhuma saída disponível.</p>
        )}
      </StatusSection>

      {serialEntries.length ? (
        <StatusSection title="Seriais (RS232/RS485)">
          <div className="grid gap-3 sm:grid-cols-2">
            {serialEntries.map((entry) => (
              <SerialCard
                key={entry.channel}
                channel={entry.channel}
                status={entry.status}
                updatedAt={entry.updatedAt}
                lines={entry.lines}
              />
            ))}
          </div>
        </StatusSection>
      ) : null}

      <StatusSection title="Dados adicionais" muted>
        {otherEntries.length ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {otherEntries.map((entry) => (
              <OtherFieldCard
                key={entry.key}
                rawKey={entry.key}
                label={entry.label}
                value={entry.value}
                description={entry.description}
                updatedAt={entry.updatedAt}
              />
            ))}
          </div>
        ) : (
          <p className="text-xs text-white/60">Nenhum dado extra encontrado.</p>
        )}
      </StatusSection>
    </>
  );
}
