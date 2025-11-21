export function encodeCredentials(username, password) {
  if (!username && !password) return null;
  const raw = `${username ?? ""}:${password ?? ""}`;
  try {
    if (typeof btoa === "function") {
      return btoa(raw);
    }
  } catch (error) {
    // ignore and fallback
  }
  try {
    const nodeBuffer = globalThis?.Buffer;
    if (nodeBuffer) {
      return nodeBuffer.from(raw, "utf-8").toString("base64");
    }
  } catch (error) {
    console.warn("Failed to encode credentials", error);
  }
  return null;
}
