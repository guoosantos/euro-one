import assert from "node:assert/strict";
import test from "node:test";

import { MIRROR_FALLBACK_PERMISSIONS, resolvePermissionContext } from "../middleware/permissions.js";

test("resolvePermissionContext aplica fallback quando mirror não tem permissionGroupId", async () => {
  const req = {
    user: { id: "user-fallback", role: "user", clientId: "receiver-1" },
    mirrorContext: {
      mode: "target",
      ownerClientId: "owner-1",
      targetClientId: "receiver-1",
      permissionGroupId: null,
      vehicleIds: ["veh-1"],
    },
  };

  const context = await resolvePermissionContext(req);

  assert.deepEqual(context.permissions, MIRROR_FALLBACK_PERMISSIONS);
  assert.equal(context.permissionGroupId, null);
  assert.equal(
    context.permissions?.primary?.monitoring?.subpages?.alerts,
    "read",
  );
  assert.equal(
    context.permissions?.primary?.monitoring?.subpages?.["alerts-conjugated"],
    "read",
  );
  assert.equal(
    context.permissions?.admin?.users?.subpages?.["users-vehicle-groups"],
    "full",
  );
});
