import { loadCollection, saveCollection } from "../services/storage.js";

const STORAGE_KEY = "xdm_route_geozones";
const routes = loadCollection(STORAGE_KEY, []);

function clone(record) {
  if (!record) return null;
  return JSON.parse(JSON.stringify(record));
}

function persist() {
  saveCollection(STORAGE_KEY, routes);
}

export function getRouteGeozoneMapping({ routeId, clientId }) {
  const record = routes.find(
    (item) => String(item.id) === String(routeId) && (!clientId || String(item.clientId) === String(clientId)),
  );
  const cloned = clone(record);
  if (!cloned) return null;
  if (!Array.isArray(cloned.xdmGeozoneIds)) {
    cloned.xdmGeozoneIds = cloned.xdmGeozoneId ? [cloned.xdmGeozoneId] : [];
  }
  return cloned;
}

export function upsertRouteGeozoneMapping({
  routeId,
  clientId,
  geometryHash,
  xdmGeozoneId,
  xdmGeozoneIds,
  name,
}) {
  const now = new Date().toISOString();
  const index = routes.findIndex(
    (item) => String(item.id) === String(routeId) && String(item.clientId) === String(clientId),
  );
  const payload = {
    id: String(routeId),
    routeId: String(routeId),
    clientId: String(clientId),
    name: name || null,
    geometryHash: geometryHash || null,
    xdmGeozoneId: xdmGeozoneId ?? null,
    xdmGeozoneIds: Array.isArray(xdmGeozoneIds) ? xdmGeozoneIds : xdmGeozoneId ? [xdmGeozoneId] : [],
    updatedAt: now,
  };

  if (index >= 0) {
    routes[index] = { ...routes[index], ...payload };
  } else {
    routes.push(payload);
  }

  persist();
  return clone(payload);
}

export function removeRouteGeozoneMapping({ routeId, clientId }) {
  const before = routes.length;
  const next = routes.filter(
    (item) => !(String(item.id) === String(routeId) && (!clientId || String(item.clientId) === String(clientId))),
  );
  routes.length = 0;
  routes.push(...next);
  if (before !== routes.length) {
    persist();
  }
}

export function clearRouteGeozoneMappings() {
  routes.length = 0;
  persist();
}

export default {
  getRouteGeozoneMapping,
  upsertRouteGeozoneMapping,
  removeRouteGeozoneMapping,
  clearRouteGeozoneMappings,
};
