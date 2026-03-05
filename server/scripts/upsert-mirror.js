import { initConfigEnv } from "../config.js";
import { listMirrors, createMirror, updateMirror } from "../models/mirror.js";
import { listVehicles } from "../models/vehicle.js";
import { getGroupById } from "../models/group.js";

function parseIds(raw) {
  if (!raw) return [];
  return String(raw)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

async function main() {
  await initConfigEnv();

  const ownerClientId = process.env.OWNER_CLIENT_ID;
  const targetClientId = process.env.TARGET_CLIENT_ID;
  const permissionGroupId = process.env.PERMISSION_GROUP_ID || null;
  const startAt = process.env.START_AT || null;
  const endAt = process.env.END_AT || null;
  const vehicleIds = parseIds(process.env.VEHICLE_IDS);

  if (!ownerClientId || !targetClientId) {
    throw new Error("OWNER_CLIENT_ID e TARGET_CLIENT_ID são obrigatórios.");
  }

  const resolvedVehicleIds = vehicleIds.length
    ? vehicleIds
    : listVehicles({ clientId: ownerClientId })
      .map((vehicle) => String(vehicle.id))
      .filter(Boolean);

  if (!permissionGroupId) {
    throw new Error("PERMISSION_GROUP_ID é obrigatório para criar espelho.");
  }
  const group = getGroupById(permissionGroupId);
  if (!group) {
    throw new Error("PERMISSION_GROUP_ID não encontrado.");
  }

  const existing = listMirrors({ ownerClientId, targetClientId })[0] || null;
  if (existing) {
    const updated = updateMirror(existing.id, {
      vehicleIds: resolvedVehicleIds,
      permissionGroupId,
      ...(startAt ? { startAt } : {}),
      ...(endAt ? { endAt } : {}),
    });
    console.log(JSON.stringify({ action: "updated", mirror: updated }, null, 2));
    return;
  }

  const created = createMirror({
    ownerClientId,
    targetClientId,
    vehicleIds: resolvedVehicleIds,
    permissionGroupId,
    startAt,
    endAt,
  });
  console.log(JSON.stringify({ action: "created", mirror: created }, null, 2));
}

main().catch((error) => {
  console.error("[upsert-mirror] failed", error?.message || error);
  process.exit(1);
});
