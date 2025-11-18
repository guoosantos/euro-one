export const COMMUNICATION_BUCKETS = [
  { key: "0-1h", label: "0–1h", maxHours: 1 },
  { key: "1-6h", label: "1–6h", maxHours: 6 },
  { key: "6-12h", label: "6–12h", maxHours: 12 },
  { key: "12-24h", label: "12–24h", maxHours: 24 },
  { key: "24-72h", label: "24–72h", maxHours: 72 },
  { key: "72h-10d", label: "72h–10d", maxHours: 240 },
  { key: "10-30d", label: "10–30d", maxHours: 720 },
  { key: "30d+", label: "30d+", maxHours: Infinity },
];

export function bucketCommunicationAge(lastUpdate, { now = Date.now() } = {}) {
  if (!lastUpdate) return COMMUNICATION_BUCKETS.at(-1);
  const ts = typeof lastUpdate === "number" ? lastUpdate : Date.parse(lastUpdate);
  if (!Number.isFinite(ts)) return COMMUNICATION_BUCKETS.at(-1);
  const diffHours = Math.max(0, (now - ts) / (1000 * 60 * 60));
  return COMMUNICATION_BUCKETS.find((bucket) => diffHours <= bucket.maxHours) || COMMUNICATION_BUCKETS.at(-1);
}

export function groupByCommunication(devices = [], { now = Date.now() } = {}) {
  const totals = new Map(COMMUNICATION_BUCKETS.map((bucket) => [bucket.key, { bucket, items: [] }]));
  devices.forEach((device) => {
    const bucket = bucketCommunicationAge(device?.lastCommunication || device?.lastUpdate, { now });
    const entry = totals.get(bucket.key);
    entry.items.push(device);
  });
  return Array.from(totals.values());
}
