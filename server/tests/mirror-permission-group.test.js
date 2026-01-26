import assert from "node:assert/strict";
import test from "node:test";

import { __resetStorageForTests, saveCollection } from "../services/storage.js";

test("backfillMirrorPermissions cria grupo padrão e atualiza espelhos sem permissionGroupId", async () => {
  __resetStorageForTests();
  const ownerClientId = `owner-${Date.now()}`;
  const mirrorId = `mirror-${Date.now()}`;

  saveCollection("mirrors", [
    {
      id: mirrorId,
      ownerClientId,
      targetClientId: `target-${Date.now()}`,
      targetType: "GERENCIADORA",
      vehicleIds: [],
      vehicleGroupId: null,
      permissionGroupId: null,
      startAt: null,
      endAt: null,
      createdBy: null,
      createdByName: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  ]);
  saveCollection("groups", []);

  const backfillModule = await import(`../scripts/backfill-mirror-permissions.js?ts=${Date.now()}`);
  await backfillModule.default();

  const { listGroups } = await import(`../models/group.js?ts=${Date.now()}`);
  const { listMirrors } = await import(`../models/mirror.js?ts=${Date.now()}`);
  const groups = listGroups({ clientId: ownerClientId });
  const mirrors = listMirrors({ ownerClientId });

  assert.equal(mirrors.length, 1);
  assert.ok(mirrors[0].permissionGroupId);
  const group = groups.find((item) => String(item.id) === String(mirrors[0].permissionGroupId));
  assert.ok(group);
  assert.equal(group.attributes?.permissions?.admin?.users?.subpages?.["users-vehicle-groups"], "full");
});
