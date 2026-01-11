import { loadCollection, saveCollection } from "../services/storage.js";

const STORAGE_KEY = "xdm_geozone_groups";
const groups = loadCollection(STORAGE_KEY, []);

function clone(record) {
  if (!record) return null;
  return JSON.parse(JSON.stringify(record));
}

function persist() {
  saveCollection(STORAGE_KEY, groups);
}

export function getGeozoneGroupMapping({ itineraryId, clientId }) {
  const record = groups.find(
    (item) => String(item.id) === String(itineraryId) && (!clientId || String(item.clientId) === String(clientId)),
  );
  return clone(record);
}

export function getGeozoneGroupMappingByScope({ scopeKey, clientId }) {
  const record = groups.find(
    (item) =>
      String(item.scopeKey) === String(scopeKey) && (!clientId || String(item.clientId) === String(clientId)),
  );
  return clone(record);
}

export function upsertGeozoneGroupMapping({ itineraryId, clientId, groupHash, xdmGeozoneGroupId }) {
  const now = new Date().toISOString();
  const index = groups.findIndex(
    (item) => String(item.id) === String(itineraryId) && String(item.clientId) === String(clientId),
  );
  const payload = {
    id: String(itineraryId),
    clientId: String(clientId),
    itineraryId: String(itineraryId),
    groupHash: groupHash || null,
    xdmGeozoneGroupId: xdmGeozoneGroupId ?? null,
    updatedAt: now,
  };

  if (index >= 0) {
    groups[index] = { ...groups[index], ...payload };
  } else {
    groups.push(payload);
  }

  persist();
  return clone(payload);
}

export function upsertGeozoneGroupMappingByScope({ scopeKey, clientId, groupHash, xdmGeozoneGroupId, groupName }) {
  const now = new Date().toISOString();
  const scopeId = String(scopeKey);
  const index = groups.findIndex(
    (item) => String(item.scopeKey) === scopeId && String(item.clientId) === String(clientId),
  );
  const payload = {
    id: scopeId,
    scopeKey: scopeId,
    clientId: String(clientId),
    groupName: groupName || null,
    groupHash: groupHash || null,
    xdmGeozoneGroupId: xdmGeozoneGroupId ?? null,
    updatedAt: now,
  };

  if (index >= 0) {
    groups[index] = { ...groups[index], ...payload };
  } else {
    groups.push(payload);
  }

  persist();
  return clone(payload);
}

export function listGeozoneGroupMappings({ clientId } = {}) {
  return groups.filter((item) => (!clientId ? true : String(item.clientId) === String(clientId))).map(clone);
}

export function clearGeozoneGroupMappings() {
  groups.length = 0;
  persist();
}

export function removeGeozoneGroupMapping({ itineraryId, clientId }) {
  const before = groups.length;
  const next = groups.filter(
    (item) =>
      !(
        String(item.id) === String(itineraryId) &&
        (!clientId || String(item.clientId) === String(clientId))
      ),
  );
  groups.length = 0;
  groups.push(...next);
  if (before !== groups.length) {
    persist();
  }
}

export function removeGeozoneGroupMappingByScope({ scopeKey, clientId }) {
  const before = groups.length;
  const next = groups.filter(
    (item) =>
      !(
        String(item.scopeKey) === String(scopeKey) &&
        (!clientId || String(item.clientId) === String(clientId))
      ),
  );
  groups.length = 0;
  groups.push(...next);
  if (before !== groups.length) {
    persist();
  }
}

export default {
  getGeozoneGroupMapping,
  getGeozoneGroupMappingByScope,
  upsertGeozoneGroupMapping,
  upsertGeozoneGroupMappingByScope,
  listGeozoneGroupMappings,
  removeGeozoneGroupMapping,
  removeGeozoneGroupMappingByScope,
  clearGeozoneGroupMappings,
};
