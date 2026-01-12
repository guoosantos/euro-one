import XdmClient from "./xdm-client.js";
import { syncGeozoneGroup } from "./geozone-group-sync-service.js";
import { listItineraries, getItineraryById, updateItinerary } from "../../models/itinerary.js";
import { getGeofenceMapping, removeGeofenceMapping } from "../../models/xdm-geofence.js";
import {
  getGeozoneGroupMapping,
  removeGeozoneGroupMapping,
} from "../../models/xdm-geozone-group.js";
import {
  getRouteGeozoneMapping,
  removeRouteGeozoneMapping,
} from "../../models/xdm-route-geozone.js";
import { normalizeXdmId } from "./xdm-utils.js";
import { wrapXdmError } from "./xdm-error.js";

function buildItemKey(item) {
  return `${item.type}:${item.id}`;
}

function applyItemMappings(items = [], itemMappings = []) {
  if (!Array.isArray(items) || !items.length) return [];
  const mapping = new Map(itemMappings.map((entry) => [`${entry.type}:${entry.id}`, entry.xdmGeozoneId]));
  return items.map((item) => {
    const mapped = mapping.get(buildItemKey(item));
    if (mapped == null) return item;
    return { ...item, xdmGeozoneId: mapped };
  });
}

export function diffRemovedItems(previousItems = [], nextItems = []) {
  const nextKeys = new Set(nextItems.map(buildItemKey));
  return (previousItems || []).filter((item) => !nextKeys.has(buildItemKey(item)));
}

function isItemUsedElsewhere({ item, clientId, excludeItineraryId }) {
  const itineraries = listItineraries(clientId ? { clientId } : {});
  return itineraries.some((itinerary) => {
    if (excludeItineraryId && String(itinerary.id) === String(excludeItineraryId)) return false;
    return (itinerary.items || []).some(
      (entry) => entry && entry.type === item.type && String(entry.id) === String(item.id),
    );
  });
}

async function deleteGeozone({ xdmGeozoneId, correlationId }) {
  if (!xdmGeozoneId) return;
  const normalized = normalizeXdmId(xdmGeozoneId, { context: "delete geozone" });
  const xdmClient = new XdmClient();
  try {
    await xdmClient.request("DELETE", `/api/external/v1/geozones/${normalized}`, null, { correlationId });
  } catch (error) {
    throw wrapXdmError(error, {
      step: "deleteGeozone",
      correlationId,
      payloadSample: { xdmGeozoneId: normalized },
    });
  }
}

export async function cleanupGeozoneForItem({ item, clientId, correlationId, excludeItineraryId }) {
  if (!item) return;
  if (isItemUsedElsewhere({ item, clientId, excludeItineraryId })) {
    return;
  }

  if (item.type === "route") {
    const mapping = getRouteGeozoneMapping({ routeId: item.id, clientId });
    const xdmGeozoneId = mapping?.xdmGeozoneId || item.xdmGeozoneId || null;
    await deleteGeozone({ xdmGeozoneId, correlationId });
    removeRouteGeozoneMapping({ routeId: item.id, clientId });
    return;
  }

  const mapping = getGeofenceMapping({ geofenceId: item.id, clientId });
  const xdmGeozoneId = mapping?.xdmGeofenceId || item.xdmGeozoneId || null;
  await deleteGeozone({ xdmGeozoneId, correlationId });
  removeGeofenceMapping({ geofenceId: item.id, clientId });
}

export async function syncItineraryXdm(itineraryId, { clientId, correlationId, geofencesById } = {}) {
  const syncResult = await syncGeozoneGroup(itineraryId, { clientId, correlationId, geofencesById });
  const itinerary = getItineraryById(itineraryId);
  if (!itinerary) {
    throw new Error("Itinerário não encontrado para persistir mapeamento XDM");
  }

  const mergedItems = applyItemMappings(itinerary.items || [], syncResult.itemMappings || []);
  const updated = updateItinerary(itinerary.id, {
    items: mergedItems,
    xdmGeozoneGroupId: syncResult.xdmGeozoneGroupId,
    xdmSyncStatus: "OK",
    xdmLastSyncError: null,
    xdmLastSyncedAt: new Date().toISOString(),
  });

  return { itinerary: updated, ...syncResult };
}

export async function deleteItineraryGeozoneGroup({ itineraryId, clientId, correlationId }) {
  const itinerary = getItineraryById(itineraryId);
  const mapping = getGeozoneGroupMapping({ itineraryId, clientId });
  const xdmGeozoneGroupId =
    itinerary?.xdmGeozoneGroupId || mapping?.xdmGeozoneGroupId || null;

  if (!xdmGeozoneGroupId) {
    removeGeozoneGroupMapping({ itineraryId, clientId });
    return;
  }

  try {
    const normalized = normalizeXdmId(xdmGeozoneGroupId, { context: "delete geozone group" });
    const xdmClient = new XdmClient();
    try {
      await xdmClient.request("DELETE", `/api/external/v1/geozonegroups/${normalized}`, null, { correlationId });
    } catch (error) {
      throw wrapXdmError(error, {
        step: "deleteGroup",
        correlationId,
        payloadSample: { itineraryId, clientId, xdmGeozoneGroupId: normalized },
      });
    }
  } finally {
    removeGeozoneGroupMapping({ itineraryId, clientId });
  }
}

export default {
  syncItineraryXdm,
  diffRemovedItems,
  cleanupGeozoneForItem,
  deleteItineraryGeozoneGroup,
};
