import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { resolveDeviceConfirmationStatus } from "../services/xdm/deployment-confirmation.js";

describe("resolveDeviceConfirmationStatus", () => {
  it("confirms when provider returns finished state with timestamp", () => {
    const startedAt = "2026-02-12T03:00:00.000Z";
    const updateMs = Date.parse(startedAt) + 2 * 60_000;
    const details = {
      information: {
        configurationUpdate: {
          configUpdateState: "finished",
          lastConfigUpdateTime: updateMs,
        },
      },
    };

    const result = resolveDeviceConfirmationStatus({ details, startedAt });
    assert.equal(result.status, "confirmed");
    assert.equal(Boolean(result.confirmedAt), true);
  });

  it("confirms when provider exposes progress state with valid timestamp", () => {
    const startedAt = "2026-02-12T03:00:00.000Z";
    const updateSeconds = Math.floor((Date.parse(startedAt) + 90_000) / 1000);
    const details = {
      information: {
        configurationUpdateProgress: {
          state: "in progress",
          lastConfigUpdateTime: updateSeconds,
        },
      },
    };

    const result = resolveDeviceConfirmationStatus({ details, startedAt });
    assert.equal(result.status, "confirmed");
    assert.equal(Boolean(result.confirmedAt), true);
  });

  it("marks provider failure states as failed", () => {
    const startedAt = "2026-02-12T03:00:00.000Z";
    const updateSeconds = Math.floor((Date.parse(startedAt) + 60_000) / 1000);
    const details = {
      information: {
        configurationUpdate: {
          configUpdateState: "failed",
          lastConfigUpdateTime: updateSeconds,
        },
      },
    };

    const result = resolveDeviceConfirmationStatus({ details, startedAt });
    assert.equal(result.status, "failed");
  });

  it("keeps pending when timestamp is older than deployment start", () => {
    const startedAt = "2026-02-12T03:00:00.000Z";
    const oldSeconds = Math.floor((Date.parse(startedAt) - 10 * 60_000) / 1000);
    const details = {
      information: {
        configurationUpdate: {
          configUpdateState: "finished",
          lastConfigUpdateTime: oldSeconds,
        },
      },
    };

    const result = resolveDeviceConfirmationStatus({ details, startedAt });
    assert.equal(result.status, "pending");
    assert.equal(result.confirmedAt, null);
  });
});
