import crypto from "node:crypto";

import { getItineraryById } from "../../models/itinerary.js";
import { getGeozoneGroupMapping, upsertGeozoneGroupMapping } from "../../models/xdm-geozone-group.js";
import XdmClient from "./xdm-client.js";
import { syncGeofence } from "./geofence-sync-service.js";

function buildGroupHash(geozoneIds = []) {
  const payload = geozoneIds.map((id) => String(id)).sort().join("|");
  return crypto.createHash("sha256").update(payload).digest("hex");
}

function getDealerId() {
  const raw = process.env.XDM_DEALER_ID;
  const dealerId = raw != null ? Number(raw) : null;
  if (!Number.isFinite(dealerId)) {
    throw new Error("XDM_DEALER_ID é obrigatório para criar grupos de geozone");
  }
  return dealerId;
}

export async function syncGeozoneGroup(itineraryId, { clientId, correlationId, geofencesById } = {}) {
  const itinerary = getItineraryById(itineraryId);
  if (!itinerary) {
    throw new Error("Itinerário não encontrado");
  }
  if (clientId && String(itinerary.clientId) !== String(clientId)) {
    throw new Error("Itinerário não pertence ao cliente");
  }

  const items = Array.isArray(itinerary.items) ? itinerary.items : [];
  const geofenceIds = items.filter((item) => item.type === "geofence").map((item) => item.id);
  if (!geofenceIds.length) {
    throw new Error("Itinerário não possui cercas para sincronizar");
  }

  const xdmGeozoneIds = [];
  for (const geofenceId of geofenceIds) {
    const geofenceOverride = geofencesById ? geofencesById.get(String(geofenceId)) : null;
    const xdmGeofenceId = await syncGeofence(geofenceId, {
      clientId: itinerary.clientId,
      correlationId,
      geofence: geofenceOverride || undefined,
    });
    xdmGeozoneIds.push(xdmGeofenceId);
  }

  const groupHash = buildGroupHash(xdmGeozoneIds);
  const mapping = getGeozoneGroupMapping({ itineraryId, clientId: itinerary.clientId });
  if (mapping?.xdmGeozoneGroupId && mapping.groupHash === groupHash) {
    return { xdmGeozoneGroupId: mapping.xdmGeozoneGroupId, groupHash };
  }

  const xdmClient = new XdmClient();
  const dealerId = getDealerId();
  const groupName = itinerary.name || `Itinerário ${itinerary.id}`;

  let xdmGeozoneGroupId = mapping?.xdmGeozoneGroupId || null;

  if (!xdmGeozoneGroupId) {
    xdmGeozoneGroupId = await xdmClient.request("POST", "/api/external/v1/geozonegroups", {
      name: groupName,
      dealerId,
      notes: `Itinerário ${itinerary.id}`,
    }, {
      correlationId,
    });
  } else {
    await xdmClient.request("PUT", `/api/external/v1/geozonegroups/${xdmGeozoneGroupId}`, {
      id: Number(xdmGeozoneGroupId),
      name: groupName,
      dealerId,
      notes: `Itinerário ${itinerary.id}`,
    }, {
      correlationId,
    });
  }

  const groupInfo = await xdmClient.request("GET", `/api/external/v1/geozonegroups/${xdmGeozoneGroupId}`, null, {
    correlationId,
  });
  const existingIds = Array.isArray(groupInfo?.geozoneIds) ? groupInfo.geozoneIds.map((id) => Number(id)) : [];
  const desiredIds = Array.from(new Set(xdmGeozoneIds.map((id) => Number(id))));

  const toRemove = existingIds.filter((id) => !desiredIds.includes(id));
  const toAdd = desiredIds.filter((id) => !existingIds.includes(id));

  if (toRemove.length) {
    await xdmClient.request(
      "DELETE",
      `/api/external/v1/geozonegroups/${xdmGeozoneGroupId}/geozones`,
      { geozoneIds: toRemove },
      { correlationId },
    );
  }
  if (toAdd.length) {
    await xdmClient.request(
      "POST",
      `/api/external/v1/geozonegroups/${xdmGeozoneGroupId}/geozones`,
      { geozoneIds: toAdd },
      { correlationId },
    );
  }

  upsertGeozoneGroupMapping({
    itineraryId: itinerary.id,
    clientId: itinerary.clientId,
    groupHash,
    xdmGeozoneGroupId,
  });

  return { xdmGeozoneGroupId, groupHash };
}

export default {
  syncGeozoneGroup,
};
