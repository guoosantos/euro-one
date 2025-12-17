export function normaliseTraccarDevice(rawDevice) {
  if (!rawDevice || typeof rawDevice !== "object") {
    return null;
  }

  const traccarId = rawDevice.id !== undefined && rawDevice.id !== null ? String(rawDevice.id) : null;
  const uniqueId = rawDevice.uniqueId ? String(rawDevice.uniqueId).trim() : null;
  const attributes = rawDevice.attributes && typeof rawDevice.attributes === "object" ? rawDevice.attributes : {};

  return {
    traccarId,
    uniqueId,
    name: rawDevice.name || uniqueId || traccarId,
    modelId: attributes.modelId ? String(attributes.modelId) : null,
    attributes,
  };
}

export function syncDevicesFromTraccar({
  clientId,
  devices,
  findDeviceByTraccarId,
  findDeviceByUniqueId,
  createDevice,
  updateDevice,
}) {
  const result = { created: 0, updated: 0, skipped: [] };

  if (!clientId) {
    throw new Error("clientId é obrigatório para sincronizar dispositivos");
  }

  const list = Array.isArray(devices) ? devices : [];

  for (const rawDevice of list) {
    const normalised = normaliseTraccarDevice(rawDevice);
    if (!normalised?.uniqueId) {
      result.skipped.push({
        traccarId: normalised?.traccarId || null,
        reason: "Dispositivo no Traccar sem uniqueId",
      });
      continue;
    }

    const traccarId = normalised.traccarId;
    const existing =
      (traccarId && typeof findDeviceByTraccarId === "function"
        ? findDeviceByTraccarId(traccarId)
        : null) ||
      (typeof findDeviceByUniqueId === "function" ? findDeviceByUniqueId(normalised.uniqueId) : null);

    const attributes = { ...(normalised.attributes || {}), importedFrom: "traccar-sync" };

    if (existing) {
      if (String(existing.clientId) !== String(clientId)) {
        result.skipped.push({
          uniqueId: normalised.uniqueId,
          traccarId,
          reason: "Dispositivo já existe em outro cliente",
        });
        continue;
      }

      if (typeof updateDevice === "function") {
        updateDevice(existing.id, {
          name: existing.name || normalised.name,
          traccarId: traccarId || existing.traccarId,
          attributes,
        });
      }

      result.updated += 1;
      continue;
    }

    try {
      if (typeof createDevice === "function") {
        createDevice({
          clientId,
          name: normalised.name,
          uniqueId: normalised.uniqueId,
          modelId: normalised.modelId,
          traccarId,
          attributes,
        });
      }
      result.created += 1;
    } catch (error) {
      result.skipped.push({
        uniqueId: normalised.uniqueId,
        traccarId,
        reason: error?.message || "Falha ao criar dispositivo",
      });
    }
  }

  return { ...result, total: result.created + result.updated };
}

export default {
  normaliseTraccarDevice,
  syncDevicesFromTraccar,
};
