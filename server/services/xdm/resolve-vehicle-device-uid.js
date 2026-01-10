import { getDeviceById } from "../../models/device.js";

export function resolveVehicleDeviceUid(vehicle) {
  if (!vehicle) return null;
  const directUid = vehicle?.xdmDeviceUid || vehicle?.deviceImei || vehicle?.device_imei || vehicle?.imei;
  if (directUid) return directUid;

  if (vehicle.deviceId) {
    const device = getDeviceById(vehicle.deviceId);
    if (device?.uniqueId) {
      return device.uniqueId;
    }
  }

  const devices = Array.isArray(vehicle.devices) ? vehicle.devices : [];
  if (devices.length && devices[0]?.uniqueId) {
    return devices[0].uniqueId;
  }

  return null;
}

export default {
  resolveVehicleDeviceUid,
};
