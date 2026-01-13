import crypto from "node:crypto";
import createError from "http-errors";

import { getItineraryById, listItineraries, updateItinerary } from "../../models/itinerary.js";
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
import {
  buildFriendlyName,
  buildFriendlyNameWithSuffix,
  buildShortIdSuffix,
  resolveClientDisplayName,
  resolveXdmNameConfig,
  sanitizeFriendlyName,
} from "./xdm-name-utils.js";
import {
  GEOZONE_GROUP_ROLE_LIST,
  ITINERARY_GEOZONE_GROUPS,
  buildItineraryGroupScopeKey,
} from "./xdm-geozone-group-roles.js";

const HASH_VERSION = "v1";

function sanitizeName(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed) return "";
  return trimmed.replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function shouldAddItinerarySuffix({ clientId, itineraryId, itineraryName }) {
  if (!clientId || !itineraryName) return false;
  const normalizedName = sanitizeFriendlyName(itineraryName).toLowerCase();
  if (!normalizedName) return false;
  const duplicates = listItineraries({ clientId }).filter((item) => {
    if (!item?.name) return false;
    if (String(item.id) === String(itineraryId)) return false;
    return sanitizeFriendlyName(item.name).toLowerCase() === normalizedName;
  });
  return duplicates.length > 0;
}

function buildGroupName({
  clientId,
  clientDisplayName,
  itineraryId,
  itineraryName,
  withSuffix = false,
  groupLabel = null,
}) {
  const { friendlyNamesEnabled, maxNameLength } = resolveXdmNameConfig();
  if (friendlyNamesEnabled) {
    const resolvedClient = resolveClientDisplayName({ clientDisplayName, clientId });
    const fallbackItinerary =
      itineraryId != null ? `Itinerário ${String(itineraryId).slice(0, 8)}` : "Itinerário";
    const resolvedItinerary = sanitizeFriendlyName(itineraryName) || fallbackItinerary;
    const suffixToken = withSuffix ? buildShortIdSuffix(itineraryId) : "";
    const groupSuffix = [groupLabel, suffixToken].filter(Boolean).join(" ").trim();
    const friendly = buildFriendlyNameWithSuffix([resolvedClient, resolvedItinerary], {
      maxLen: maxNameLength,
      suffix: groupSuffix,
    });
    if (friendly) return friendly;
  }
  const safeClient = sanitizeName(clientId) || "CLIENT";
  const safeItineraryId = sanitizeName(itineraryId) || "ITINERARY";
  const safeItinerary = sanitizeName(itineraryName) || "ITINERARIO";
  const suffix = withSuffix ? buildShortIdSuffix(itineraryId) : "";
  const safeLabel = sanitizeName(groupLabel) || "GROUP";
  return `EUROONE_${safeClient}_${safeItineraryId}_GROUP_${safeItinerary}_${safeLabel}${suffix ? `_${suffix}` : ""}`;
}

function buildScopedGroupName({ clientId, clientDisplayName, scopeId }) {
  const { friendlyNamesEnabled, maxNameLength } = resolveXdmNameConfig();
  if (friendlyNamesEnabled) {
    const resolvedClient = resolveClientDisplayName({ clientDisplayName, clientId });
    const resolvedScope = sanitizeFriendlyName(scopeId) || "Geozone Group";
    const friendly = buildFriendlyName([resolvedClient, resolvedScope], { maxLen: maxNameLength });
    if (friendly) return friendly;
  }
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

function notesContainValue(notes, key, value) {
  if (!notes || value == null) return false;
  const escaped = String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`${key}\\s*=\\s*${escaped}\\b`, "i");
  return regex.test(String(notes));
}

function normalizeNameValue(name) {
  return String(name || "").trim().toLowerCase();
}

function resolveGeofenceConfig(geofence) {
  const metadata =
    geofence?.geometryJson?.metadata ||
    geofence?.geometryJson?.meta ||
    geofence?.geometryJson?.metadata ||
    geofence?.metadata ||
    geofence?.attributes ||
    {};
  const raw = metadata?.config ?? metadata?.configuration ?? metadata?.entryExit ?? metadata?.trigger ?? null;
  const normalized = String(raw || "").trim().toLowerCase();
  if (!normalized) return null;
  if (["entrada", "entry", "enter", "in"].includes(normalized)) return "entry";
  if (["saida", "saída", "exit", "out"].includes(normalized)) return "exit";
  return null;
}

function resolveItemGroupKey({ item, geofenceRecord }) {
  if (!item) return ITINERARY_GEOZONE_GROUPS.itinerary.key;
  if (item.type === "route") return ITINERARY_GEOZONE_GROUPS.itinerary.key;
  if (item.type === "target") return ITINERARY_GEOZONE_GROUPS.targets.key;
  if (item.type === "geofence") {
    const config = resolveGeofenceConfig(geofenceRecord);
    if (config === "entry") return ITINERARY_GEOZONE_GROUPS.entry.key;
  }
  return ITINERARY_GEOZONE_GROUPS.itinerary.key;
}

export function selectGeozoneGroupMatch({ results = [], name, itineraryId, clientId } = {}) {
  const normalizedName = normalizeNameValue(name);
  const matches = results.filter((item) => normalizeNameValue(item?.name) === normalizedName);
  if (!matches.length) return null;
  if (matches.length === 1) return matches[0];

  let scopedMatches = matches;
  if (itineraryId) {
    const byItinerary = matches.filter((item) => notesContainValue(item?.notes, "itineraryId", itineraryId));
    if (byItinerary.length) {
      scopedMatches = byItinerary;
    }
  }

  if (clientId) {
    const byClient = scopedMatches.filter((item) => notesContainValue(item?.notes, "clientId", clientId));
    if (byClient.length) {
      return byClient[0];
    }
  }

  return scopedMatches[0];
}

async function findGeozoneGroupByName({ name, itineraryId, clientId, correlationId, xdmClient }) {
  if (!name) return null;
  const encodedName = encodeURIComponent(name);
  const response = await xdmClient.request(
    "GET",
    `/api/external/v1/geozonegroups/filter?Name=${encodedName}&FirstRecord=0&ItemsPerPage=25`,
    null,
    { correlationId },
  );

  const results = Array.isArray(response?.results) ? response.results : Array.isArray(response) ? response : [];
  const match = selectGeozoneGroupMatch({ results, name, itineraryId, clientId });
  if (match && results.length > 1 && (itineraryId || clientId)) {
    const itineraryMatch = itineraryId ? notesContainValue(match?.notes, "itineraryId", itineraryId) : true;
    const clientMatch = clientId ? notesContainValue(match?.notes, "clientId", clientId) : true;
    if (!itineraryMatch || !clientMatch) {
      console.warn("[xdm] fallback ao primeiro geozone group com mesmo nome", {
        correlationId,
        name,
        itineraryId,
        clientId,
        selectedId: match?.id,
        total: results.length,
      });
    }
  }
  if (!match?.id) return null;
  return normalizeXdmId(match.id, { context: "discover geozonegroup" });
}

async function resolveGeozoneGroupId({
  created,
  groupName,
  itineraryId,
  clientId,
  correlationId,
  xdmClient,
  payloadSample,
} = {}) {
  try {
    return normalizeGeozoneGroupIdResponse(created, { context: "create geozonegroup" });
  } catch (error) {
    try {
      const discovered = await findGeozoneGroupByName({
        name: groupName,
        itineraryId,
        clientId,
        correlationId,
        xdmClient,
      });
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

function initGroupBuckets() {
  return GEOZONE_GROUP_ROLE_LIST.reduce((acc, role) => {
    acc[role.key] = {
      role,
      xdmGeozoneIds: [],
      geofenceEntries: [],
      geofenceRecords: [],
      routeRecords: [],
      itemMappings: [],
    };
    return acc;
  }, {});
}

async function syncGroupFromBucket({
  itinerary,
  bucket,
  clientDisplayName,
  correlationId,
  allowEmpty = false,
}) {
  if (!bucket || (!bucket.geofenceEntries.length && !allowEmpty)) {
    return { xdmGeozoneGroupId: null, groupHash: null, groupName: null, warnings: [] };
  }

  const groupHash = buildGroupHash(bucket.geofenceEntries);
  const itineraryName = itinerary.name || `Itinerário ${itinerary.id}`;
  const withSuffix = shouldAddItinerarySuffix({
    clientId: itinerary.clientId,
    itineraryId: itinerary.id,
    itineraryName,
  });
  const groupName = buildGroupName({
    clientId: itinerary.clientId,
    clientDisplayName,
    itineraryId: itinerary.id,
    itineraryName,
    withSuffix,
    groupLabel: bucket.role.label,
  });
  const scopeKey = buildItineraryGroupScopeKey(itinerary.id, bucket.role.key);
  const scopeMapping = getGeozoneGroupMappingByScope({ scopeKey, clientId: itinerary.clientId });
  const legacyMapping =
    bucket.role.key === ITINERARY_GEOZONE_GROUPS.itinerary.key
      ? getGeozoneGroupMapping({ itineraryId: itinerary.id, clientId: itinerary.clientId })
      : null;
  const mapping = legacyMapping || scopeMapping;
  let mappedId = null;
  if (mapping?.xdmGeozoneGroupId != null) {
    mappedId = normalizeXdmId(mapping.xdmGeozoneGroupId, { context: "mapping geozonegroup" });
    if (mappedId !== mapping.xdmGeozoneGroupId) {
      if (legacyMapping) {
        upsertGeozoneGroupMapping({
          itineraryId: itinerary.id,
          clientId: itinerary.clientId,
          groupHash: mapping.groupHash,
          xdmGeozoneGroupId: mappedId,
          groupName: mapping.groupName || groupName,
        });
      }
      upsertGeozoneGroupMappingByScope({
        scopeKey,
        clientId: itinerary.clientId,
        groupHash: mapping.groupHash,
        xdmGeozoneGroupId: mappedId,
        groupName: mapping.groupName || groupName,
      });
    }
  }
  if (mappedId && mapping.groupHash === groupHash) {
    if (mapping.groupName !== groupName) {
      const xdmClient = new XdmClient();
      const dealerId = getDealerId();
      const notes = `itineraryId=${itinerary.id}, clientId=${itinerary.clientId}, hash=${groupHash}, scope=${bucket.role.key}`;
      try {
        await xdmClient.request(
          "PUT",
          `/api/external/v1/geozonegroups/${mappedId}`,
          {
            id: Number(mappedId),
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
          step: "renameGroup",
          correlationId,
          payloadSample: {
            itineraryId: itinerary.id,
            clientId: itinerary.clientId,
            groupName,
            xdmGeozoneGroupId: mappedId,
            scope: bucket.role.key,
          },
        });
      }
      if (legacyMapping) {
        upsertGeozoneGroupMapping({
          itineraryId: itinerary.id,
          clientId: itinerary.clientId,
          groupHash,
          xdmGeozoneGroupId: mappedId,
          groupName,
        });
      }
      upsertGeozoneGroupMappingByScope({
        scopeKey,
        clientId: itinerary.clientId,
        groupHash,
        xdmGeozoneGroupId: mappedId,
        groupName,
      });
    }
    return { xdmGeozoneGroupId: mappedId, groupHash, groupName };
  }

  const xdmClient = new XdmClient();
  const dealerId = getDealerId();
  const notes = `itineraryId=${itinerary.id}, clientId=${itinerary.clientId}, hash=${groupHash}, scope=${bucket.role.key}`;

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
        payloadSample: { itineraryId: itinerary.id, clientId: itinerary.clientId, groupName, scope: bucket.role.key },
      });
    }
    xdmGeozoneGroupId = await resolveGeozoneGroupId({
      created,
      groupName,
      itineraryId: itinerary.id,
      clientId: itinerary.clientId,
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
  const desiredIds = Array.from(new Set(bucket.xdmGeozoneIds.map((id) => Number(id))));

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
            geofences: bucket.geofenceRecords,
            routes: bucket.routeRecords,
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

  if (bucket.role.key === ITINERARY_GEOZONE_GROUPS.itinerary.key) {
    upsertGeozoneGroupMapping({
      itineraryId: itinerary.id,
      clientId: itinerary.clientId,
      groupHash,
      xdmGeozoneGroupId,
      groupName,
    });
    persistItineraryGroupId({ itineraryId: itinerary.id, xdmGeozoneGroupId });
  }

  upsertGeozoneGroupMappingByScope({
    scopeKey,
    clientId: itinerary.clientId,
    groupHash,
    xdmGeozoneGroupId,
    groupName,
  });

  if (Array.isArray(importedGeozoneIds) && importedGeozoneIds.length) {
    updateItinerary(itinerary.id, {
      xdmGeozoneIds: importedGeozoneIds,
    });
  }

  return {
    xdmGeozoneGroupId,
    groupHash,
    groupName,
    warnings,
    importedGeozoneIds,
  };
}

export async function syncGeozoneGroup(
  itineraryId,
  { clientId, clientDisplayName = null, correlationId, geofencesById, forceEmptyGroups = false } = {},
) {
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

  const buckets = initGroupBuckets();
  const itemMappings = [];

  for (const item of selectedItems) {
    if (item.type === "route") {
      const routeRecord = await getRouteById(item.id);
      if (routeRecord) {
        buckets[ITINERARY_GEOZONE_GROUPS.itinerary.key].routeRecords.push(routeRecord);
      }
      const routeResult = await syncRouteGeozone(item.id, {
        clientId: itinerary.clientId,
        correlationId,
        clientDisplayName,
      });
      const routeGeozoneIds = routeResult.xdmGeozoneIds?.length
        ? routeResult.xdmGeozoneIds
        : routeResult.xdmGeozoneId
          ? [routeResult.xdmGeozoneId]
          : [];
      const bucket = buckets[ITINERARY_GEOZONE_GROUPS.itinerary.key];
      bucket.xdmGeozoneIds.push(...routeGeozoneIds);
      bucket.geofenceEntries.push({
        type: item.type,
        geometryHash: routeResult.geometryHash,
      });
      bucket.itemMappings.push({
        type: item.type,
        id: item.id,
        xdmGeozoneId: routeResult.xdmGeozoneId || routeGeozoneIds[0] || null,
      });
      itemMappings.push({
        type: item.type,
        id: item.id,
        xdmGeozoneId: routeResult.xdmGeozoneId || routeGeozoneIds[0] || null,
      });
      continue;
    }

    const geofenceId = item.id;
    const geofenceOverride = geofencesById ? geofencesById.get(String(geofenceId)) : null;
    const geofenceRecord = geofenceOverride || (await getGeofenceById(geofenceId));
    if (!geofenceRecord) {
      throw new Error("Geofence não encontrada para o itinerário");
    }

    const groupKey = resolveItemGroupKey({ item, geofenceRecord });
    const bucket = buckets[groupKey];
    bucket.geofenceRecords.push(geofenceRecord);

    const xdmGeofenceId = await syncGeofence(geofenceId, {
      clientId: itinerary.clientId,
      clientDisplayName,
      correlationId,
      geofence: geofenceRecord,
      itineraryId: itinerary.id,
      itineraryName: itinerary.name,
    });
    bucket.xdmGeozoneIds.push(xdmGeofenceId);

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

    bucket.geofenceEntries.push({
      type: item.type,
      geometryHash,
    });
    bucket.itemMappings.push({
      type: item.type,
      id: geofenceId,
      xdmGeozoneId: xdmGeofenceId,
    });
    itemMappings.push({
      type: item.type,
      id: geofenceId,
      xdmGeozoneId: xdmGeofenceId,
    });
  }

  const groupResults = {};
  const warnings = [];
  for (const role of GEOZONE_GROUP_ROLE_LIST) {
    const bucket = buckets[role.key];
    if (!bucket.geofenceEntries.length && !forceEmptyGroups) {
      groupResults[role.key] = null;
      continue;
    }
    const result = await syncGroupFromBucket({
      itinerary,
      bucket,
      clientDisplayName,
      correlationId,
      allowEmpty: forceEmptyGroups,
    });
    groupResults[role.key] = result;
    if (Array.isArray(result?.warnings) && result.warnings.length) {
      warnings.push(...result.warnings);
    }
  }

  const itineraryGroup = groupResults[ITINERARY_GEOZONE_GROUPS.itinerary.key] || null;
  const groupIds = {
    itinerary: itineraryGroup?.xdmGeozoneGroupId || null,
    targets: groupResults[ITINERARY_GEOZONE_GROUPS.targets.key]?.xdmGeozoneGroupId || null,
    entry: groupResults[ITINERARY_GEOZONE_GROUPS.entry.key]?.xdmGeozoneGroupId || null,
  };
  const groupHashes = {
    itinerary: itineraryGroup?.groupHash || null,
    targets: groupResults[ITINERARY_GEOZONE_GROUPS.targets.key]?.groupHash || null,
    entry: groupResults[ITINERARY_GEOZONE_GROUPS.entry.key]?.groupHash || null,
  };

  return {
    xdmGeozoneGroupId: itineraryGroup?.xdmGeozoneGroupId || null,
    groupHash: itineraryGroup?.groupHash || null,
    groupName: itineraryGroup?.groupName || null,
    xdmGeozoneIds: itineraryGroup?.importedGeozoneIds || null,
    groupIds,
    groupHashes,
    groupResults,
    itemMappings,
    warnings,
  };
}

export async function syncGeozoneGroupForGeofences({
  clientId,
  clientDisplayName = null,
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
      clientDisplayName,
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
  const resolvedName =
    groupName || buildScopedGroupName({ clientId, clientDisplayName, scopeId: resolvedScopeId });

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
    if (mapping.groupName !== resolvedName) {
      const xdmClient = new XdmClient();
      const dealerId = getDealerId();
      const notes = `scope=${resolvedScopeId}, clientId=${clientId}, hash=${groupHash}`;
      try {
        await xdmClient.request(
          "PUT",
          `/api/external/v1/geozonegroups/${mappedId}`,
          {
            id: Number(mappedId),
            name: resolvedName,
            dealerId,
            notes,
          },
          { correlationId },
        );
      } catch (error) {
        throw wrapXdmError(error, {
          step: "renameGroup",
          correlationId,
          payloadSample: { scopeKey: mappingKey, clientId, groupName: resolvedName, xdmGeozoneGroupId: mappedId },
        });
      }
      upsertGeozoneGroupMappingByScope({
        scopeKey: mappingKey,
        clientId,
        groupHash,
        xdmGeozoneGroupId: mappedId,
        groupName: resolvedName,
      });
    }
    return { xdmGeozoneGroupId: mappedId, groupHash, groupName: resolvedName };
  }

  const xdmClient = new XdmClient();
  const dealerId = getDealerId();
  const notes = `scope=${resolvedScopeId}, clientId=${clientId}, hash=${groupHash}`;

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
      clientId,
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

export async function ensureGeozoneGroups(
  itineraryId,
  { clientId, clientDisplayName = null, correlationId, geofencesById, forceEmptyGroups = false } = {},
) {
  const itinerary = getItineraryById(itineraryId);
  if (!itinerary) {
    throw new Error("Itinerário não encontrado");
  }
  if (clientId && String(itinerary.clientId) !== String(clientId)) {
    throw new Error("Itinerário não pertence ao cliente");
  }

  const storedIds = itinerary.xdmGeozoneGroupIds || {};
  const legacyMapping = getGeozoneGroupMapping({ itineraryId, clientId: itinerary.clientId });
  const itineraryGroupId =
    storedIds.itinerary ??
    itinerary.xdmGeozoneGroupId ??
    legacyMapping?.xdmGeozoneGroupId ??
    null;
  const targetsMapping = getGeozoneGroupMappingByScope({
    scopeKey: buildItineraryGroupScopeKey(itinerary.id, ITINERARY_GEOZONE_GROUPS.targets.key),
    clientId: itinerary.clientId,
  });
  const entryMapping = getGeozoneGroupMappingByScope({
    scopeKey: buildItineraryGroupScopeKey(itinerary.id, ITINERARY_GEOZONE_GROUPS.entry.key),
    clientId: itinerary.clientId,
  });

  const items = Array.isArray(itinerary.items) ? itinerary.items : [];
  const targetItems = items.filter((item) => item.type === "target");
  const routeItems = items.filter((item) => item.type === "route");
  const geofenceItems = items.filter((item) => item.type === "geofence");

  let entryCount = 0;
  let itineraryGeofenceCount = 0;
  for (const item of geofenceItems) {
    const geofenceId = item.id;
    const geofenceOverride = geofencesById ? geofencesById.get(String(geofenceId)) : null;
    const geofenceRecord = geofenceOverride || (await getGeofenceById(geofenceId));
    if (!geofenceRecord) continue;
    const config = resolveGeofenceConfig(geofenceRecord);
    if (config === "entry") {
      entryCount += 1;
    } else {
      itineraryGeofenceCount += 1;
    }
  }

  const needsItineraryGroup = forceEmptyGroups || Boolean(routeItems.length || itineraryGeofenceCount);
  const needsTargetsGroup = forceEmptyGroups || Boolean(targetItems.length);
  const needsEntryGroup = forceEmptyGroups || Boolean(entryCount);

  const groupIds = {
    itinerary: itineraryGroupId != null ? normalizeXdmId(itineraryGroupId, { context: "itinerary geozonegroup" }) : null,
    targets:
      storedIds.targets ??
      (targetsMapping?.xdmGeozoneGroupId != null
        ? normalizeXdmId(targetsMapping.xdmGeozoneGroupId, { context: "targets geozonegroup" })
        : null),
    entry:
      storedIds.entry ??
      (entryMapping?.xdmGeozoneGroupId != null
        ? normalizeXdmId(entryMapping.xdmGeozoneGroupId, { context: "entry geozonegroup" })
        : null),
  };

  const groupHashes = {
    itinerary: legacyMapping?.groupHash || null,
    targets: targetsMapping?.groupHash || null,
    entry: entryMapping?.groupHash || null,
  };

  const needsSync =
    (needsItineraryGroup && !groupIds.itinerary) ||
    (needsTargetsGroup && !groupIds.targets) ||
    (needsEntryGroup && !groupIds.entry);

  if (!needsSync) {
    if (groupIds.itinerary) {
      persistItineraryGroupId({ itineraryId: itinerary.id, xdmGeozoneGroupId: groupIds.itinerary });
    }
    return {
      xdmGeozoneGroupId: groupIds.itinerary,
      groupHash: groupHashes.itinerary,
      groupIds,
      groupHashes,
    };
  }

  return syncGeozoneGroup(itinerary.id, {
    clientId: itinerary.clientId,
    clientDisplayName,
    correlationId,
    geofencesById,
    forceEmptyGroups,
  });
}

export async function ensureGeozoneGroup(
  itineraryId,
  { clientId, clientDisplayName = null, correlationId, geofencesById } = {},
) {
  const resolved = await ensureGeozoneGroups(itineraryId, {
    clientId,
    clientDisplayName,
    correlationId,
    geofencesById,
  });
  return {
    xdmGeozoneGroupId: resolved.xdmGeozoneGroupId,
    groupHash: resolved.groupHash || null,
    groupIds: resolved.groupIds,
    groupHashes: resolved.groupHashes,
  };
}

export default {
  syncGeozoneGroup,
  syncGeozoneGroupForGeofences,
  ensureGeozoneGroup,
  ensureGeozoneGroups,
};
