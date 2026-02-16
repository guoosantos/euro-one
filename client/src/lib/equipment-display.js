const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function toTrimmedString(value) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function normalizeComparableText(value) {
  return toTrimmedString(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

export function isUuidLike(value) {
  const text = toTrimmedString(value);
  if (!text) return false;
  return UUID_REGEX.test(text);
}

export function resolveEquipmentDisplayCode(source) {
  if (!source || typeof source !== "object") return "";
  const attributes = source?.attributes && typeof source.attributes === "object" ? source.attributes : {};
  const candidates = [
    source.imei,
    source.uniqueId,
    attributes.imei,
    source.serial,
    attributes.serial,
    source.equipmentCode,
    source.displayId,
    source.code,
    attributes.equipmentCode,
    attributes.deviceCode,
    source.internalCode,
    attributes.internalCode,
    attributes.codigoInterno,
    source.equipmentId,
    source.id,
  ];

  for (const candidate of candidates) {
    const normalized = toTrimmedString(candidate);
    if (!normalized || isUuidLike(normalized)) continue;
    return normalized;
  }

  return "";
}

export function resolveEquipmentModel(source, index = 0) {
  const model = toTrimmedString(source?.model || source?.modelName || source?.name || source?.label);
  if (model) return model;
  return `Equipamento ${index + 1}`;
}

export function buildEquipmentDisplayLabel(source, index = 0, { includeMissingCodeLabel = true } = {}) {
  const code = resolveEquipmentDisplayCode(source);
  const model = resolveEquipmentModel(source, index);
  if (model && code) {
    if (normalizeComparableText(model) === normalizeComparableText(code)) return code;
    return `${model} ${code}`;
  }
  if (code) return code;
  if (model && includeMissingCodeLabel) return `${model} Código não cadastrado`;
  if (model) return model;
  return includeMissingCodeLabel ? `Equipamento ${index + 1} Código não cadastrado` : `Equipamento ${index + 1}`;
}

export function splitEquipmentText(value) {
  return String(value || "")
    .split(/\r?\n|[,;|]/)
    .map((entry) => toTrimmedString(entry))
    .filter(Boolean)
    .map((entry) => (isUuidLike(entry) ? "Código não cadastrado" : entry));
}
