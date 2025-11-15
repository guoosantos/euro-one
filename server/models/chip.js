import createError from "http-errors";
import { randomUUID } from "crypto";

const chips = new Map();
const byIccid = new Map();

function clone(record) {
  if (!record) return null;
  return { ...record };
}

function persist(record) {
  chips.set(record.id, record);
  if (record.iccid) {
    byIccid.set(String(record.iccid).toLowerCase(), record);
  }
  return clone(record);
}

function remove(record) {
  chips.delete(record.id);
  if (record.iccid) {
    byIccid.delete(String(record.iccid).toLowerCase());
  }
}

export function listChips({ clientId } = {}) {
  const list = Array.from(chips.values());
  if (!clientId) {
    return list.map(clone);
  }
  return list.filter((chip) => String(chip.clientId) === String(clientId)).map(clone);
}

export function getChipById(id) {
  const record = chips.get(String(id));
  return clone(record);
}

export function findChipByIccid(iccid) {
  if (!iccid) return null;
  const record = byIccid.get(String(iccid).toLowerCase());
  return clone(record);
}

export function createChip({
  clientId,
  iccid,
  phone,
  carrier,
  status = "Disponível",
  apn = "",
  apnUser = "",
  apnPass = "",
  notes = "",
  deviceId = null,
  provider = "",
}) {
  if (!clientId) {
    throw createError(400, "clientId é obrigatório");
  }
  if (!iccid) {
    throw createError(400, "ICCID é obrigatório");
  }
  const normalizedIccid = String(iccid).trim();
  if (!normalizedIccid) {
    throw createError(400, "ICCID é obrigatório");
  }

  if (byIccid.has(normalizedIccid.toLowerCase())) {
    throw createError(409, "Já existe um chip com este ICCID");
  }

  const now = new Date().toISOString();
  const record = {
    id: randomUUID(),
    clientId: String(clientId),
    iccid: normalizedIccid,
    phone: phone ? String(phone).trim() : "",
    carrier: carrier ? String(carrier).trim() : "",
    status: status ? String(status).trim() : "Disponível",
    apn: apn ? String(apn).trim() : "",
    apnUser: apnUser ? String(apnUser).trim() : "",
    apnPass: apnPass ? String(apnPass).trim() : "",
    notes: notes ? String(notes).trim() : "",
    provider: provider ? String(provider).trim() : "",
    deviceId: deviceId ? String(deviceId) : null,
    createdAt: now,
    updatedAt: now,
  };

  return persist(record);
}

export function updateChip(id, updates = {}) {
  const record = chips.get(String(id));
  if (!record) {
    throw createError(404, "Chip não encontrado");
  }
  if (Object.prototype.hasOwnProperty.call(updates, "phone")) {
    record.phone = updates.phone ? String(updates.phone).trim() : "";
  }
  if (Object.prototype.hasOwnProperty.call(updates, "carrier")) {
    record.carrier = updates.carrier ? String(updates.carrier).trim() : "";
  }
  if (Object.prototype.hasOwnProperty.call(updates, "status")) {
    record.status = updates.status ? String(updates.status).trim() : "";
  }
  if (Object.prototype.hasOwnProperty.call(updates, "apn")) {
    record.apn = updates.apn ? String(updates.apn).trim() : "";
  }
  if (Object.prototype.hasOwnProperty.call(updates, "apnUser")) {
    record.apnUser = updates.apnUser ? String(updates.apnUser).trim() : "";
  }
  if (Object.prototype.hasOwnProperty.call(updates, "apnPass")) {
    record.apnPass = updates.apnPass ? String(updates.apnPass).trim() : "";
  }
  if (Object.prototype.hasOwnProperty.call(updates, "notes")) {
    record.notes = updates.notes ? String(updates.notes).trim() : "";
  }
  if (Object.prototype.hasOwnProperty.call(updates, "provider")) {
    record.provider = updates.provider ? String(updates.provider).trim() : "";
  }
  if (Object.prototype.hasOwnProperty.call(updates, "deviceId")) {
    record.deviceId = updates.deviceId ? String(updates.deviceId) : null;
  }
  record.updatedAt = new Date().toISOString();
  return persist(record);
}

export function deleteChip(id) {
  const record = chips.get(String(id));
  if (!record) {
    throw createError(404, "Chip não encontrado");
  }
  remove(record);
  return clone(record);
}

export default {
  listChips,
  getChipById,
  findChipByIccid,
  createChip,
  updateChip,
  deleteChip,
};
