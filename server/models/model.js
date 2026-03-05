import createError from "http-errors";
import { randomUUID } from "crypto";

import { loadCollection, saveCollection } from "../services/storage.js";

const STORAGE_KEY = "models";
const models = new Map();

const PORT_TYPE_ALIASES = {
  di: "di",
  digital: "di",
  input: "di",
  entrada: "di",
  "entrada digital": "di",
  do: "do",
  output: "do",
  saida: "do",
  saída: "do",
  rs232: "rs232",
  rs485: "rs485",
  can: "can",
  lora: "lora",
  "lo ra": "lora",
  wifi: "wifi",
  "wi-fi": "wifi",
  bluetooth: "bluetooth",
  bt: "bluetooth",
};

const DEFAULT_PORT_COUNTS = {
  di: 0,
  do: 0,
  rs232: 0,
  rs485: 0,
  can: 0,
  lora: 0,
  wifi: 0,
  bluetooth: 0,
};

const PORT_COUNT_ALIASES = {
  di: ["di", "entradasDI", "entradaDI", "inputsDI"],
  do: ["do", "saidasDO", "saídasDO", "outputsDO"],
  rs232: ["rs232"],
  rs485: ["rs485"],
  can: ["can"],
  lora: ["lora"],
  wifi: ["wifi"],
  bluetooth: ["bluetooth"],
};

const LEGACY_INTERFACE_FIELDS = {
  entradasDI: "di",
  saidasDO: "do",
  rs232: "rs232",
  rs485: "rs485",
  can: "can",
  lora: "lora",
  wifi: "wifi",
  bluetooth: "bluetooth",
};

function toNumber(value, fallback = 0, { strict = false, field = "valor" } = {}) {
  if (value === null || value === undefined || String(value).trim() === "") return fallback;
  const parsed = Number(value);
  const isValid = Number.isFinite(parsed) && Number.isInteger(parsed) && parsed >= 0;
  if (!isValid) {
    if (strict) {
      throw createError(422, `Campo ${field} deve ser inteiro maior ou igual a 0`);
    }
    return fallback;
  }
  return Math.trunc(parsed);
}

function hasOwn(source, key) {
  return Object.prototype.hasOwnProperty.call(source, key);
}

function hasInterfaceCountUpdates(source = {}) {
  return Object.keys(LEGACY_INTERFACE_FIELDS).some((field) => hasOwn(source, field));
}

function pickLegacyInterfaceFields(source = {}) {
  return Object.keys(LEGACY_INTERFACE_FIELDS).reduce((acc, field) => {
    if (hasOwn(source, field)) {
      acc[field] = source[field];
    }
    return acc;
  }, {});
}

function pickDefinedLegacyInterfaceFields(source = {}) {
  return Object.keys(LEGACY_INTERFACE_FIELDS).reduce((acc, field) => {
    if (source[field] !== undefined) {
      acc[field] = source[field];
    }
    return acc;
  }, {});
}

function readPortCount(source, key, options = {}) {
  const aliases = PORT_COUNT_ALIASES[key] || [key];
  for (const alias of aliases) {
    if (hasOwn(source, alias)) {
      return toNumber(source[alias], 0, { ...options, field: alias });
    }
  }
  return null;
}

function normalizePortCounts(portCounts, ports, options = {}) {
  const result = { ...DEFAULT_PORT_COUNTS };
  const source = portCounts && typeof portCounts === "object" ? portCounts : null;
  if (source) {
    let hasProvidedValue = false;
    Object.keys(result).forEach((key) => {
      const nextValue = readPortCount(source, key, options);
      if (nextValue === null) return;
      result[key] = nextValue;
      hasProvidedValue = true;
    });
    if (hasProvidedValue) return result;
  }
  if (Array.isArray(ports)) {
    ports.forEach((port) => {
      const type = String(port?.type ?? port?.mode ?? port?.label ?? "").toLowerCase().trim();
      const resolved = PORT_TYPE_ALIASES[type];
      if (resolved) {
        result[resolved] += 1;
      }
    });
  }
  return result;
}

function withLegacyInterfaceFields(record) {
  const counts = normalizePortCounts(record?.portCounts, record?.ports);
  return {
    ...record,
    portCounts: counts,
    entradasDI: counts.di,
    saidasDO: counts.do,
    rs232: counts.rs232,
    rs485: counts.rs485,
    can: counts.can,
    lora: counts.lora,
    wifi: counts.wifi,
    bluetooth: counts.bluetooth,
  };
}

function normalizeDynamicItems(items) {
  if (!Array.isArray(items)) return [];
  return items
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const label = String(item.label ?? item.name ?? "").trim();
      const value = String(item.value ?? item.data ?? "").trim();
      const description = String(item.description ?? item.help ?? "").trim();
      if (!label) return null;
      return {
        id: item.id ? String(item.id) : randomUUID(),
        label,
        value,
        description,
      };
    })
    .filter(Boolean);
}

function syncStorage() {
  saveCollection(STORAGE_KEY, Array.from(models.values()));
}

function clone(record) {
  if (!record) return null;
  return withLegacyInterfaceFields({
    ...record,
    ports: Array.isArray(record.ports) ? record.ports.map((port) => ({ ...port })) : [],
    portCounts: normalizePortCounts(record.portCounts || record, record.ports),
    technicalTimes: Array.isArray(record.technicalTimes)
      ? record.technicalTimes.map((item) => ({ ...item }))
      : [],
    productionModes: Array.isArray(record.productionModes)
      ? record.productionModes.map((item) => ({ ...item }))
      : [],
  });
}

function normalisePort(port, index) {
  if (!port || typeof port !== "object") {
    return {
      id: randomUUID(),
      label: `Porta ${index + 1}`,
      type: "digital",
    };
  }
  const label = String(port.label ?? port.name ?? `Porta ${index + 1}`).trim();
  const type = String(port.type ?? port.mode ?? "digital").trim() || "digital";
  return {
    id: port.id ? String(port.id) : randomUUID(),
    label,
    type,
  };
}

function store(record, { skipSync = false } = {}) {
  models.set(record.id, record);
  if (!skipSync) {
    syncStorage();
  }
  return clone(record);
}

const persistedModels = loadCollection(STORAGE_KEY, []);
persistedModels.forEach((record) => {
  if (!record?.id) return;
  store(
    {
      ...record,
      portCounts: normalizePortCounts(record.portCounts || record, record.ports),
    },
    { skipSync: true },
  );
});

export function listModels({ clientId, includeGlobal = true } = {}) {
  return Array.from(models.values())
    .filter((model) => {
      if (!clientId) {
        return includeGlobal || Boolean(model.clientId) === false;
      }
      if (includeGlobal && model.clientId === null) {
        return true;
      }
      return String(model.clientId) === String(clientId);
    })
    .map(clone);
}

export function getModelById(id) {
  const record = models.get(String(id));
  return clone(record);
}

export function createModel({
  name,
  brand,
  prefix = "",
  protocol = "",
  connectivity = "",
  ports = [],
  portCounts = null,
  entradasDI = undefined,
  saidasDO = undefined,
  rs232 = undefined,
  rs485 = undefined,
  can = undefined,
  lora = undefined,
  wifi = undefined,
  bluetooth = undefined,
  technicalTimes = [],
  productionModes = [],
  clientId = null,
  version = "",
  jammerBlockTime = "",
  panelBlockTime = "",
  jammerDetectionTime = "",
  frequency = "",
  blockMode = "",
  resetMode = "",
  workshopMode = "",
  productionDate = null,
  notes = "",
  isClientDefault = false,
  defaultClientId = null,
} = {}) {
  if (!name) {
    throw createError(400, "Nome do modelo é obrigatório");
  }
  if (!brand) {
    throw createError(400, "Fabricante é obrigatório");
  }

  const trimmedName = String(name).trim();
  const trimmedBrand = String(brand).trim();
  if (!trimmedName || !trimmedBrand) {
    throw createError(400, "Nome e fabricante são obrigatórios");
  }

  const ownerId = clientId ? String(clientId) : null;
  const duplicate = Array.from(models.values()).find((model) => {
    if (ownerId === null) {
      if (model.clientId !== null) return false;
    } else if (String(model.clientId) !== ownerId) {
      return false;
    }
    return model.name.toLowerCase() === trimmedName.toLowerCase() && model.brand.toLowerCase() === trimmedBrand.toLowerCase();
  });

  if (duplicate) {
    throw createError(409, "Já existe um modelo com este nome para o mesmo fabricante");
  }

  const now = new Date().toISOString();
  const record = {
    id: randomUUID(),
    name: trimmedName,
    brand: trimmedBrand,
    prefix: prefix ? String(prefix).trim() : "",
    protocol: String(protocol || "").trim(),
    connectivity: String(connectivity || "").trim(),
    ports: Array.isArray(ports) ? ports.map((port, index) => normalisePort(port, index)) : [],
    portCounts: normalizePortCounts(
      {
        ...(portCounts && typeof portCounts === "object" ? portCounts : {}),
        ...pickDefinedLegacyInterfaceFields({
          entradasDI,
          saidasDO,
          rs232,
          rs485,
          can,
          lora,
          wifi,
          bluetooth,
        }),
      },
      ports,
      { strict: true },
    ),
    technicalTimes: normalizeDynamicItems(technicalTimes),
    productionModes: normalizeDynamicItems(productionModes),
    internalSequence: 0,
    version: String(version || "").trim(),
    jammerBlockTime: String(jammerBlockTime || "").trim(),
    panelBlockTime: String(panelBlockTime || "").trim(),
    jammerDetectionTime: String(jammerDetectionTime || "").trim(),
    frequency: String(frequency || "").trim(),
    blockMode: String(blockMode || "").trim(),
    resetMode: String(resetMode || "").trim(),
    workshopMode: String(workshopMode || "").trim(),
    productionDate: productionDate ? String(productionDate).trim() : null,
    notes: String(notes || "").trim(),
    isClientDefault: Boolean(isClientDefault),
    defaultClientId: defaultClientId ? String(defaultClientId) : null,
    clientId: ownerId,
    createdAt: now,
    updatedAt: now,
  };

  return store(record);
}

export function updateModel(id, updates = {}) {
  const record = models.get(String(id));
  if (!record) {
    throw createError(404, "Modelo não encontrado");
  }

  const hasPortCountUpdates = hasOwn(updates, "portCounts") || hasInterfaceCountUpdates(updates);

  if (updates.name) {
    record.name = String(updates.name).trim();
  }
  if (updates.brand) {
    record.brand = String(updates.brand).trim();
  }
  if (Object.prototype.hasOwnProperty.call(updates, "prefix")) {
    record.prefix = updates.prefix ? String(updates.prefix).trim() : "";
  }
  if (Object.prototype.hasOwnProperty.call(updates, "protocol")) {
    record.protocol = String(updates.protocol || "").trim();
  }
  if (Object.prototype.hasOwnProperty.call(updates, "connectivity")) {
    record.connectivity = String(updates.connectivity || "").trim();
  }
  if (Object.prototype.hasOwnProperty.call(updates, "version")) {
    record.version = String(updates.version || "").trim();
  }
  if (Object.prototype.hasOwnProperty.call(updates, "jammerBlockTime")) {
    record.jammerBlockTime = String(updates.jammerBlockTime || "").trim();
  }
  if (Object.prototype.hasOwnProperty.call(updates, "panelBlockTime")) {
    record.panelBlockTime = String(updates.panelBlockTime || "").trim();
  }
  if (Object.prototype.hasOwnProperty.call(updates, "jammerDetectionTime")) {
    record.jammerDetectionTime = String(updates.jammerDetectionTime || "").trim();
  }
  if (Object.prototype.hasOwnProperty.call(updates, "frequency")) {
    record.frequency = String(updates.frequency || "").trim();
  }
  if (Object.prototype.hasOwnProperty.call(updates, "blockMode")) {
    record.blockMode = String(updates.blockMode || "").trim();
  }
  if (Object.prototype.hasOwnProperty.call(updates, "resetMode")) {
    record.resetMode = String(updates.resetMode || "").trim();
  }
  if (Object.prototype.hasOwnProperty.call(updates, "workshopMode")) {
    record.workshopMode = String(updates.workshopMode || "").trim();
  }
  if (Object.prototype.hasOwnProperty.call(updates, "productionDate")) {
    record.productionDate = updates.productionDate ? String(updates.productionDate).trim() : null;
  }
  if (Object.prototype.hasOwnProperty.call(updates, "notes")) {
    record.notes = String(updates.notes || "").trim();
  }
  if (Object.prototype.hasOwnProperty.call(updates, "isClientDefault")) {
    record.isClientDefault = Boolean(updates.isClientDefault);
  }
  if (Object.prototype.hasOwnProperty.call(updates, "defaultClientId")) {
    record.defaultClientId = updates.defaultClientId ? String(updates.defaultClientId) : null;
  }
  if (Array.isArray(updates.ports)) {
    record.ports = updates.ports.map((port, index) => normalisePort(port, index));
    if (!hasPortCountUpdates) {
      record.portCounts = normalizePortCounts(null, record.ports);
    }
  }
  if (hasPortCountUpdates) {
    record.portCounts = normalizePortCounts(
      {
        ...(updates.portCounts && typeof updates.portCounts === "object" ? updates.portCounts : {}),
        ...pickLegacyInterfaceFields(updates),
      },
      record.ports,
      { strict: true },
    );
  }
  if (Object.prototype.hasOwnProperty.call(updates, "technicalTimes")) {
    record.technicalTimes = normalizeDynamicItems(updates.technicalTimes);
  }
  if (Object.prototype.hasOwnProperty.call(updates, "productionModes")) {
    record.productionModes = normalizeDynamicItems(updates.productionModes);
  }
  if (Object.prototype.hasOwnProperty.call(updates, "internalSequence")) {
    record.internalSequence = toNumber(updates.internalSequence, record.internalSequence || 0, {
      field: "internalSequence",
    });
  }
  record.updatedAt = new Date().toISOString();
  return store(record);
}

export function deleteModel(id) {
  const exists = models.delete(String(id));
  if (!exists) {
    throw createError(404, "Modelo não encontrado");
  }
  syncStorage();
}

export default {
  listModels,
  getModelById,
  createModel,
  updateModel,
  deleteModel,
};
