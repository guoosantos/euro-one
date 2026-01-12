const DEFAULT_FIELD_CANDIDATES = ["id", "geozoneGroupId", "geozoneId"];
const DEVICE_UID_FIELD_CANDIDATES = ["deviceUid", "uid", "imei", "deviceImei", "id"];
const MAX_DEPTH = 6;
const INT32_MIN = -2147483648;
const INT32_MAX = 2147483647;

function isInt32(value) {
  return Number.isInteger(value) && value >= INT32_MIN && value <= INT32_MAX;
}

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

function parseInt32(value) {
  if (value === null || value === undefined) {
    return { ok: false, value: null, normalized: null };
  }
  const trimmed = String(value).trim();
  if (!trimmed) {
    return { ok: false, value: null, normalized: null };
  }
  if (!/^-?\d+$/.test(trimmed)) {
    return { ok: false, value: null, normalized: null };
  }
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || !isInt32(parsed)) {
    return { ok: false, value: null, normalized: null };
  }
  return { ok: true, value: parsed, normalized: String(parsed) };
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

export function getGeozoneGroupOverrideConfig() {
  const overrideIdEnv = process.env.XDM_GEOZONE_GROUP_OVERRIDE_ID;
  const overrideKeyEnv = process.env.XDM_GEOZONE_GROUP_OVERRIDE_KEY;
  const rawValue = overrideIdEnv ?? overrideKeyEnv ?? "geoGroup";
  const source =
    overrideIdEnv != null
      ? "XDM_GEOZONE_GROUP_OVERRIDE_ID"
      : overrideKeyEnv != null
        ? "XDM_GEOZONE_GROUP_OVERRIDE_KEY"
        : "default";
  const parsed = parseInt32(rawValue);
  return {
    rawValue,
    overrideId: parsed.ok ? parsed.normalized : null,
    overrideNumber: parsed.ok ? parsed.value : null,
    source,
    isValid: parsed.ok,
  };
}

export function buildOverridesDto(overrides = {}) {
  return Object.fromEntries(
    Object.entries(overrides).map(([overrideId, value]) => [overrideId, { value }]),
  );
}

export function ensureGeozoneGroupOverrideId() {
  const config = getGeozoneGroupOverrideConfig();
  if (!config.isValid) {
    throw new Error(
      "XDM_GEOZONE_GROUP_OVERRIDE_ID deve ser um int32 (ex: 1234). Descubra com: node scripts/xdm-discover-geoGroup-override-id.js <IMEI>",
    );
  }
  return config;
}

export default {
  normalizeXdmId,
  normalizeXdmDeviceUid,
  getGeozoneGroupOverrideConfig,
  buildOverridesDto,
  ensureGeozoneGroupOverrideId,
};
