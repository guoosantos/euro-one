import test from "node:test";
import assert from "node:assert/strict";
import { encodeCredentials } from "../src/lib/auth-utils.js";
import {
  isValidPermissionContextPayload,
  resolveSwitchTargets,
  validateBootstrapPayload,
} from "../src/lib/tenant-context.jsx";

test("encodeCredentials returns base64 string", () => {
  const encoded = encodeCredentials("demo", "123");
  assert.equal(encoded, Buffer.from("demo:123").toString("base64"));
});

test("encodeCredentials handles missing values", () => {
  assert.equal(encodeCredentials(null, null), null);
  assert.equal(encodeCredentials("demo", undefined), Buffer.from("demo:").toString("base64"));
});

test("resolveSwitchTargets normaliza admin geral para tenantId null", () => {
  const user = { role: "admin" };
  const tenants = [{ id: "42", name: "EURO ONE" }];
  const result = resolveSwitchTargets({
    nextTenantId: "42",
    nextOwnerClientId: null,
    nextMirrorMode: "self",
    currentMirrorMode: "self",
    user,
    tenants,
  });
  assert.equal(result.resolvedTenantId, null);
  assert.equal(result.nextKey, "self:none:self");
});

test("resolveSwitchTargets preserva tenant e owner para usuário não-admin", () => {
  const user = { role: "user" };
  const result = resolveSwitchTargets({
    nextTenantId: "abc",
    nextOwnerClientId: "owner-1",
    nextMirrorMode: "target",
    currentMirrorMode: "self",
    user,
    tenants: [],
  });
  assert.equal(result.resolvedTenantId, "abc");
  assert.equal(result.resolvedOwnerId, "owner-1");
  assert.equal(result.resolvedMirrorMode, "target");
  assert.equal(result.nextKey, "abc:owner-1:target");
});

test("validateBootstrapPayload aceita bootstrap completo", () => {
  const payload = {
    context: { clientId: "42", clients: [{ id: "42", name: "Euro One" }] },
    permissionContext: {
      permissions: { primary: { home: "full" } },
      isFull: false,
      permissionGroupId: "grp-1",
    },
    mePermissions: {
      clientIds: ["42"],
      mirrorOwnerIds: [],
      mirrorAllowAll: false,
    },
    mirrorsContext: {
      mirrorModeEnabled: true,
      canMirrorAll: false,
      mode: "self",
    },
  };
  const validation = validateBootstrapPayload(payload);
  assert.equal(validation.ok, true);
  assert.deepEqual(validation.context, payload.context);
  assert.deepEqual(validation.permissionContext, payload.permissionContext);
});

test("validateBootstrapPayload rejeita bootstrap sem permissionContext válido", () => {
  const payload = {
    context: { clientId: "42" },
    mePermissions: { clientIds: [], mirrorOwnerIds: [] },
    mirrorsContext: { mirrorModeEnabled: true },
  };
  const validation = validateBootstrapPayload(payload);
  assert.equal(validation.ok, false);
  assert.equal(validation.stage, "permissions");
  assert.equal(validation.error?.code, "INVALID_BOOTSTRAP_PAYLOAD");
});

test("isValidPermissionContextPayload rejeita payload vazio ou com erro", () => {
  assert.equal(isValidPermissionContextPayload(null), false);
  assert.equal(isValidPermissionContextPayload({}), false);
  assert.equal(isValidPermissionContextPayload({ error: new Error("boom") }), false);
  assert.equal(
    isValidPermissionContextPayload({
      permissions: { primary: { home: "read" } },
      permissionGroupId: "grp-1",
    }),
    true,
  );
});
