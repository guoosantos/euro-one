const STREET_ABBREVIATIONS = [
  [/^avenida\b/i, "Av."],
  [/^av\.?\b/i, "Av."],
  [/^rua\b/i, "R."],
  [/^rodovia\b/i, "Rod."],
  [/^estrada\b/i, "Est."],
  [/^travessa\b/i, "Tv."],
  [/^alameda\b/i, "Al."],
  [/^largo\b/i, "Lg."],
  [/^prac[aá]\b/i, "Pc."],
];

function collapseWhitespace(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function coalesce(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return String(value).trim();
    }
  }
  return "";
}

function normalizeCep(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.length !== 8) return "";
  return `${digits.slice(0, 5)}-${digits.slice(5)}`;
}

function abbreviateStreet(value) {
  if (!value) return "";
  const cleaned = collapseWhitespace(value);
  const [first, ...rest] = cleaned.split(" ");
  const match = STREET_ABBREVIATIONS.find(([regex]) => regex.test(first));
  if (!match) return cleaned;
  const [, abbreviation] = match;
  return [abbreviation, rest.join(" ")].filter(Boolean).join(" ").trim();
}

function formatFromParts(rawParts = {}) {
  const parts = rawParts && typeof rawParts === "object" ? rawParts : {};

  const street = abbreviateStreet(
    parts.street || coalesce(parts.road, parts.streetName, parts.route, parts.logradouro, parts.endereco),
  );
  const houseNumber =
    coalesce(parts.houseNumber, parts.house_number, parts.number, parts.numero, parts.house) || (street ? "s/n" : "");
  const neighbourhood = coalesce(parts.neighbourhood, parts.suburb, parts.quarter, parts.bairro, parts.district);
  const city = coalesce(parts.city, parts.town, parts.village, parts.municipality, parts.cidade);
  const state = coalesce(parts.state, parts.region, parts.state_district, parts.stateCode, parts.uf, parts.estado);
  const postalCode = normalizeCep(coalesce(parts.postalCode, parts.postcode, parts.zipcode, parts.cep));

  const firstLine = [street, houseNumber].filter(Boolean).join(", ");
  const locality = [neighbourhood, city].filter(Boolean).join(", ");
  const region = [state, postalCode].filter(Boolean).join(" - ");
  const suffix = [locality, region].filter(Boolean).join(" - ");
  const compact = [firstLine, suffix].filter(Boolean).join(" - ");
  if (compact) return compact;

  const fallback = [street, neighbourhood, city, state, postalCode].filter(Boolean).join(", ");
  return fallback || null;
}

function normalizeInput(rawAddress) {
  if (!rawAddress) return null;
  if (typeof rawAddress === "string") {
    return { address: rawAddress };
  }
  if (typeof rawAddress === "object") {
    const parts = rawAddress.addressParts || rawAddress.parts || rawAddress.attributes?.addressParts || null;
    return {
      address:
        rawAddress.address || rawAddress.formattedAddress || rawAddress.shortAddress || rawAddress.attributes?.address || null,
      formattedAddress:
        rawAddress.formattedAddress ||
        rawAddress.formatted ||
        rawAddress.formatted_address ||
        rawAddress.attributes?.formattedAddress ||
        rawAddress.attributes?.formatted ||
        null,
      shortAddress: rawAddress.shortAddress || rawAddress.attributes?.shortAddress || null,
      parts,
    };
  }
  return null;
}

function formatAddressString(rawAddress) {
  const cleaned = collapseWhitespace(rawAddress);
  if (!cleaned) return "";

  const parts = cleaned.split(/\s+-\s+/).map((part) => part.split(",").map((p) => p.trim())).flat().filter(Boolean);
  const cep = parts.find((segment) => /\b\d{5}-?\d{3}\b/.test(segment));
  const withoutCep = parts.filter((segment) => segment !== cep);
  const normalizedCep = normalizeCep(cep);

  const main = withoutCep.slice(0, 2).join(", ");
  const tailParts = withoutCep.slice(2);
  let tail = tailParts.join(" - ");

  if (tailParts.length > 2) {
    if (tailParts.length === 3 && tailParts[1]?.length === 2) {
      tail = [tailParts[1], tailParts[2]].filter(Boolean).join(" - ");
    } else {
      const head = tailParts.slice(0, -1).join(", ");
      tail = [head, tailParts.at(-1)].filter(Boolean).join(" - ");
    }
  }

  const compact = [main || withoutCep[0], tail].filter(Boolean).join(" - ");
  const withCep = [compact || cleaned, normalizedCep].filter(Boolean).join(" - ");
  return collapseWhitespace(withCep || cleaned);
}

export function formatAddress(rawAddress) {
  const normalized = normalizeInput(rawAddress);
  if (!normalized) return "—";

  const preferred = formatFromParts(normalized.parts) || normalized.shortAddress || normalized.formattedAddress;
  const formatted = collapseWhitespace(preferred || formatAddressString(normalized.address || ""));
  return formatted || "—";
}

export default formatAddress;
