const EVENT_LABELS = {
  "pt-BR": {
    generic: "Evento",
    alarm: "Alarme",
    deviceonline: "Em comunicação",
    deviceoffline: "Sem comunicação",
    deviceunknown: "Veículo desconhecido",
    devicemoving: "Veículo em movimento",
    devicestopped: "Veículo parado",
    ignitionon: "Ignição ligada",
    ignitionoff: "Ignição desligada",
    tripstart: "Início de trajeto",
    tripstop: "Fim de trajeto",
    speeding: "Excesso de velocidade",
    speedlimit: "Excesso de velocidade",
    overspeed: "Excesso de velocidade",
    fuelup: "Abastecimento",
    fueldrop: "Queda de combustível",
    geofenceenter: "Entrada em cerca",
    geofenceexit: "Saída em cerca",
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
    towing: "Reboque detectado",
    tampering: "Violação", 
  },
  "en-US": {
    generic: "Event",
    alarm: "Alarm",
    deviceonline: "Device online",
    deviceoffline: "Device offline",
    deviceunknown: "Unknown vehicle",
    devicemoving: "Vehicle moving",
    devicestopped: "Vehicle stopped",
    ignitionon: "Ignition on",
    ignitionoff: "Ignition off",
    tripstart: "Trip started",
    tripstop: "Trip finished",
    speeding: "Speeding",
    speedlimit: "Speeding",
    overspeed: "Speeding",
    fuelup: "Refuel",
    fueldrop: "Fuel drop detected",
    geofenceenter: "Geofence enter",
    geofenceexit: "Geofence exit",
    sos: "SOS",
    theft: "Theft",
    crime: "Crime",
    assault: "Assault",
    crash: "Crash detected",
    panic: "Panic alert",
    maintenance: "Maintenance",
    driverchanged: "Driver changed",
    harshacceleration: "Harsh acceleration",
    harshbraking: "Harsh braking",
    harshcornering: "Harsh cornering",
    jamming: "Jamming detected",
    powercut: "Power cut",
    towing: "Towing detected",
    tampering: "Tampering",
  },
};

const EVENT_SEVERITY = {
  deviceoffline: "high",
  deviceonline: "info",
  deviceunknown: "medium",
  devicemoving: "info",
  devicestopped: "info",
  ignitionon: "medium",
  ignitionoff: "info",
  tripstart: "info",
  tripstop: "info",
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
  towing: "high",
  tampering: "high",
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

export function resolveEventDefinition(rawType, locale = "pt-BR", fallbackTranslator) {
  const candidate = normalizeEventCandidate(rawType);
  if (!candidate) {
    return {
      label: translateEventType("generic", locale, fallbackTranslator),
      raw: "",
      type: "generic",
      icon: null,
    };
  }

  const numeric = Number(candidate);
  if (Number.isFinite(numeric) && String(numeric) === candidate) {
    const definition = J16_EVENT_DEFINITIONS[candidate];
    if (definition) {
      return {
        ...definition,
        label: resolveDefinitionLabel(definition, locale, fallbackTranslator),
        raw: candidate,
        isNumeric: true,
      };
    }
    return { label: `Evento ${candidate}`, raw: candidate, isFallback: true, type: "event", icon: null, isNumeric: true };
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
  const translated = translateEventType(candidate, locale, fallbackTranslator);
  return {
    label: translated || candidate,
    raw: candidate,
    type: normalized || candidate,
    icon: null,
    ...(ignition !== undefined ? { ignition } : null),
  };
}

export function translateEventType(type, locale = "pt-BR", fallbackTranslator) {
  const normalized = normalizeType(type);
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

export function resolveEventLabel(rawType, locale = "pt-BR", fallbackTranslator) {
  return resolveEventDefinition(rawType, locale, fallbackTranslator);
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
  return resolveEventDefinition(candidate, locale, fallbackTranslator);
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
  return resolveEventDefinition(candidate, locale, fallbackTranslator);
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
