import { formatAddress } from "../lib/format-address.js";

const coalesce = (...values) => {
  for (const value of values) {
    if (value === null || value === undefined) continue;
    if (typeof value === "string" && value.trim() === "") continue;
    return value;
  }
  return null;
};

export function formatGeocodeAddress(raw) {
  if (!raw) return "";
  if (typeof raw === "string") {
    const formatted = formatAddress(raw);
    return formatted === "—" ? "" : formatted;
  }
  if (typeof raw !== "object") return "";

  const candidate = coalesce(
    raw.shortAddress,
    raw.formattedAddress,
    raw.formatted_address,
    raw.display_name,
    raw.label,
    raw.address,
  );

  if (typeof candidate === "string") {
    const formatted = formatAddress(candidate);
    return formatted === "—" ? "" : formatted;
  }
  if (candidate && typeof candidate === "object") {
    const formatted = formatAddress(candidate);
    return formatted === "—" ? "" : formatted;
  }

  const formatted = formatAddress(raw);
  return formatted === "—" ? "" : formatted;
}

export default formatGeocodeAddress;
