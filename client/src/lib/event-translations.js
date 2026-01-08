import { resolveEventDescriptor } from "../../../shared/telemetryDictionary.js";

const EVENT_LABELS_PT = {
  generic: "Evento",
  alarm: "Alarme",
  deviceonline: "Em comunicação",
  deviceoffline: "Sem comunicação",
  deviceunknown: "Veículo desconhecido",
  deviceinactive: "Veículo inativo",
  devicemoving: "Veículo em movimento",
  devicestopped: "Veículo parado",
  ignitionon: "Ignição ligada",
  ignitionoff: "Ignição desligada",
  tripstart: "Início de trajeto",
  tripstop: "Fim de trajeto",
  idle: "Ocioso",
  parking: "Estacionado",
  speeding: "Excesso de velocidade",
  speedlimit: "Excesso de velocidade",
  overspeed: "Excesso de velocidade",
  commandresult: "Resposta de comando",
  textmessage: "Mensagem",
  media: "Mídia",
  fuelup: "Abastecimento",
  fueldrop: "Queda de combustível",
  geofenceenter: "Entrada na geozona",
  geofenceexit: "Saída da geozona",
  sos: "SOS",
  theft: "Roubo",
  crime: "Crime",
  assault: "Assalto",
  crash: "Colisão",
  panic: "Pânico",
  maintenance: "Manutenção",
  driverchanged: "Troca de motorista",
  harshacceleration: "Aceleração brusca",
  harshbraking: "Frenagem brusca",
  harshcornering: "Curva brusca",
  jamming: "Bloqueador detectado",
  powercut: "Corte de energia",
  powerdisconnect: "Alimentação desconectada",
  powerdisconnected: "Alimentação desconectada",
  externalpowerdisconnect: "Alimentação desconectada",
  externalpowerdisconnected: "Alimentação desconectada",
  lowbattery: "Bateria baixa",
  towing: "Reboque detectado",
  tampering: "Violação",
  door: "Porta",
  engineon: "Motor ligado",
  engineoff: "Motor desligado",
};

const EVENT_LABELS = {
  "pt-BR": EVENT_LABELS_PT,
  "en-US": EVENT_LABELS_PT,
};

const POSITION_LABEL_PT = "Posição registrada";

const EVENT_SEVERITY = {
  deviceoffline: "high",
  deviceonline: "info",
  deviceunknown: "medium",
  deviceinactive: "medium",
  devicemoving: "info",
  devicestopped: "info",
  ignitionon: "medium",
  ignitionoff: "info",
  tripstart: "info",
  tripstop: "info",
  idle: "low",
  parking: "low",
  commandresult: "info",
  textmessage: "info",
  media: "info",
  speeding: "high",
  speedlimit: "high",
  overspeed: "high",
  fuelup: "info",
  fueldrop: "high",
  geofenceenter: "medium",
  geofenceexit: "medium",
  sos: "critical",
  theft: "critical",
  crime: "critical",
  assault: "critical",
  crash: "critical",
  panic: "critical",
  alarm: "high",
  maintenance: "low",
  driverchanged: "info",
  harshacceleration: "medium",
  harshbraking: "medium",
  harshcornering: "medium",
  jamming: "high",
  powercut: "high",
  powerdisconnect: "critical",
  powerdisconnected: "critical",
  externalpowerdisconnect: "critical",
  externalpowerdisconnected: "critical",
  lowbattery: "medium",
  towing: "high",
  tampering: "high",
  door: "medium",
  engineon: "info",
  engineoff: "info",
};

export const J16_EVENT_DEFINITIONS = {
  "6": {
    type: "ignitionOn",
    labelKey: "events.ignitionOn",
    defaultLabel: "Ignição ligada",
    icon: "🔌",
    ignition: true,
  },
  "7": {
    type: "ignitionOff",
    labelKey: "events.ignitionOff",
    defaultLabel: "Ignição desligada",
    icon: "⏻",
    ignition: false,
  },
  "16": {
    type: "deviceMoving",
    labelKey: "events.deviceMoving",
    defaultLabel: "Veículo em movimento",
    icon: "🚗",
  },
  "17": {
    type: "deviceStopped",
    labelKey: "events.deviceStopped",
    defaultLabel: "Veículo parado",
    icon: "🛑",
  },
  "18": {
    type: "ignitionOn",
    labelKey: "events.ignitionOn",
    defaultLabel: "Ignição ligada",
    icon: "🔌",
    ignition: true,
  },
  "19": {
    type: "ignitionOff",
    labelKey: "events.ignitionOff",
    defaultLabel: "Ignição desligada",
    icon: "⏻",
    ignition: false,
  },
};

function normalizeType(type) {
  if (!type) return "";
  return String(type).replace(/[^a-z0-9]+/gi, "").toLowerCase();
}

function normalizeEventCandidate(value) {
  if (value === null || value === undefined) return "";
  const asString = String(value).trim();
  return asString;
}

function normalizeProtocol(protocol) {
  if (!protocol) return null;
  const cleaned = String(protocol).trim().toLowerCase();
  return cleaned || null;
}

function resolveProtocolFromPayload(payload = {}) {
  const attributes = payload?.attributes || payload?.position?.attributes || payload?.rawAttributes || payload?.position?.rawAttributes || {};
  return (
    payload?.protocol ||
    payload?.position?.protocol ||
    payload?.device?.protocol ||
    attributes.protocol ||
    attributes.deviceProtocol ||
    attributes.device_protocol ||
    null
  );
}

function resolvePayloadEventLabel(payload = {}) {
  const attributes = extractPositionAttributes(payload);
  return (
    payload?.eventLabel ||
    payload?.position?.eventLabel ||
    attributes?.eventLabel ||
    payload?.position?.attributes?.eventLabel ||
    null
  );
}

function resolvePayloadEventSeverity(payload = {}) {
  const attributes = extractPositionAttributes(payload);
  return (
    payload?.eventSeverity ||
    payload?.position?.eventSeverity ||
    attributes?.eventSeverity ||
    payload?.position?.attributes?.eventSeverity ||
    null
  );
}

function resolvePayloadEventActive(payload = {}) {
  const attributes = extractPositionAttributes(payload);
  if (payload?.eventActive === false || payload?.position?.eventActive === false) return false;
  if (attributes?.eventActive === false || payload?.position?.attributes?.eventActive === false) return false;
  return null;
}

function resolveDescriptorLabel(candidate, protocol, payload) {
  if (!candidate) return null;
  const protocolKey = normalizeProtocol(protocol);
  if (!protocolKey) return null;
  const descriptor = resolveEventDescriptor(candidate, { protocol: protocolKey, payload });
  if (!descriptor?.labelPt) return null;
  return { ...descriptor, protocol: protocolKey };
}

function resolveDefinitionLabel(definition, locale, fallbackTranslator) {
  if (!definition) return "";
  if (typeof fallbackTranslator === "function" && definition.labelKey) {
    const translated = fallbackTranslator(definition.labelKey);
    if (translated && translated !== definition.labelKey) {
      return translated;
    }
  }
  if (locale && EVENT_LABELS[locale] && definition.type) {
    const key = normalizeType(definition.type);
    const dictionary = EVENT_LABELS[locale] || EVENT_LABELS["pt-BR"];
    if (dictionary?.[key]) return dictionary[key];
  }
  return definition.defaultLabel || definition.label || "";
}

function extractPositionAttributes(payload = {}) {
  return payload?.attributes || payload?.position?.attributes || payload?.rawAttributes || payload?.position?.rawAttributes || {};
}

function isFiniteNumber(value) {
  return Number.isFinite(Number(value));
}

function isPositionPayload(payload = {}) {
  if (!payload || typeof payload !== "object") return false;
  const target = payload?.position || payload;
  const attributes = extractPositionAttributes(payload);

  const lat = target?.latitude ?? target?.lat ?? attributes?.latitude ?? attributes?.lat;
  const lon =
    target?.longitude ??
    target?.lng ??
    target?.lon ??
    attributes?.longitude ??
    attributes?.lng ??
    attributes?.lon;

  const hasCoordinates = isFiniteNumber(lat) && isFiniteNumber(lon);
  if (hasCoordinates) return true;

  const telemetrySignals = [
    target?.speed,
    attributes?.speed,
    target?.course,
    attributes?.course,
    target?.altitude,
    attributes?.altitude,
    target?.sat,
    attributes?.sat,
    target?.hdop,
    attributes?.hdop,
    target?.gpsFix,
    attributes?.gpsFix,
    target?.valid,
    attributes?.valid,
  ];

  const presentSignals = telemetrySignals.filter((value) => value !== null && value !== undefined).length;
  return presentSignals >= 2;
}

export function resolveEventDefinition(rawType, locale = "pt-BR", fallbackTranslator, protocol = null, payload = null) {
  const candidate = normalizeEventCandidate(rawType);
  if (!candidate) {
    if (isPositionPayload(payload)) {
      return {
        label: POSITION_LABEL_PT,
        raw: "",
        type: "position",
        icon: null,
      };
    }
    return {
      label: translateEventType("generic", locale, fallbackTranslator),
      raw: "",
      type: "generic",
      icon: null,
    };
  }

  const payloadEventLabel = resolvePayloadEventLabel(payload);
  const payloadEventSeverity = resolvePayloadEventSeverity(payload);
  const payloadEventActive = resolvePayloadEventActive(payload);
  if (payloadEventActive === false) {
    if (isPositionPayload(payload)) {
      return {
        label: POSITION_LABEL_PT,
        raw: candidate,
        type: "position",
        icon: null,
        suppressed: true,
      };
    }
    return {
      label: "",
      raw: candidate,
      type: "event",
      icon: null,
      suppressed: true,
    };
  }
  if (payloadEventLabel) {
    const numericCandidate = Number(candidate);
    const numericDefinition =
      Number.isFinite(numericCandidate) && String(numericCandidate) === candidate
        ? J16_EVENT_DEFINITIONS[candidate]
        : null;
    return {
      label: payloadEventLabel,
      raw: candidate,
      type: "event",
      icon: null,
      isNumeric: /^\d+$/.test(candidate),
      severity: payloadEventSeverity || undefined,
      ...(numericDefinition?.ignition !== undefined ? { ignition: numericDefinition.ignition } : null),
    };
  }

  const numeric = Number(candidate);
  if (Number.isFinite(numeric) && String(numeric) === candidate) {
    const protocolKey = normalizeProtocol(protocol);
    const descriptor = resolveDescriptorLabel(candidate, protocol, payload);
    if (descriptor?.labelPt) {
      return {
        label: descriptor.labelPt,
        raw: candidate,
        type: descriptor.key || "event",
        icon: null,
        isNumeric: true,
        severity: descriptor.severity,
      };
    }
    const definition = J16_EVENT_DEFINITIONS[candidate];
    if (definition) {
      return {
        ...definition,
        label: resolveDefinitionLabel(definition, locale, fallbackTranslator),
        raw: candidate,
        isNumeric: true,
      };
    }
    if (protocolKey === "iotm") {
      if (isPositionPayload(payload)) {
        return {
          label: POSITION_LABEL_PT,
          raw: candidate,
          type: "position",
          icon: null,
          isNumeric: true,
        };
      }
      return {
        label: `NÃO MAPEADO (${candidate})`,
        raw: candidate,
        isFallback: true,
        type: "unmapped",
        icon: null,
        isNumeric: true,
      };
    }

    if (isPositionPayload(payload)) {
      return {
        label: POSITION_LABEL_PT,
        raw: candidate,
        type: "position",
        icon: null,
        isNumeric: true,
      };
    }

    return {
      label: `NÃO MAPEADO (${candidate})`,
      raw: candidate,
      isFallback: true,
      type: "unmapped",
      icon: null,
      isNumeric: true,
    };
  }

  const normalized = normalizeType(candidate);
  const ignition =
    normalized === "ignitionon"
      ? true
      : normalized === "ignitionoff"
        ? false
        : normalized === "accon" || normalized === "ignon"
          ? true
          : normalized === "accoff" || normalized === "ignoff"
            ? false
        : normalized.includes("igni")
          ? normalized.includes("deslig") || normalized.includes("off")
            ? false
            : normalized.includes("ligad") || normalized.includes("on")
              ? true
              : undefined
          : undefined;
  const translated = translateEventType(candidate, locale, fallbackTranslator, protocol, payload);
  return {
    label: translated || candidate,
    raw: candidate,
    type: normalized || candidate,
    icon: null,
    ...(ignition !== undefined ? { ignition } : null),
  };
}

export function translateEventType(type, locale = "pt-BR", fallbackTranslator, protocol = null, payload = null) {
  const raw = normalizeEventCandidate(type);
  if (!raw) {
    const dictionary = EVENT_LABELS[locale] || EVENT_LABELS["pt-BR"];
    return dictionary.generic;
  }
  const payloadLabel = resolvePayloadEventLabel(payload);
  if (payloadLabel) return payloadLabel;
  if (/^\d+$/.test(raw)) {
    const protocolKey = normalizeProtocol(protocol);
    if (protocolKey === "iotm") {
      const descriptor = resolveDescriptorLabel(raw, protocol, payload);
      if (descriptor?.labelPt) return descriptor.labelPt;
      return `NÃO MAPEADO (${raw})`;
    }

    const descriptor = resolveDescriptorLabel(raw, protocol, payload);
    if (descriptor?.labelPt) return descriptor.labelPt;
    return `NÃO MAPEADO (${raw})`;
  }
  const normalized = normalizeType(raw);
  const dictionary = EVENT_LABELS[locale] || EVENT_LABELS["pt-BR"];
  if (normalized && dictionary[normalized]) {
    return dictionary[normalized];
  }
  if (typeof fallbackTranslator === "function") {
    const key = `events.${normalized}`;
    const translated = fallbackTranslator(key);
    if (translated && translated !== key) {
      return translated;
    }
    if (type) {
      const originalKey = `events.${type}`;
      const fallback = fallbackTranslator(originalKey);
      if (fallback && fallback !== originalKey) {
        return fallback;
      }
    }
  }
  return normalized ? normalized : dictionary.generic;
}

export function resolveEventLabel(rawType, locale = "pt-BR", fallbackTranslator, protocol = null) {
  return resolveEventDefinition(rawType, locale, fallbackTranslator, protocol);
}

export function resolveEventLabelFromPayload(payload = {}, locale = "pt-BR", fallbackTranslator) {
  const attributes = payload?.attributes || payload?.position?.attributes || payload?.rawAttributes || {};
  const candidates = [
    payload?.lastEventName,
    payload?.lastEvent?.type,
    payload?.lastEvent?.attributes?.alarm,
    payload?.event,
    payload?.type,
    payload?.alarm,
    attributes.event,
    attributes.alarm,
    attributes.type,
    attributes.status,
  ];

  const candidate = candidates.find((value) => normalizeEventCandidate(value));
  const protocol = resolveProtocolFromPayload(payload);
  return resolveEventDefinition(candidate, locale, fallbackTranslator, protocol, payload);
}

export function resolveEventDefinitionFromPayload(payload = {}, locale = "pt-BR", fallbackTranslator) {
  const attributes = payload?.attributes || payload?.position?.attributes || payload?.rawAttributes || {};
  const candidates = [
    payload?.lastEventName,
    payload?.lastEvent?.type,
    payload?.lastEvent?.attributes?.alarm,
    payload?.event,
    payload?.type,
    payload?.alarm,
    attributes.event,
    attributes.alarm,
    attributes.type,
    attributes.status,
  ];

  const candidate = candidates.find((value) => normalizeEventCandidate(value));
  const protocol = resolveProtocolFromPayload(payload);
  return resolveEventDefinition(candidate, locale, fallbackTranslator, protocol, payload);
}

export function getEventSeverity(type, defaultSeverity = "medium") {
  const normalized = normalizeType(type);
  return EVENT_SEVERITY[normalized] || defaultSeverity;
}

export function listKnownEventTypes() {
  const dictionary = EVENT_LABELS["pt-BR"];
  return Object.keys(dictionary).filter((key) => key !== "generic");
}

export function normalizeEventType(type) {
  return normalizeType(type);
}

export default {
  translateEventType,
  getEventSeverity,
  listKnownEventTypes,
  normalizeEventType,
  resolveEventLabel,
  resolveEventLabelFromPayload,
  resolveEventDefinition,
  resolveEventDefinitionFromPayload,
  J16_EVENT_DEFINITIONS,
};
