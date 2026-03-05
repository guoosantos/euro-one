import { extractInternalSequence, normalizePrefix } from "./internal-code.js";

function toMergeKey(device, index) {
  if (device?.id) return `id:${String(device.id)}`;
  if (device?.traccarId) return `traccar:${String(device.traccarId)}`;
  if (device?.uniqueId) return `unique:${String(device.uniqueId).toLowerCase()}`;
  return `idx:${index}`;
}

export function resolveModelIdFromDevice(device) {
  const normaliseModelRef = (value) => {
    if (value === null || value === undefined) return null;
    const resolved = String(value).trim();
    return resolved || null;
  };
  return (
    normaliseModelRef(device?.modelId) ||
    normaliseModelRef(device?.productId) ||
    normaliseModelRef(device?.attributes?.modelId) ||
    normaliseModelRef(device?.attributes?.productId) ||
    normaliseModelRef(device?.model?.id) ||
    null
  );
}

export function mergeDevicesForModelStats(primary = [], secondary = []) {
  const map = new Map();
  [...(Array.isArray(primary) ? primary : []), ...(Array.isArray(secondary) ? secondary : [])].forEach((device, index) => {
    if (!device) return;
    const key = toMergeKey(device, index);
    if (!map.has(key)) {
      map.set(key, {
        ...device,
        attributes: device?.attributes && typeof device.attributes === "object" ? { ...device.attributes } : {},
      });
      return;
    }
    const previous = map.get(key);
    map.set(key, {
      ...previous,
      ...device,
      modelId: device?.modelId ?? previous?.modelId ?? null,
      vehicleId: device?.vehicleId ?? previous?.vehicleId ?? null,
      attributes: {
        ...(previous?.attributes && typeof previous.attributes === "object" ? previous.attributes : {}),
        ...(device?.attributes && typeof device.attributes === "object" ? device.attributes : {}),
      },
      internalCode: device?.internalCode ?? previous?.internalCode ?? null,
    });
  });
  return Array.from(map.values());
}

export function buildModelDeviceCounts(devices = []) {
  const counts = new Map();
  (Array.isArray(devices) ? devices : []).forEach((device) => {
    const resolvedModelId = resolveModelIdFromDevice(device);
    if (!resolvedModelId) return;
    const modelId = String(resolvedModelId);
    if (!counts.has(modelId)) {
      counts.set(modelId, { available: 0, linked: 0, total: 0 });
    }
    const bucket = counts.get(modelId);
    if (device?.vehicleId) {
      bucket.linked += 1;
    } else {
      bucket.available += 1;
    }
    bucket.total += 1;
  });
  return counts;
}

export function buildModelInternalSequences(devices = [], models = []) {
  const modelMap = new Map((Array.isArray(models) ? models : []).map((model) => [String(model.id), model]));
  const sequences = new Map();
  (Array.isArray(devices) ? devices : []).forEach((device) => {
    const resolvedModelId = resolveModelIdFromDevice(device);
    if (!resolvedModelId) return;
    const model = modelMap.get(String(resolvedModelId));
    if (!model) return;
    const prefix = normalizePrefix(model?.prefix ?? model?.internalPrefix ?? model?.codePrefix ?? null);
    if (!prefix) return;
    const internalCode = device?.attributes?.internalCode || device?.internalCode || null;
    const sequence = extractInternalSequence(internalCode, prefix);
    if (!sequence) return;
    const key = String(resolvedModelId);
    const current = sequences.get(key) || 0;
    if (sequence > current) {
      sequences.set(key, sequence);
    }
  });
  return sequences;
}

export default {
  resolveModelIdFromDevice,
  mergeDevicesForModelStats,
  buildModelDeviceCounts,
  buildModelInternalSequences,
};
