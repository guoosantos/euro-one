const DEFAULT_FIELD_CANDIDATES = ["id", "geozoneGroupId", "geozoneId"];
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

export default {
  normalizeXdmId,
};
