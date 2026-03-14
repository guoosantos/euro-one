export const TOOL_CATEGORIES = {
  READ: "read",
  ASSIST: "assist",
  ACTION_REQUEST: "action-request",
};

export const TOOL_CONFIRMATION_POLICY = {
  NONE: "none",
  HUMAN_CONFIRMATION_REQUIRED: "human-confirmation-required",
};

export function isActionRequestCategory(category) {
  return String(category || "") === TOOL_CATEGORIES.ACTION_REQUEST;
}

