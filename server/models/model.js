import createError from "http-errors";
import { randomUUID } from "crypto";

import { loadCollection, saveCollection } from "../services/storage.js";

const STORAGE_KEY = "models";
const models = new Map();

function syncStorage() {
  saveCollection(STORAGE_KEY, Array.from(models.values()));
}

function clone(record) {
  if (!record) return null;
  return {
    ...record,
    ports: Array.isArray(record.ports) ? record.ports.map((port) => ({ ...port })) : [],
  };
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
  store({ ...record }, { skipSync: true });
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
