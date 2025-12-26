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

const NUMERIC_EVENT_LABELS = {
  16: "Movimento",
  17: "Parado",
  18: "Ignição ligada",
  19: "Ignição desligada",
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
  const candidate = normalizeEventCandidate(rawType);
  if (!candidate) {
    return { label: translateEventType("generic", locale, fallbackTranslator), raw: "" };
  }

  const numeric = Number(candidate);
  if (Number.isFinite(numeric) && String(numeric) === candidate) {
    const mapped = NUMERIC_EVENT_LABELS[numeric];
    if (mapped) {
      return { label: mapped, raw: candidate };
    }
    return { label: `Evento ${candidate}`, raw: candidate, isFallback: true };
  }

  const translated = translateEventType(candidate, locale, fallbackTranslator);
  return { label: translated || candidate, raw: candidate };
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
  return resolveEventLabel(candidate, locale, fallbackTranslator);
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
};
