import assert from "node:assert/strict";
import test from "node:test";

import { ensureMirrorPermissionGroup } from "../scripts/backfill-mirror-permissions.js";
import { deleteGroup } from "../models/group.js";

test("ensureMirrorPermissionGroup inclui permissão para users-vehicle-groups", () => {
  const clientId = `client-${Date.now()}`;
  const group = ensureMirrorPermissionGroup(clientId, { logger: console });
  try {
    assert.equal(group.attributes?.permissions?.admin?.users?.subpages?.["users-vehicle-groups"], "full");
  } finally {
    deleteGroup(group.id);
  }
});
