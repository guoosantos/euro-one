import crypto from "node:crypto";
import createError from "http-errors";

import { getItineraryById, updateItinerary } from "../../models/itinerary.js";
import { getGeofenceById } from "../../models/geofence.js";
import { getRouteById } from "../../models/route.js";
import { getGeofenceMapping } from "../../models/xdm-geofence.js";
import {
  getGeozoneGroupMapping,
  getGeozoneGroupMappingByScope,
  upsertGeozoneGroupMapping,
  upsertGeozoneGroupMappingByScope,
} from "../../models/xdm-geozone-group.js";
import XdmClient from "./xdm-client.js";
import { syncGeofence, normalizePolygon, buildGeometryHash } from "./geofence-sync-service.js";
import { syncRouteGeozone } from "./route-geozone-sync-service.js";
import { normalizeGeozoneGroupIdResponse, normalizeXdmId } from "./xdm-utils.js";
import { wrapXdmError, isNoPermissionError, logNoPermissionDiagnostics } from "./xdm-error.js";
import { buildItineraryKml } from "../../utils/kml.js";

const HASH_VERSION = "v1";

function sanitizeName(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed) return "";
  return trimmed.replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function buildGroupName({ clientId, itineraryId, itineraryName }) {
  const safeClient = sanitizeName(clientId) || "CLIENT";
  const safeItineraryId = sanitizeName(itineraryId) || "ITINERARY";
  const safeItinerary = sanitizeName(itineraryName) || "ITINERARIO";
  return `EUROONE_${safeClient}_${safeItineraryId}_GROUP_${safeItinerary}`;
}

function buildScopedGroupName({ clientId, scopeId }) {
  const safeClient = sanitizeName(clientId) || "CLIENT";
  const safeScope = sanitizeName(scopeId) || "SCOPE";
  return `EUROONE_${safeClient}_${safeScope}_GEOZONEGROUP`;
}

function buildGroupHash(geofenceEntries = []) {
  const payload = [HASH_VERSION, ...geofenceEntries.map((entry) => `${entry.type}:${entry.geometryHash}`)].join("|");
  return crypto.createHash("sha256").update(payload).digest("hex");
}

function getDealerId() {
  const raw = process.env.XDM_DEALER_ID;
  const dealerId = raw != null ? Number(raw) : null;
  if (!Number.isFinite(dealerId)) {
    throw new Error("XDM_DEALER_ID é obrigatório para criar grupos de GEOFENCES");
  }
  return dealerId;
}

async function findGeozoneGroupByName({ name, correlationId, xdmClient }) {
  if (!name) return null;
  const encodedName = encodeURIComponent(name);
  const response = await xdmClient.request(
    "GET",
    `/api/external/v1/geozonegroups/filter?Name=${encodedName}&FirstRecord=0&ItemsPerPage=25`,
    null,
    { correlationId },
  );

  const results = Array.isArray(response?.results) ? response.results : Array.isArray(response) ? response : [];
  const normalizedName = String(name).trim().toLowerCase();
  const match = results.find((item) => String(item?.name || "").trim().toLowerCase() === normalizedName);
  if (!match?.id) return null;
  return normalizeXdmId(match.id, { context: "discover geozonegroup" });
}

async function resolveGeozoneGroupId({
  created,
  groupName,
  correlationId,
  xdmClient,
  payloadSample,
} = {}) {
  try {
    return normalizeGeozoneGroupIdResponse(created, { context: "create geozonegroup" });
  } catch (error) {
    try {
      const discovered = await findGeozoneGroupByName({ name: groupName, correlationId, xdmClient });
      if (discovered) return discovered;
    } catch (lookupError) {
      throw wrapXdmError(lookupError, {
        step: "discoverGroup",
        correlationId,
        payloadSample,
      });
    }
    throw wrapXdmError(error, {
      step: "createGroup",
      correlationId,
      payloadSample,
    });
  }
}

function persistItineraryGroupId({ itineraryId, xdmGeozoneGroupId }) {
  if (!itineraryId || !xdmGeozoneGroupId) return;
  const itinerary = getItineraryById(itineraryId);
  if (!itinerary) return;
  if (itinerary.xdmGeozoneGroupId === xdmGeozoneGroupId) return;
  updateItinerary(itineraryId, { xdmGeozoneGroupId });
}

function markItineraryWarning({ itineraryId, message }) {
  if (!itineraryId) return;
  updateItinerary(itineraryId, {
    xdmSyncStatus: "SYNCED_WITH_WARNINGS",
    xdmLastSyncError: message || "XDM sem permissão para gerenciar geozones",
    xdmLastError: message || "XDM sem permissão para gerenciar geozones",
    xdmLastSyncedAt: new Date().toISOString(),
  });
}

function buildGroupImportName({ itinerary, groupName }) {
  const base = itinerary?.name || groupName || `Itinerário ${itinerary?.id || "grupo"}`;
  return sanitizeName(base) || "GEOZONE_GROUP";
}

async function importGeozonesToGroup({
  itinerary,
  groupName,
  geofences = [],
  routes = [],
  xdmGeozoneGroupId,
  correlationId,
  xdmClient,
}) {
  const kml = buildItineraryKml({
    name: itinerary?.name || groupName || "Itinerário",
    geofences,
    routes,
  });
  const importName = buildGroupImportName({ itinerary, groupName });
  const form = new FormData();
  form.append(
    "files",
    new Blob([kml], { type: "application/vnd.google-earth.kml+xml" }),
    `${importName}.kml`,
  );

  try {
    const response = await xdmClient.request(
      "POST",
      `/api/external/v1/geozonegroups/${xdmGeozoneGroupId}/importGeozones`,
      form,
      { correlationId },
    );
    if (Array.isArray(response)) {
      return response.map((id) => Number(id)).filter((id) => Number.isFinite(id));
    }
    if (response?.geozoneIds && Array.isArray(response.geozoneIds)) {
      return response.geozoneIds.map((id) => Number(id)).filter((id) => Number.isFinite(id));
    }
    if (Number.isFinite(Number(response))) {
      return [Number(response)];
    }
    return [];
  } catch (error) {
    if (isNoPermissionError(error)) {
      console.warn("[xdm] NO_PERMISSION importGeozones", {
        correlationId,
        itineraryId: itinerary?.id || null,
        xdmGeozoneGroupId,
      });
      logNoPermissionDiagnostics({
        error,
        correlationId,
        method: "POST",
        path: `/api/external/v1/geozonegroups/${xdmGeozoneGroupId}/importGeozones`,
      });
    }
    throw wrapXdmError(error, {
      step: "importGeozones",
      correlationId,
      payloadSample: {
        itineraryId: itinerary?.id || null,
        xdmGeozoneGroupId,
      },
    });
  }
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
  const selectedItems = items.filter((item) => ["geofence", "target", "route"].includes(item.type));
  if (!selectedItems.length) {
    throw new Error("Itinerário não possui itens para sincronizar");
  }

  const xdmGeozoneIds = [];
  const geofenceEntries = [];
  const geofenceRecords = [];
  const itemMappings = [];
  const routeRecords = [];
  for (const item of selectedItems) {
    if (item.type === "route") {
      const routeRecord = await getRouteById(item.id);
      if (routeRecord) {
        routeRecords.push(routeRecord);
      }
      const routeResult = await syncRouteGeozone(item.id, {
        clientId: itinerary.clientId,
        correlationId,
      });
      xdmGeozoneIds.push(routeResult.xdmGeozoneId);
      geofenceEntries.push({
        type: item.type,
        geometryHash: routeResult.geometryHash,
      });
      itemMappings.push({
        type: item.type,
        id: item.id,
        xdmGeozoneId: routeResult.xdmGeozoneId,
      });
      continue;
    }

    const geofenceId = item.id;
    const geofenceOverride = geofencesById ? geofencesById.get(String(geofenceId)) : null;
    const geofenceRecord = geofenceOverride || (await getGeofenceById(geofenceId));
    if (!geofenceRecord) {
      throw new Error("Geofence não encontrada para o itinerário");
    }

    geofenceRecords.push(geofenceRecord);

    const xdmGeofenceId = await syncGeofence(geofenceId, {
      clientId: itinerary.clientId,
      correlationId,
      geofence: geofenceRecord,
      itineraryId: itinerary.id,
    });
    xdmGeozoneIds.push(xdmGeofenceId);

    const mapping = getGeofenceMapping({ geofenceId, clientId: itinerary.clientId });
    const geometryHash =
      mapping?.geometryHash ||
      buildGeometryHash(
        normalizePolygon({
          type: geofenceRecord.type,
          points: geofenceRecord.points,
          radius: geofenceRecord.radius,
          latitude: geofenceRecord.latitude,
          longitude: geofenceRecord.longitude,
          center: geofenceRecord.center,
        }),
      );

    geofenceEntries.push({
      type: item.type,
      geometryHash,
    });
    itemMappings.push({
      type: item.type,
      id: geofenceId,
      xdmGeozoneId: xdmGeofenceId,
    });
  }

  const groupHash = buildGroupHash(geofenceEntries);
  const mapping = getGeozoneGroupMapping({ itineraryId, clientId: itinerary.clientId });
  let mappedId = null;
  if (mapping?.xdmGeozoneGroupId != null) {
    mappedId = normalizeXdmId(mapping.xdmGeozoneGroupId, { context: "mapping geozonegroup" });
    if (mappedId !== mapping.xdmGeozoneGroupId) {
      upsertGeozoneGroupMapping({
        itineraryId: itinerary.id,
        clientId: itinerary.clientId,
        groupHash: mapping.groupHash,
        xdmGeozoneGroupId: mappedId,
      });
    }
  }
  if (mappedId && mapping.groupHash === groupHash) {
    return { xdmGeozoneGroupId: mappedId, groupHash };
  }

  const xdmClient = new XdmClient();
  const dealerId = getDealerId();
  const itineraryName = itinerary.name || `Itinerário ${itinerary.id}`;
  const groupName = buildGroupName({
    clientId: itinerary.clientId,
    itineraryId: itinerary.id,
    itineraryName,
  });
  const notes = `itineraryId=${itinerary.id}, hash=${groupHash}`;

  let xdmGeozoneGroupId = mappedId || null;

  if (!xdmGeozoneGroupId) {
    let created;
    try {
      created = await xdmClient.request(
        "POST",
        "/api/external/v1/geozonegroups",
        {
          name: groupName,
          dealerId,
          notes,
        },
        {
          correlationId,
        },
      );
    } catch (error) {
      throw wrapXdmError(error, {
        step: "createGroup",
        correlationId,
        payloadSample: { itineraryId: itinerary.id, clientId: itinerary.clientId, groupName },
      });
    }
    xdmGeozoneGroupId = await resolveGeozoneGroupId({
      created,
      groupName,
      correlationId,
      xdmClient,
      payloadSample: { itineraryId: itinerary.id, clientId: itinerary.clientId, groupName },
    });
  } else {
    xdmGeozoneGroupId = normalizeXdmId(xdmGeozoneGroupId, { context: "update geozonegroup" });
    try {
      await xdmClient.request(
        "PUT",
        `/api/external/v1/geozonegroups/${xdmGeozoneGroupId}`,
        {
          id: Number(xdmGeozoneGroupId),
          name: groupName,
          dealerId,
          notes,
        },
        {
          correlationId,
        },
      );
    } catch (error) {
      throw wrapXdmError(error, {
        step: "updateGroup",
        correlationId,
        payloadSample: { itineraryId: itinerary.id, clientId: itinerary.clientId, groupName, xdmGeozoneGroupId },
      });
    }
  }

  let groupInfo;
  try {
    groupInfo = await xdmClient.request("GET", `/api/external/v1/geozonegroups/${xdmGeozoneGroupId}`, null, {
      correlationId,
    });
  } catch (error) {
    throw wrapXdmError(error, {
      step: "loadGroup",
      correlationId,
      payloadSample: { itineraryId: itinerary.id, clientId: itinerary.clientId, xdmGeozoneGroupId },
    });
  }
  const existingIds = Array.isArray(groupInfo?.geozoneIds) ? groupInfo.geozoneIds.map((id) => Number(id)) : [];
  const desiredIds = Array.from(new Set(xdmGeozoneIds.map((id) => Number(id))));

  const toRemove = existingIds.filter((id) => !desiredIds.includes(id));
  const toAdd = desiredIds.filter((id) => !existingIds.includes(id));
  const warnings = [];
  let importedGeozoneIds = null;

  if (toRemove.length) {
    try {
      await xdmClient.request(
        "DELETE",
        `/api/external/v1/geozonegroups/${xdmGeozoneGroupId}/geozones`,
        { geozoneIds: toRemove },
        { correlationId },
      );
    } catch (error) {
      if (isNoPermissionError(error)) {
        warnings.push("NO_PERMISSION removeGeozones");
        console.warn("[xdm] NO_PERMISSION removeGeozones", {
          correlationId,
          itineraryId: itinerary.id,
          xdmGeozoneGroupId,
        });
        logNoPermissionDiagnostics({
          error,
          correlationId,
          method: "DELETE",
          path: `/api/external/v1/geozonegroups/${xdmGeozoneGroupId}/geozones`,
        });
        markItineraryWarning({
          itineraryId: itinerary.id,
          message: "Sem permissão para remover geozones do grupo no XDM",
        });
      } else {
        throw wrapXdmError(error, {
          step: "removeGeozones",
          correlationId,
          payloadSample: { itineraryId: itinerary.id, clientId: itinerary.clientId, xdmGeozoneGroupId, toRemove },
        });
      }
    }
  }
  if (toAdd.length) {
    try {
      await xdmClient.request(
        "POST",
        `/api/external/v1/geozonegroups/${xdmGeozoneGroupId}/geozones`,
        { geozoneIds: toAdd },
        { correlationId },
      );
    } catch (error) {
      if (isNoPermissionError(error)) {
        warnings.push("NO_PERMISSION addGeozones");
        console.warn("[xdm] NO_PERMISSION addGeozones", {
          correlationId,
          itineraryId: itinerary.id,
          xdmGeozoneGroupId,
        });
        logNoPermissionDiagnostics({
          error,
          correlationId,
          method: "POST",
          path: `/api/external/v1/geozonegroups/${xdmGeozoneGroupId}/geozones`,
        });

        try {
          importedGeozoneIds = await importGeozonesToGroup({
            itinerary,
            groupName,
            geofences: geofenceRecords,
            routes: routeRecords,
            xdmGeozoneGroupId,
            correlationId,
            xdmClient,
          });
        } catch (importError) {
          if (isNoPermissionError(importError)) {
            throw createError(
              403,
              "Token sem permissão para gerenciar geozones/geozonegroups. Verifique roles do client no XDM",
            );
          }
          throw importError;
        }
      } else {
        throw wrapXdmError(error, {
          step: "addGeozones",
          correlationId,
          payloadSample: { itineraryId: itinerary.id, clientId: itinerary.clientId, xdmGeozoneGroupId, toAdd },
        });
      }
    }
  }

  upsertGeozoneGroupMapping({
    itineraryId: itinerary.id,
    clientId: itinerary.clientId,
    groupHash,
    xdmGeozoneGroupId,
  });
  persistItineraryGroupId({ itineraryId: itinerary.id, xdmGeozoneGroupId });

  if (Array.isArray(importedGeozoneIds) && importedGeozoneIds.length) {
    updateItinerary(itinerary.id, {
      xdmGeozoneIds: importedGeozoneIds,
    });
  }

  return {
    xdmGeozoneGroupId,
    groupHash,
    itemMappings,
    xdmGeozoneIds: importedGeozoneIds,
    warnings,
  };
}

export async function syncGeozoneGroupForGeofences({
  clientId,
  geofenceIds = [],
  groupName,
  scopeKey,
  scopeId,
  correlationId,
  geofencesById,
} = {}) {
  if (!clientId) {
    throw new Error("clientId é obrigatório para sincronizar geozones");
  }

  const ids = Array.isArray(geofenceIds) ? geofenceIds : [];
  if (!ids.length) {
    throw new Error("geofenceIds é obrigatório para sincronizar geozones");
  }

  const xdmGeozoneIds = [];
  const geofenceEntries = [];
  const geofenceRecords = [];

  for (const geofenceId of ids) {
    const geofenceOverride = geofencesById ? geofencesById.get(String(geofenceId)) : null;
    const geofenceRecord = geofenceOverride || (await getGeofenceById(geofenceId));
    if (!geofenceRecord) {
      throw new Error("Geofence não encontrada para sincronização");
    }
    if (String(geofenceRecord.clientId) !== String(clientId)) {
      throw new Error("Geofence não pertence ao cliente");
    }

    geofenceRecords.push(geofenceRecord);

    const xdmGeofenceId = await syncGeofence(geofenceId, {
      clientId,
      correlationId,
      geofence: geofenceRecord,
    });
    xdmGeozoneIds.push(xdmGeofenceId);

    const mapping = getGeofenceMapping({ geofenceId, clientId });
    const geometryHash =
      mapping?.geometryHash ||
      buildGeometryHash(
        normalizePolygon({
          type: geofenceRecord.type,
          points: geofenceRecord.points,
          radius: geofenceRecord.radius,
          latitude: geofenceRecord.latitude,
          longitude: geofenceRecord.longitude,
          center: geofenceRecord.center,
        }),
      );

    geofenceEntries.push({
      type: geofenceRecord.type || "geofence",
      geometryHash,
    });
  }

  const groupHash = buildGroupHash(geofenceEntries);
  const resolvedScopeId = scopeId || scopeKey || `${clientId}:${ids.join(",")}`;
  const mappingKey = scopeKey || resolvedScopeId;
  const resolvedName = groupName || buildScopedGroupName({ clientId, scopeId: resolvedScopeId });

  const mapping = getGeozoneGroupMappingByScope({ scopeKey: mappingKey, clientId });
  let mappedId = null;
  if (mapping?.xdmGeozoneGroupId != null) {
    mappedId = normalizeXdmId(mapping.xdmGeozoneGroupId, { context: "mapping geozonegroup scope" });
    if (mappedId !== mapping.xdmGeozoneGroupId) {
      upsertGeozoneGroupMappingByScope({
        scopeKey: mappingKey,
        clientId,
        groupHash: mapping.groupHash,
        xdmGeozoneGroupId: mappedId,
        groupName: mapping.groupName || resolvedName,
      });
    }
  }
  if (mappedId && mapping.groupHash === groupHash) {
    return { xdmGeozoneGroupId: mappedId, groupHash, groupName: resolvedName };
  }

  const xdmClient = new XdmClient();
  const dealerId = getDealerId();
  const notes = `scope=${resolvedScopeId}, hash=${groupHash}`;

  let xdmGeozoneGroupId = mappedId || null;

  if (!xdmGeozoneGroupId) {
    let created;
    try {
      created = await xdmClient.request(
        "POST",
        "/api/external/v1/geozonegroups",
        {
          name: resolvedName,
          dealerId,
          notes,
        },
        {
          correlationId,
        },
      );
    } catch (error) {
      throw wrapXdmError(error, {
        step: "createGroup",
        correlationId,
        payloadSample: { scopeKey: mappingKey, clientId, groupName: resolvedName },
      });
    }
    xdmGeozoneGroupId = await resolveGeozoneGroupId({
      created,
      groupName: resolvedName,
      correlationId,
      xdmClient,
      payloadSample: { scopeKey: mappingKey, clientId, groupName: resolvedName },
    });
  } else {
    xdmGeozoneGroupId = normalizeXdmId(xdmGeozoneGroupId, { context: "update geozonegroup scope" });
    try {
      await xdmClient.request(
        "PUT",
        `/api/external/v1/geozonegroups/${xdmGeozoneGroupId}`,
        {
          id: Number(xdmGeozoneGroupId),
          name: resolvedName,
          dealerId,
          notes,
        },
        {
          correlationId,
        },
      );
    } catch (error) {
      throw wrapXdmError(error, {
        step: "updateGroup",
        correlationId,
        payloadSample: { scopeKey: mappingKey, clientId, groupName: resolvedName, xdmGeozoneGroupId },
      });
    }
  }

  let groupInfo;
  try {
    groupInfo = await xdmClient.request("GET", `/api/external/v1/geozonegroups/${xdmGeozoneGroupId}`, null, {
      correlationId,
    });
  } catch (error) {
    throw wrapXdmError(error, {
      step: "loadGroup",
      correlationId,
      payloadSample: { scopeKey: mappingKey, clientId, xdmGeozoneGroupId },
    });
  }
  const existingIds = Array.isArray(groupInfo?.geozoneIds) ? groupInfo.geozoneIds.map((id) => Number(id)) : [];
  const desiredIds = Array.from(new Set(xdmGeozoneIds.map((id) => Number(id))));

  const toRemove = existingIds.filter((id) => !desiredIds.includes(id));
  const toAdd = desiredIds.filter((id) => !existingIds.includes(id));
  const warnings = [];

  if (toRemove.length) {
    try {
      await xdmClient.request(
        "DELETE",
        `/api/external/v1/geozonegroups/${xdmGeozoneGroupId}/geozones`,
        { geozoneIds: toRemove },
        { correlationId },
      );
    } catch (error) {
      if (isNoPermissionError(error)) {
        warnings.push("NO_PERMISSION removeGeozones");
        console.warn("[xdm] NO_PERMISSION removeGeozones", {
          correlationId,
          scopeKey: mappingKey,
          xdmGeozoneGroupId,
        });
        logNoPermissionDiagnostics({
          error,
          correlationId,
          method: "DELETE",
          path: `/api/external/v1/geozonegroups/${xdmGeozoneGroupId}/geozones`,
        });
      } else {
        throw wrapXdmError(error, {
          step: "removeGeozones",
          correlationId,
          payloadSample: { scopeKey: mappingKey, clientId, xdmGeozoneGroupId, toRemove },
        });
      }
    }
  }
  if (toAdd.length) {
    try {
      await xdmClient.request(
        "POST",
        `/api/external/v1/geozonegroups/${xdmGeozoneGroupId}/geozones`,
        { geozoneIds: toAdd },
        { correlationId },
      );
    } catch (error) {
      if (isNoPermissionError(error)) {
        warnings.push("NO_PERMISSION addGeozones");
        console.warn("[xdm] NO_PERMISSION addGeozones", {
          correlationId,
          scopeKey: mappingKey,
          xdmGeozoneGroupId,
        });
        logNoPermissionDiagnostics({
          error,
          correlationId,
          method: "POST",
          path: `/api/external/v1/geozonegroups/${xdmGeozoneGroupId}/geozones`,
        });
        try {
          await importGeozonesToGroup({
            itinerary: null,
            groupName: resolvedName,
            geofences: geofenceRecords,
            routes: [],
            xdmGeozoneGroupId,
            correlationId,
            xdmClient,
          });
        } catch (importError) {
          if (isNoPermissionError(importError)) {
            throw createError(
              403,
              "Token sem permissão para gerenciar geozones/geozonegroups. Verifique roles do client no XDM",
            );
          }
          throw importError;
        }
      } else {
        throw wrapXdmError(error, {
          step: "addGeozones",
          correlationId,
          payloadSample: { scopeKey: mappingKey, clientId, xdmGeozoneGroupId, toAdd },
        });
      }
    }
  }

  upsertGeozoneGroupMappingByScope({
    scopeKey: mappingKey,
    clientId,
    groupHash,
    xdmGeozoneGroupId,
    groupName: resolvedName,
  });

  return { xdmGeozoneGroupId, groupHash, groupName: resolvedName, warnings };
}

export async function ensureGeozoneGroup(itineraryId, { clientId, correlationId, geofencesById } = {}) {
  const itinerary = getItineraryById(itineraryId);
  if (!itinerary) {
    throw new Error("Itinerário não encontrado");
  }
  if (clientId && String(itinerary.clientId) !== String(clientId)) {
    throw new Error("Itinerário não pertence ao cliente");
  }

  if (itinerary.xdmGeozoneGroupId != null) {
    return {
      xdmGeozoneGroupId: normalizeXdmId(itinerary.xdmGeozoneGroupId, { context: "itinerary geozonegroup" }),
      groupHash: getGeozoneGroupMapping({ itineraryId, clientId: itinerary.clientId })?.groupHash || null,
    };
  }

  const mapping = getGeozoneGroupMapping({ itineraryId, clientId: itinerary.clientId });
  if (mapping?.xdmGeozoneGroupId != null) {
    const normalized = normalizeXdmId(mapping.xdmGeozoneGroupId, { context: "mapping geozonegroup" });
    persistItineraryGroupId({ itineraryId: itinerary.id, xdmGeozoneGroupId: normalized });
    return { xdmGeozoneGroupId: normalized, groupHash: mapping.groupHash || null };
  }

  return syncGeozoneGroup(itinerary.id, { clientId: itinerary.clientId, correlationId, geofencesById });
}

export default {
  syncGeozoneGroup,
  syncGeozoneGroupForGeofences,
  ensureGeozoneGroup,
};
