export function buildParams({ deviceId, types, from, to, limit, severity, resolved }) {
  const params = {};
  if (deviceId) params.deviceId = deviceId;
  if (Array.isArray(types) && types.length) {
    params.type = types.join(",");
  } else if (typeof types === "string") {
    params.type = types;
  }
  if (from) params.from = from;
  if (to) params.to = to;
  if (limit) params.limit = limit;
  if (severity && severity !== "all") params.severity = severity;
  if (resolved !== undefined) params.resolved = resolved;
  return params;
}

export default buildParams;
