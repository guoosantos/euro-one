import { randomUUID } from "crypto";

import { loadCollection, saveCollection } from "../services/storage.js";

const STORAGE_KEY = "itinerary_embark_history";
const embarkHistory = loadCollection(STORAGE_KEY, []);

function clone(record) {
  if (!record) return null;
  return JSON.parse(JSON.stringify(record));
}

function persist(list) {
  saveCollection(STORAGE_KEY, list);
  return list;
}

export function listEmbarkHistory({ clientId } = {}) {
  const list = Array.isArray(embarkHistory) ? embarkHistory : [];
  const filtered = clientId ? list.filter((entry) => String(entry.clientId) === String(clientId)) : list;
  return filtered
    .slice()
    .sort((a, b) => new Date(b.sentAt || 0).getTime() - new Date(a.sentAt || 0).getTime())
    .map(clone);
}

export function addEmbarkEntries(entries = []) {
  if (!Array.isArray(entries) || entries.length === 0) return [];
  const stamped = entries.map((entry) => ({ id: randomUUID(), ...entry }));
  embarkHistory.push(...stamped);
  persist(embarkHistory);
  return stamped.map(clone);
}

export function getEmbarkPairIndex() {
  return new Set(
    (Array.isArray(embarkHistory) ? embarkHistory : [])
      .filter((entry) => entry?.itineraryId && entry?.vehicleId)
      .map((entry) => `${entry.itineraryId}:${entry.vehicleId}`),
  );
}

export default {
  listEmbarkHistory,
  addEmbarkEntries,
  getEmbarkPairIndex,
};
