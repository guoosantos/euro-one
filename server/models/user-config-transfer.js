import { randomUUID } from "crypto";

import { loadCollection, saveCollection } from "../services/storage.js";

const STORAGE_KEY = "userConfigTransferLog";
const transfers = new Map();

function syncStorage() {
  saveCollection(STORAGE_KEY, Array.from(transfers.values()));
}

const persisted = loadCollection(STORAGE_KEY, []);
persisted.forEach((record) => {
  if (record?.id) {
    transfers.set(String(record.id), { ...record });
  }
});

export function createUserConfigTransferLog({
  fromUserId,
  toUserId,
  performedBy,
  mode,
  clientId = null,
}) {
  const id = randomUUID();
  const now = new Date().toISOString();
  const record = {
    id,
    fromUserId: String(fromUserId),
    toUserId: String(toUserId),
    performedBy: performedBy ? String(performedBy) : null,
    mode: mode || "OVERWRITE",
    clientId: clientId ? String(clientId) : null,
    createdAt: now,
  };
  transfers.set(record.id, record);
  syncStorage();
  return { ...record };
}

export function listUserConfigTransferLogs({ clientId } = {}) {
  const list = Array.from(transfers.values());
  if (!clientId) return list.map((entry) => ({ ...entry }));
  return list
    .filter((entry) => String(entry.clientId) === String(clientId))
    .map((entry) => ({ ...entry }));
}

export default {
  createUserConfigTransferLog,
  listUserConfigTransferLogs,
};
