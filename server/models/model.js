import createError from "http-errors";
import { randomUUID } from "crypto";

const models = new Map();

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

function store(record) {
  models.set(record.id, record);
  return clone(record);
}

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

export function createModel({ name, brand, protocol = "", connectivity = "", ports = [], clientId = null }) {
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
    protocol: String(protocol || "").trim(),
    connectivity: String(connectivity || "").trim(),
    ports: Array.isArray(ports) ? ports.map((port, index) => normalisePort(port, index)) : [],
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
  if (Object.prototype.hasOwnProperty.call(updates, "protocol")) {
    record.protocol = String(updates.protocol || "").trim();
  }
  if (Object.prototype.hasOwnProperty.call(updates, "connectivity")) {
    record.connectivity = String(updates.connectivity || "").trim();
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
}

export default {
  listModels,
  getModelById,
  createModel,
  updateModel,
  deleteModel,
};
