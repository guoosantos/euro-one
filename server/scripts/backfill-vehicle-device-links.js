import { initConfigEnv } from "../config.js";
import { initVehicles, listVehicles, updateVehicle } from "../models/vehicle.js";
import { listDevices, findDeviceByUniqueId, updateDevice } from "../models/device.js";

const toKey = (value) => (value ? String(value).trim().toLowerCase() : null);

async function main() {
  await initConfigEnv();
  await initVehicles();

  const clientId = process.env.CLIENT_ID ? String(process.env.CLIENT_ID) : null;
  const dryRun = process.env.DRY_RUN !== "false";

  const vehicles = listVehicles(clientId ? { clientId } : {});
  const devices = listDevices(clientId ? { clientId } : {});
  const deviceByUniqueId = new Map(
    devices
      .map((device) => [toKey(device.uniqueId), device])
      .filter(([key]) => key),
  );

  let linked = 0;
  let skipped = 0;
  const updates = [];

  for (const vehicle of vehicles) {
    const vehicleId = String(vehicle.id);
    const desiredUid = toKey(vehicle.deviceImei || vehicle.xdmDeviceUid);
    if (!desiredUid) {
      skipped += 1;
      continue;
    }

    const candidate = deviceByUniqueId.get(desiredUid) || findDeviceByUniqueId(desiredUid);
    if (!candidate) {
      updates.push({ vehicleId, status: "missing-device", uniqueId: desiredUid });
      continue;
    }

    if (candidate.clientId && vehicle.clientId && String(candidate.clientId) !== String(vehicle.clientId)) {
      updates.push({
        vehicleId,
        status: "cross-client",
        deviceId: candidate.id,
        deviceClientId: candidate.clientId,
        vehicleClientId: vehicle.clientId,
      });
      continue;
    }

    if (candidate.vehicleId && String(candidate.vehicleId) !== vehicleId) {
      updates.push({
        vehicleId,
        status: "device-linked-other",
        deviceId: candidate.id,
        existingVehicleId: candidate.vehicleId,
      });
      continue;
    }

    const needsLink = !candidate.vehicleId || candidate.vehicleId !== vehicleId || vehicle.deviceId !== candidate.id;
    if (!needsLink) {
      skipped += 1;
      continue;
    }

    updates.push({
      vehicleId,
      status: "link",
      deviceId: candidate.id,
      uniqueId: candidate.uniqueId,
    });

    if (!dryRun) {
      updateDevice(candidate.id, { vehicleId });
      updateVehicle(vehicleId, { deviceId: candidate.id, deviceImei: candidate.uniqueId || vehicle.deviceImei });
    }
    linked += 1;
  }

  const summary = {
    clientId,
    dryRun,
    vehiclesChecked: vehicles.length,
    devicesChecked: devices.length,
    linked,
    skipped,
    updates,
  };
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error("[backfill] failed", error?.message || error);
  process.exit(1);
});
