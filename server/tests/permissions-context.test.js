import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
import express from "express";

import { authorizePermission, resolvePermissionContext } from "../middleware/permissions.js";
import { authenticate, requireRole, signSession } from "../middleware/auth.js";
import { errorHandler } from "../middleware/error-handler.js";
import { MIRROR_FALLBACK_PERMISSIONS } from "../middleware/permissions.js";
import { createGroup, deleteGroup } from "../models/group.js";

const createdGroups = [];

async function callEndpoint(app, { path, token }) {
  const server = app.listen(0);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const response = await fetch(`${baseUrl}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  let payload = null;
  try {
    payload = await response.json();
  } catch (_error) {
    payload = null;
  }
  server.close();
  return { status: response.status, payload };
}

afterEach(() => {
  createdGroups.splice(0).forEach((id) => {
    try {
      deleteGroup(id);
    } catch (_error) {
      // ignore cleanup
    }
  });
});

test("resolvePermissionContext não concede full quando permissionGroupId está ausente", async () => {
  const req = {
    user: { id: "user-permissions", role: "user", clientId: "client-1", attributes: {} },
    mirrorContext: null,
  };

  const context = await resolvePermissionContext(req);

  assert.equal(context.isFull, false);
  assert.equal(context.level, null);
  assert.equal(context.permissions, null);
});

test("tenant_admin passa requireRole e authorizePermission quando permitido pelo grupo", async () => {
  const permissionGroup = createGroup({
    name: "Permissões monitoramento",
    description: "Grupo de permissões para tenant_admin",
    clientId: "client-tenant-admin",
    attributes: {
      kind: "PERMISSION_GROUP",
      permissions: MIRROR_FALLBACK_PERMISSIONS,
    },
  });
  createdGroups.push(permissionGroup.id);

  const app = express();
  app.use(express.json());
  app.get(
    "/api/secure",
    authenticate,
    requireRole("manager", "admin"),
    authorizePermission({ menuKey: "primary", pageKey: "monitoring" }),
    (req, res) => res.json({ ok: true }),
  );
  app.use(errorHandler);

  const token = signSession({
    id: "tenant-admin",
    role: "tenant_admin",
    clientId: "client-tenant-admin",
    attributes: { permissionGroupId: permissionGroup.id },
  });
  const response = await callEndpoint(app, { path: "/api/secure", token });

  assert.equal(response.status, 200);
  assert.equal(response.payload.ok, true);
});
