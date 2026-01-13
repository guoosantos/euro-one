import assert from "node:assert/strict";
import test from "node:test";

import XdmClient from "../services/xdm/xdm-client.js";
import { applyOverrides } from "../services/xdm/deployment-service.js";
import {
  buildGroupHashSummary,
  buildItinerarySignature,
  buildItinerarySignatureInput,
  resolveItinerarySignatureOverrideConfig,
} from "../services/xdm/xdm-itinerary-signature.js";

function withEnv(pairs, fn) {
  const previous = {};
  Object.keys(pairs).forEach((key) => {
    previous[key] = process.env[key];
    if (pairs[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = pairs[key];
    }
  });
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      Object.keys(pairs).forEach((key) => {
        if (previous[key] === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = previous[key];
        }
      });
    });
}

test("applyOverrides inclui assinatura do itinerário no payload", async () => {
  const originalRequest = XdmClient.prototype.request;
  const calls = [];
  XdmClient.prototype.request = async (method, path, body) => {
    calls.push({ method, path, body });
    return { ok: true };
  };

  try {
    await withEnv(
      {
        XDM_GEOZONE_GROUP_OVERRIDE_ID_ITINERARY: "101",
        XDM_GEOZONE_GROUP_OVERRIDE_ID_TARGETS: "102",
        XDM_GEOZONE_GROUP_OVERRIDE_ID_ENTRY: "103",
        XDM_ITINERARY_SIGNATURE_OVERRIDE_ID: "999",
      },
      async () => {
        const groupHashes = { itinerary: "hash-it", targets: "hash-tg", entry: "hash-en" };
        const signatureConfig = resolveItinerarySignatureOverrideConfig();
        const signatureValue = buildItinerarySignature({ itineraryId: 77, groupHashes });

        await applyOverrides({
          deviceUid: "123456",
          groupIds: { itinerary: 111, targets: 222, entry: 333 },
          correlationId: "corr-123",
          signature: {
            overrideId: signatureConfig.overrideId,
            overrideKey: signatureConfig.overrideKey,
            value: signatureValue,
            input: buildItinerarySignatureInput({ itineraryId: 77, groupHashes }),
            summary: buildGroupHashSummary(groupHashes),
          },
        });
      },
    );
  } finally {
    XdmClient.prototype.request = originalRequest;
  }

  assert.equal(calls.length, 1);
  const payload = calls[0].body;
  assert.equal(calls[0].method, "PUT");
  assert.ok(payload?.Overrides);
  assert.equal(payload.Overrides["101"].value, 111);
  assert.equal(payload.Overrides["102"].value, 222);
  assert.equal(payload.Overrides["103"].value, 333);
  assert.equal(payload.Overrides["999"].value > 0, true);
});
