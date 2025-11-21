function collapseWhitespace(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

export function formatAddress(rawAddress) {
  if (!rawAddress) return "—";
  const cleaned = collapseWhitespace(rawAddress);
  if (!cleaned) return "—";

  const [beforeHyphen, ...afterHyphenParts] = cleaned.split(" - ").map((part) => part.trim()).filter(Boolean);
  const commaParts = beforeHyphen.split(",").map((part) => part.trim()).filter(Boolean);

  const main = commaParts.slice(0, 2).join(", ") || beforeHyphen;
  const suffixFromHyphen = afterHyphenParts.join(" - ");
  const tailParts = commaParts.slice(2).concat(afterHyphenParts).filter(Boolean);
  const tail = tailParts.slice(-2).join(" - ") || suffixFromHyphen;

  const compact = [main, tail].filter(Boolean).join(" - ");
  if (compact) return compact;

  const fallback = cleaned.split(",").map((part) => part.trim()).filter(Boolean);
  if (fallback.length <= 2) return fallback.join(", ");
  return `${fallback.slice(0, 2).join(", ")} - ${fallback.slice(-2).join(" - ")}`;
}

export default formatAddress;
