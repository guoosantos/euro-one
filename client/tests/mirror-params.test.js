import assert from "node:assert/strict";
import test from "node:test";

import { resolveMirrorClientParams, resolveMirrorHeaders } from "../src/lib/mirror-params.js";

test("resolveMirrorClientParams remove clientId/tenantId quando mirrorOwnerClientId está presente", () => {
  const result = resolveMirrorClientParams({
    params: { clientId: "target-1", tenantId: "target-2", ownerClientId: "target-3", foo: "bar" },
    tenantId: "target-tenant",
    mirrorContextMode: "owner",
    mirrorOwnerClientId: "owner-123",
  });

  assert.equal(result?.clientId, undefined);
  assert.equal(result?.tenantId, undefined);
  assert.equal(result?.ownerClientId, undefined);
  assert.equal(result?.foo, "bar");
});

test("resolveMirrorHeaders retorna X-Owner-Client-Id quando mirrorModeEnabled está ativo", () => {
  const headers = resolveMirrorHeaders({
    mirrorModeEnabled: true,
    mirrorOwnerClientId: "owner-456",
  });

  assert.deepEqual(headers, { "X-Owner-Client-Id": "owner-456" });
});
