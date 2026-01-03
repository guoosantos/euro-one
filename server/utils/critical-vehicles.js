export function buildCriticalVehicleSummary(
  events = [],
  { windowMs = 3 * 60 * 60 * 1000, minEvents = 2, now = new Date(), includeResolved = false } = {},
) {
  const cutoff = now instanceof Date ? now.getTime() - windowMs : Date.now() - windowMs;
  const byVehicle = new Map();

  (Array.isArray(events) ? events : []).forEach((event) => {
    if (!event?.vehicleId) return;
    if (!includeResolved && event?.resolved) return;
    if (String(event?.severity || "").toLowerCase() !== "critical") return;
    const timeValue = event?.eventTime ?? event?.time ?? event?.createdAt;
    const timestamp = timeValue ? Date.parse(timeValue) : NaN;
    if (!Number.isFinite(timestamp) || timestamp < cutoff) return;
    const key = String(event.vehicleId);
    const list = byVehicle.get(key) || [];
    list.push({
      ...event,
      eventTime: new Date(timestamp).toISOString(),
    });
    byVehicle.set(key, list);
  });

  const summaries = [];

  byVehicle.forEach((entries, vehicleId) => {
    const sorted = entries.slice().sort((a, b) => Date.parse(b.eventTime) - Date.parse(a.eventTime));
    if (sorted.length < minEvents) return;
    const lastEventAt = sorted[0]?.eventTime || null;
    summaries.push({
      vehicleId,
      count: sorted.length,
      lastEventAt,
      events: sorted.map((event) => ({
        id: event?.id ?? null,
        type: event?.type ?? event?.event ?? null,
        createdAt: event?.eventTime ?? null,
      })),
    });
  });

  return summaries.sort((a, b) => Date.parse(b.lastEventAt || 0) - Date.parse(a.lastEventAt || 0));
}

export default buildCriticalVehicleSummary;
