export const AI_FLOW_TYPES = {
  CHAT: "chat",
  SUMMARIZE_EVENT: "summarize-event",
  INVESTIGATE_VEHICLE: "investigate-vehicle",
  PRIORITIZE_ALERT: "prioritize-alert",
  LEARNING_QUESTIONS: "learning-questions",
};

export function normalizeFlowType(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (Object.values(AI_FLOW_TYPES).includes(normalized)) {
    return normalized;
  }
  return AI_FLOW_TYPES.CHAT;
}
