import createError from "http-errors";

import XdmClient from "./xdm-client.js";
import { normalizeXdmDeviceUid, normalizeXdmId, buildOverridesDto } from "./xdm-utils.js";
import { resolveGeozoneGroupOverrideElementId } from "./xdm-override-resolver.js";
import { isDeviceNotFoundError, wrapXdmError } from "./xdm-error.js";

function resolveDealerId() {
  const raw = process.env.XDM_DEALER_ID;
  const dealerId = raw != null ? Number(raw) : null;
  return Number.isFinite(dealerId) ? dealerId : null;
}

function buildSettingsOverridesPayload({ overrideId, value }) {
  return {
    settingsOverrides: {
      modified: [
        {
          userElementId: Number(overrideId),
          value: value == null ? "" : String(value),
        },
      ],
    },
  };
}

function toAttemptDetails(error, endpoint) {
  return {
    endpoint,
    status: error?.status || error?.details?.status || null,
    method: error?.details?.method || null,
    url: error?.details?.url || null,
    responseSample: error?.details?.responseSample || null,
  };
}

export async function applyGeozoneGroupOverride({
  deviceUid,
  xdmGeozoneGroupId,
  correlationId,
  configId = null,
} = {}) {
  const normalizedDeviceUid = normalizeXdmDeviceUid(deviceUid, { context: "apply overrides geozone group" });
  const normalizedGeozoneGroupId = normalizeXdmId(xdmGeozoneGroupId, { context: "apply overrides geozone group" });
  const overrideConfig = await resolveGeozoneGroupOverrideElementId({ correlationId });
  const xdmClient = new XdmClient();

  const externalPayload = {
    overrides: buildOverridesDto({
      [overrideConfig.overrideId]: normalizedGeozoneGroupId,
    }),
  };

  try {
    await xdmClient.request(
      "PUT",
      `/api/external/v3/settingsOverrides/${normalizedDeviceUid}`,
      externalPayload,
      { correlationId },
    );
    return {
      deviceUid: normalizedDeviceUid,
      overrideId: overrideConfig.overrideId,
      endpoint: "/api/external/v3/settingsOverrides",
      usedFallback: false,
    };
  } catch (error) {
    if (isDeviceNotFoundError(error)) {
      const deviceError = createError(424, "Device UID not found");
      deviceError.expose = true;
      deviceError.code = "XDM_DEVICE_NOT_FOUND";
      deviceError.details = {
        correlationId,
        deviceUid: normalizedDeviceUid,
        ...toAttemptDetails(error, "/api/external/v3/settingsOverrides"),
      };
      throw deviceError;
    }

    const externalAttempt = toAttemptDetails(error, "/api/external/v3/settingsOverrides");
    const dealerId = resolveDealerId();
    const fallbackPayload = {
      deviceUid: normalizedDeviceUid,
      ...(dealerId != null ? { dealerId } : {}),
      ...(configId != null ? { newConfigId: Number(configId) } : {}),
      ...buildSettingsOverridesPayload({
        overrideId: overrideConfig.overrideId,
        value: normalizedGeozoneGroupId,
      }),
    };

    try {
      await xdmClient.request("PUT", "/api/Devices2/UpdateDeviceSdk", fallbackPayload, { correlationId });
      return {
        deviceUid: normalizedDeviceUid,
        overrideId: overrideConfig.overrideId,
        endpoint: "/api/Devices2/UpdateDeviceSdk",
        usedFallback: true,
      };
    } catch (fallbackError) {
      if (isDeviceNotFoundError(fallbackError)) {
        const deviceError = createError(424, "Device UID not found");
        deviceError.expose = true;
        deviceError.code = "XDM_DEVICE_NOT_FOUND";
        deviceError.details = {
          correlationId,
          deviceUid: normalizedDeviceUid,
          ...toAttemptDetails(fallbackError, "/api/Devices2/UpdateDeviceSdk"),
          attempts: [externalAttempt],
        };
        throw deviceError;
      }

      const wrapped = wrapXdmError(fallbackError, {
        step: "applyOverrides",
        correlationId,
        payloadSample: {
          deviceUid: normalizedDeviceUid,
          overrideId: overrideConfig.overrideId,
          groupId: normalizedGeozoneGroupId,
        },
      });
      wrapped.details = {
        ...wrapped.details,
        attempts: [externalAttempt, toAttemptDetails(fallbackError, "/api/Devices2/UpdateDeviceSdk")],
      };
      throw wrapped;
    }
  }
}

export default {
  applyGeozoneGroupOverride,
};
