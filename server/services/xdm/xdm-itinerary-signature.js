import crypto from "node:crypto";

const SIGNATURE_INPUT_SEPARATOR = "|";
const MAX_UINT32 = 0xffffffff;
const MAX_INT32 = 0x7fffffff;

export function buildGroupHashSummary(groupHashes = {}) {
  if (!groupHashes || typeof groupHashes !== "object") return null;
  return [
    `itinerary=${groupHashes.itinerary || ""}`,
    `targets=${groupHashes.targets || ""}`,
    `entry=${groupHashes.entry || ""}`,
  ].join(SIGNATURE_INPUT_SEPARATOR);
}

export function buildItinerarySignatureInput({ itineraryId, groupHashes } = {}) {
  return [
    itineraryId ?? "",
    groupHashes?.itinerary || "",
    groupHashes?.targets || "",
    groupHashes?.entry || "",
  ].join(SIGNATURE_INPUT_SEPARATOR);
}

export function buildItinerarySignature({ itineraryId, groupHashes } = {}) {
  const payload = buildItinerarySignatureInput({ itineraryId, groupHashes });
  const digest = crypto.createHash("sha256").update(payload).digest();
  let signature = digest.readUInt32BE(0);
  if (signature === 0) {
    signature = digest.readUInt32BE(4);
  }
  if (signature === 0) {
    signature = 1;
  }
  return signature;
}

function parseOverrideId(rawValue) {
  if (rawValue == null || rawValue === "") {
    return { isValid: false, overrideId: null };
  }
  const parsed = Number(rawValue);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > MAX_INT32) {
    return { isValid: false, overrideId: null };
  }
  return { isValid: true, overrideId: String(parsed) };
}

export function resolveItinerarySignatureOverrideConfig() {
  const rawValue = process.env.XDM_ITINERARY_SIGNATURE_OVERRIDE_ID ?? null;
  const parsed = parseOverrideId(rawValue);
  const overrideKeyRaw = process.env.XDM_ITINERARY_SIGNATURE_OVERRIDE_KEY ?? null;
  const overrideKey = overrideKeyRaw && String(overrideKeyRaw).trim() ? String(overrideKeyRaw).trim() : null;

  return {
    overrideId: parsed.overrideId,
    overrideKey,
    isValid: parsed.isValid,
    isConfigured: rawValue != null && rawValue !== "",
    rawValue,
  };
}

export function isValidSignatureValue(signature) {
  return Number.isInteger(signature) && signature >= 1 && signature <= MAX_UINT32;
}

export default {
  buildGroupHashSummary,
  buildItinerarySignature,
  buildItinerarySignatureInput,
  resolveItinerarySignatureOverrideConfig,
  isValidSignatureValue,
};
