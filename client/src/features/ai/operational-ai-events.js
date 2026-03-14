export const OPERATIONAL_AI_OPEN_EVENT = "euro-one:open-operational-ai";

export function dispatchOperationalAiOpen(detail = {}) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(OPERATIONAL_AI_OPEN_EVENT, { detail }));
}

