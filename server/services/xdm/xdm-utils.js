const DEFAULT_FIELD_CANDIDATES = ["id", "geozoneGroupId", "geozoneId"];
const GEOFENCE_GROUP_FIELD_CANDIDATES = [...DEFAULT_FIELD_CANDIDATES, "created"];
const DEVICE_UID_FIELD_CANDIDATES = ["deviceUid", "uid", "imei", "deviceImei", "id"];
const MAX_DEPTH = 6;
function describeType(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function describeKeys(value) {
  if (!value || typeof value !== "object") {
    return "n/a";
  }
  return Object.keys(value).join(",");
}

function isNumericString(value) {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (!trimmed) return false;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed);
}

function describeContext(context) {
  return context ? ` (${context})` : "";
}

export function normalizeXdmId(
  value,
  { fieldCandidates = DEFAULT_FIELD_CANDIDATES, context = "" } = {},
) {
  const seen = new Set();

  const resolve = (input, depth) => {
    if (depth > MAX_DEPTH) {
      throw new Error(
        `XDM id inválido (${context || "sem contexto"}): esperado number/string, recebido ${describeType(
          input,
        )} com keys=${describeKeys(input)}`,
      );
    }

    if (typeof input === "number" && Number.isFinite(input)) {
      return input;
    }

    if (isNumericString(input)) {
      return Number(input.trim());
    }

    if (Array.isArray(input)) {
      if (input.length === 1) {
        return resolve(input[0], depth + 1);
      }
    }

    if (input && typeof input === "object") {
      if (seen.has(input)) {
        throw new Error(
          `XDM id inválido (${context || "sem contexto"}): esperado number/string, recebido ${describeType(
            input,
          )} com keys=${describeKeys(input)}`,
        );
      }
      seen.add(input);

      if (Object.prototype.hasOwnProperty.call(input, "data")) {
        return resolve(input.data, depth + 1);
      }
      if (Object.prototype.hasOwnProperty.call(input, "body")) {
        return resolve(input.body, depth + 1);
      }

      for (const field of fieldCandidates) {
        if (Object.prototype.hasOwnProperty.call(input, field)) {
          return resolve(input[field], depth + 1);
        }
      }
    }

    throw new Error(
      `XDM id inválido (${context || "sem contexto"}): esperado number/string, recebido ${describeType(
        input,
      )} com keys=${describeKeys(input)}`,
    );
  };

  return resolve(value, 0);
}

export function normalizeGeozoneGroupIdResponse(value, { context = "" } = {}) {
  return normalizeXdmId(value, {
    context: context || "create geozonegroup",
    fieldCandidates: GEOFENCE_GROUP_FIELD_CANDIDATES,
  });
}

export function normalizeXdmDeviceUid(
  value,
  { fieldCandidates = DEVICE_UID_FIELD_CANDIDATES, context = "" } = {},
) {
  const seen = new Set();

  const resolve = (input, depth) => {
    if (depth > MAX_DEPTH) {
      throw new Error(
        `XDM deviceUid inválido${describeContext(context)}: esperado string/number, recebido ${describeType(
          input,
        )} com keys=${describeKeys(input)}`,
      );
    }

    if (typeof input === "string") {
      const trimmed = input.trim();
      if (trimmed) return trimmed;
    }

    if (typeof input === "number" && Number.isFinite(input)) {
      return String(input);
    }

    if (Array.isArray(input)) {
      if (input.length === 1) {
        return resolve(input[0], depth + 1);
      }
    }

    if (input && typeof input === "object") {
      if (seen.has(input)) {
        throw new Error(
          `XDM deviceUid inválido${describeContext(context)}: esperado string/number, recebido ${describeType(
            input,
          )} com keys=${describeKeys(input)}`,
        );
      }
      seen.add(input);

      if (Object.prototype.hasOwnProperty.call(input, "data")) {
        return resolve(input.data, depth + 1);
      }
      if (Object.prototype.hasOwnProperty.call(input, "body")) {
        return resolve(input.body, depth + 1);
      }

      for (const field of fieldCandidates) {
        if (Object.prototype.hasOwnProperty.call(input, field)) {
          return resolve(input[field], depth + 1);
        }
      }
    }

    throw new Error(
      `XDM deviceUid inválido${describeContext(context)}: esperado string/number, recebido ${describeType(
        input,
      )} com keys=${describeKeys(input)}`,
    );
  };

  return resolve(value, 0);
}

export function buildSettingsOverridesModified(overrides = {}) {
  return Object.entries(overrides).map(([overrideId, value]) => ({
    userElementId: Number(overrideId),
    value,
  }));
}

export default {
  normalizeXdmId,
  normalizeGeozoneGroupIdResponse,
  normalizeXdmDeviceUid,
  buildSettingsOverridesModified,
};
