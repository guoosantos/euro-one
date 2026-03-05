function pickFirstDefined(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return value;
    }
  }
  return null;
}

export function normalizeUnixTimestamp(value) {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return null;
  if (num > 1_000_000_000_000) return num;
  return num * 1000;
}

export function parseConfigUpdate(details) {
  if (!details || typeof details !== "object") {
    return { state: null, time: null };
  }
  const info = details.information || details.info || details.data?.information || details.data || details;
  const progress = info?.configurationUpdateProgress || info?.configUpdateProgress || null;
  const update =
    info?.configurationUpdate ||
    info?.configUpdate ||
    info?.configurationUpdateInfo ||
    progress ||
    null;

  const state = pickFirstDefined(
    update?.configUpdateState,
    update?.state,
    update?.status,
    progress?.configUpdateState,
    progress?.state,
    progress?.status,
    info?.configUpdateState,
    info?.configurationUpdateState,
    info?.state,
    info?.status,
  );

  const time = pickFirstDefined(
    update?.lastConfigUpdateTime,
    update?.lastUpdateTime,
    update?.timestamp,
    update?.time,
    update?.updatedAt,
    progress?.lastConfigUpdateTime,
    progress?.lastUpdateTime,
    progress?.timestamp,
    progress?.time,
    progress?.updatedAt,
    info?.lastConfigUpdateTime,
    info?.lastUpdateTime,
    info?.timestamp,
    info?.updatedAt,
  );

  return { state, time };
}

function normalizeState(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized || null;
}

function isFailureState(state) {
  if (!state) return false;
  return [
    "fail",
    "error",
    "invalid",
    "reject",
    "timeout",
    "cancel",
    "terminated",
    "abort",
  ].some((token) => state.includes(token));
}

function isSuccessState(state) {
  if (!state) return false;
  return [
    "finished",
    "completed",
    "success",
    "applied",
    "confirmed",
    "deployed",
    "cleared",
  ].some((token) => state.includes(token));
}

function isProgressState(state) {
  if (!state) return false;
  return [
    "progress",
    "running",
    "syncing",
    "deploying",
    "started",
    "pending",
    "queued",
  ].some((token) => state.includes(token));
}

export function resolveDeviceConfirmationStatus({ details, startedAt = null, toleranceMs = 60_000 } = {}) {
  const { state, time } = parseConfigUpdate(details);
  const normalizedState = normalizeState(state);
  const updateMs = normalizeUnixTimestamp(time);
  const startedMs = startedAt ? new Date(startedAt).getTime() : null;

  if (isFailureState(normalizedState)) {
    return { status: "failed", state: normalizedState, updateMs, confirmedAt: null };
  }

  if (!updateMs) {
    return { status: "pending", state: normalizedState, updateMs: null, confirmedAt: null };
  }

  if (Number.isFinite(startedMs) && updateMs + toleranceMs < startedMs) {
    return { status: "pending", state: normalizedState, updateMs, confirmedAt: null };
  }

  const confirmedAt = new Date(updateMs).toISOString();
  if (isSuccessState(normalizedState)) {
    return { status: "confirmed", state: normalizedState, updateMs, confirmedAt };
  }

  // Em alguns dispositivos XirgoX o estado vem apenas como "progress",
  // mas o timestamp indica que a configuração foi processada.
  if (isProgressState(normalizedState)) {
    return { status: "confirmed", state: normalizedState, updateMs, confirmedAt };
  }

  if (!normalizedState || normalizedState === "nodata") {
    return { status: "pending", state: normalizedState, updateMs, confirmedAt: null };
  }

  return { status: "confirmed", state: normalizedState, updateMs, confirmedAt };
}

export default {
  normalizeUnixTimestamp,
  parseConfigUpdate,
  resolveDeviceConfirmationStatus,
};
