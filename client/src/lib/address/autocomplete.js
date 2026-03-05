import { formatSearchAddress } from "../format-address.js";

const MAX_JSON_PREVIEW = 160;

function safeStringify(value) {
  if (value === null || value === undefined) return "";
  try {
    const json = JSON.stringify(value);
    if (!json) return "";
    if (json === "{}" || json === "[]") return json;
    return json.length > MAX_JSON_PREVIEW ? `${json.slice(0, MAX_JSON_PREVIEW)}…` : json;
  } catch (_error) {
    return "";
  }
}

function pickString(value, fallback = "") {
  if (value === null || value === undefined) return fallback;
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return fallback;
}

function extractAddressParts(input) {
  if (!input || typeof input !== "object") return null;
  const raw = input.raw && typeof input.raw === "object" ? input.raw : null;
  const candidates = [
    input.addressParts,
    input.address_parts,
    input.parts,
    input.address,
    raw?.addressParts,
    raw?.address_parts,
    raw?.parts,
    raw?.address,
  ];
  const match = candidates.find((value) => value && typeof value === "object" && !Array.isArray(value));
  return match || null;
}

function normalizeNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : undefined;
}

export function formatSuggestion(value, fallback = "") {
  if (value === null || value === undefined) return fallback;
  if (typeof value === "string" || typeof value === "number") return String(value);

  if (typeof value === "object") {
    if (typeof value.formattedAddress === "string") {
      const trimmed = value.formattedAddress.trim();
      if (trimmed) return trimmed;
      return fallback;
    }
    if (typeof value.formatted_address === "string") {
      const trimmed = value.formatted_address.trim();
      if (trimmed) return trimmed;
      return fallback;
    }
    if (typeof value.display_name === "string") {
      const trimmed = value.display_name.trim();
      if (trimmed) return trimmed;
      return fallback;
    }
    if (typeof value.description === "string") {
      const trimmed = value.description.trim();
      if (trimmed) return trimmed;
      return fallback;
    }
    if (typeof value.label === "string") {
      const trimmed = value.label.trim();
      if (trimmed) return trimmed;
      return fallback;
    }
    if (typeof value.concise === "string") {
      const trimmed = value.concise.trim();
      if (trimmed) return trimmed;
      return fallback;
    }
    if (typeof value.address === "string") {
      const trimmed = value.address.trim();
      if (trimmed) return trimmed;
      return fallback;
    }

    const candidate = value.address && typeof value.address === "object" ? value.address : value;
    const formatted = formatSearchAddress(candidate);
    if (formatted && formatted !== "—") return formatted;

    const json = safeStringify(value);
    if (json) return json;
  }

  return pickString(value, fallback) || fallback;
}

export function toAddressValue(input) {
  if (input === null || input === undefined) return { formattedAddress: "" };
  if (typeof input === "string" || typeof input === "number") {
    const formattedAddress = String(input).trim();
    return { formattedAddress };
  }

  if (typeof input !== "object") {
    return { formattedAddress: String(input) };
  }

  if (typeof input.formattedAddress === "string") {
    return { ...input };
  }

  const parts = extractAddressParts(input) || {};
  const raw = input.raw && typeof input.raw === "object" ? input.raw : null;

  const formattedAddress = formatSuggestion(input, "");
  const lat = normalizeNumber(input.lat ?? input.latitude ?? raw?.lat ?? raw?.latitude);
  const lng = normalizeNumber(input.lng ?? input.lon ?? input.longitude ?? raw?.lon ?? raw?.lng ?? raw?.longitude);

  const placeId =
    pickString(input.placeId) ||
    pickString(input.place_id) ||
    pickString(raw?.place_id) ||
    pickString(raw?.placeId) ||
    "";

  const street =
    pickString(parts.street) ||
    pickString(parts.road) ||
    pickString(parts.streetName) ||
    pickString(parts.route) ||
    pickString(parts.logradouro) ||
    pickString(parts.endereco) ||
    "";
  const number =
    pickString(parts.number) ||
    pickString(parts.house_number) ||
    pickString(parts.houseNumber) ||
    pickString(parts.numero) ||
    pickString(parts.house) ||
    "";
  const neighborhood =
    pickString(parts.neighbourhood) ||
    pickString(parts.neighborhood) ||
    pickString(parts.suburb) ||
    pickString(parts.quarter) ||
    pickString(parts.bairro) ||
    pickString(parts.district) ||
    pickString(parts.city_district) ||
    "";
  const city =
    pickString(parts.city) ||
    pickString(parts.town) ||
    pickString(parts.village) ||
    pickString(parts.municipality) ||
    pickString(parts.county) ||
    pickString(parts.cidade) ||
    "";
  const state =
    pickString(parts.state) ||
    pickString(parts.state_code) ||
    pickString(parts.stateCode) ||
    pickString(parts.region) ||
    pickString(parts.estado) ||
    pickString(parts.uf) ||
    "";
  const zip =
    pickString(parts.postcode) ||
    pickString(parts.postalCode) ||
    pickString(parts.zipcode) ||
    pickString(parts.cep) ||
    "";

  return {
    formattedAddress: formattedAddress || "",
    placeId: placeId || undefined,
    lat,
    lng,
    city: city || undefined,
    state: state || undefined,
    zip: zip || undefined,
    street: street || undefined,
    number: number || undefined,
    neighborhood: neighborhood || undefined,
    raw: raw || input,
  };
}

export default toAddressValue;
