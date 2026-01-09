import { loadCollection, saveCollection } from "../services/storage.js";

const STORAGE_KEY = "xdm_geofences";
const geofences = loadCollection(STORAGE_KEY, []);

function clone(record) {
  if (!record) return null;
  return JSON.parse(JSON.stringify(record));
}

function persist() {
  saveCollection(STORAGE_KEY, geofences);
}

export function getGeofenceMapping({ geofenceId, clientId }) {
  const record = geofences.find(
    (item) => String(item.id) === String(geofenceId) && (!clientId || String(item.clientId) === String(clientId)),
  );
  return clone(record);
}

export function upsertGeofenceMapping({
  geofenceId,
  clientId,
  name,
  geometry,
  kmlOriginal,
  geometryHash,
  xdmGeofenceId,
}) {
  const now = new Date().toISOString();
  const index = geofences.findIndex(
    (item) => String(item.id) === String(geofenceId) && String(item.clientId) === String(clientId),
  );
  const payload = {
    id: String(geofenceId),
    clientId: String(clientId),
    name: name || null,
    geometry: geometry || null,
    kmlOriginal: kmlOriginal || null,
    geometryHash: geometryHash || null,
    xdmGeofenceId: xdmGeofenceId ?? null,
    updatedAt: now,
  };

  if (index >= 0) {
    geofences[index] = { ...geofences[index], ...payload };
  } else {
    geofences.push(payload);
  }

  persist();
  return clone(payload);
}

export function listGeofenceMappings({ clientId } = {}) {
  return geofences
    .filter((item) => (!clientId ? true : String(item.clientId) === String(clientId)))
    .map(clone);
}

export default {
  getGeofenceMapping,
  upsertGeofenceMapping,
  listGeofenceMappings,
};
