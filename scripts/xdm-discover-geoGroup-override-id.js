import { loadEnv } from "../server/utils/env.js";
import XdmClient from "../server/services/xdm/xdm-client.js";
import { normalizeXdmDeviceUid } from "../server/services/xdm/xdm-utils.js";

const KEYWORDS = ["geo", "zone", "group", "geogroup", "geozone"];
const ID_FIELDS = ["overrideId", "geozoneGroupId", "geoGroupId", "groupId", "id", "key"];
const NAME_FIELDS = ["name", "label", "title", "description", "key"];
const MAX_CANDIDATES = 50;
const MAX_DEPTH = 6;

function includesKeyword(value) {
  if (!value) return false;
  const text = String(value).toLowerCase();
  return KEYWORDS.some((keyword) => text.includes(keyword));
}

function describeValue(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.length > 120 ? `${value.slice(0, 120)}…` : value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    const text = JSON.stringify(value);
    return text.length > 120 ? `${text.slice(0, 120)}…` : text;
  } catch (_error) {
    return String(value);
  }
}

function findFirstField(obj, fields) {
  for (const field of fields) {
    if (Object.prototype.hasOwnProperty.call(obj, field)) {
      return { field, value: obj[field] };
    }
  }
  return null;
}

function resolveCandidateId(obj) {
  const entry = findFirstField(obj, ID_FIELDS);
  if (!entry) return null;
  const value = entry.value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) return value.trim();
  return null;
}

function resolveCandidateName(obj) {
  const entry = findFirstField(obj, NAME_FIELDS);
  if (!entry) return null;
  const value = entry.value;
  if (typeof value === "string" && value.trim()) return value.trim();
  return null;
}

function scanNode(node, path, depth, results, matchingPaths) {
  if (depth > MAX_DEPTH || node === null || node === undefined) return;

  if (typeof node === "string") {
    if (includesKeyword(node)) {
      matchingPaths.add(path);
    }
    return;
  }

  if (typeof node !== "object") {
    return;
  }

  if (Array.isArray(node)) {
    node.forEach((item, index) => {
      scanNode(item, `${path}[${index}]`, depth + 1, results, matchingPaths);
    });
    return;
  }

  const keys = Object.keys(node);
  const keyMatches = keys.filter((key) => includesKeyword(key));
  const valueMatches = keys
    .filter((key) => typeof node[key] === "string" && includesKeyword(node[key]))
    .map((key) => ({ key, value: node[key] }));

  if ((keyMatches.length || valueMatches.length) && results.length < MAX_CANDIDATES) {
    const candidateId = resolveCandidateId(node);
    const candidateName = resolveCandidateName(node);
    const sample =
      valueMatches.length > 0
        ? `${valueMatches[0].key}=${describeValue(valueMatches[0].value)}`
        : keyMatches.length > 0
          ? `${keyMatches[0]}=${describeValue(node[keyMatches[0]])}`
          : "";
    results.push({
      candidateId,
      candidateName,
      path,
      sampleValue: sample,
    });
  }

  if (keyMatches.length || valueMatches.length) {
    matchingPaths.add(path);
  }

  keys.forEach((key) => {
    scanNode(node[key], `${path}.${key}`, depth + 1, results, matchingPaths);
  });
}

async function fetchDetails(xdmClient, imei) {
  const path = `/api/external/v1/devicesSdk/${encodeURIComponent(imei)}/details`;
  return xdmClient.request("GET", path, null, { correlationId: `xdm-override-discovery-${imei}` });
}

async function fetchOverrides(xdmClient, deviceUid) {
  const path = `/api/external/v3/settingsOverrides/${encodeURIComponent(deviceUid)}`;
  return xdmClient.request("GET", path, null, { correlationId: `xdm-override-overrides-${deviceUid}` });
}

function summarizeOverrides(payload) {
  if (!payload || typeof payload !== "object") return null;
  const overrides = payload.overrides || payload?.data?.overrides || null;
  if (!overrides || typeof overrides !== "object") return null;
  const entries = Object.entries(overrides).map(([key, value]) => ({
    overrideKey: key,
    value: describeValue(value),
  }));
  return entries.length ? entries : null;
}

function resolveDeviceUidCandidate(details, fallbackImei) {
  try {
    const normalized = normalizeXdmDeviceUid(details, {
      context: "discover override deviceUid",
      fieldCandidates: ["deviceUid", "uid", "imei", "deviceImei", "uniqueId", "id"],
    });
    return normalized || fallbackImei;
  } catch (_error) {
    return fallbackImei;
  }
}

await loadEnv();

const imei = process.argv[2];
if (!imei) {
  console.error("Uso: node scripts/xdm-discover-geoGroup-override-id.js <IMEI>");
  process.exit(1);
}

const xdmClient = new XdmClient();

let details = null;
try {
  details = await fetchDetails(xdmClient, imei);
  console.log("[xdm-discover] device details ok", { imei, hasDetails: Boolean(details) });
} catch (error) {
  console.error("[xdm-discover] falha ao buscar detalhes do dispositivo", {
    imei,
    message: error?.message || error,
  });
}

const candidates = [];
const matchingPaths = new Set();
if (details) {
  scanNode(details, "$", 0, candidates, matchingPaths);
}

if (candidates.length) {
  console.log("[xdm-discover] candidatos encontrados");
  console.table(candidates);
} else if (matchingPaths.size) {
  console.warn("[xdm-discover] nenhum candidato com id encontrado; paths com termos geo/zone/group:");
  console.log(Array.from(matchingPaths).slice(0, 25).join("\n"));
} else {
  console.warn("[xdm-discover] nenhum termo relacionado a geo/zone/group encontrado.");
}

const deviceUid = resolveDeviceUidCandidate(details, imei);
try {
  const overridesPayload = await fetchOverrides(xdmClient, deviceUid);
  const overrides = summarizeOverrides(overridesPayload);
  if (overrides) {
    console.log("[xdm-discover] overrides atuais em settingsOverrides:");
    console.table(overrides);
  } else {
    console.warn("[xdm-discover] settingsOverrides retornou vazio ou sem overrides.");
  }
} catch (error) {
  console.warn("[xdm-discover] não foi possível obter settingsOverrides", {
    deviceUid,
    message: error?.message || error,
  });
}

if (!candidates.length) {
  console.log("[xdm-discover] fallback:");
  console.log("- Verifique no XDM (UI) a lista de overrides disponíveis e anote o ID numérico.");
  console.log("- Use o ID encontrado para configurar XDM_GEOZONE_GROUP_OVERRIDE_ID.");
  if (matchingPaths.size) {
    console.log("[xdm-discover] caminhos relevantes:");
    console.log(Array.from(matchingPaths).slice(0, 10).join("\n"));
  }
}
