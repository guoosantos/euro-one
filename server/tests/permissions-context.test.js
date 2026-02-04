import assert from "node:assert/strict";
import test, { after, afterEach, before } from "node:test";
import express from "express";
import { randomUUID } from "crypto";

import { authorizeAnyPermission, authorizePermission, resolvePermissionContext } from "../middleware/permissions.js";
import { authenticate, requireRole, signSession } from "../middleware/auth.js";
import { errorHandler } from "../middleware/error-handler.js";
import { MIRROR_FALLBACK_PERMISSIONS } from "../middleware/permissions.js";
import { createGroup, deleteGroup } from "../models/group.js";
import { createUser, deleteUser } from "../models/user.js";
import { createClient, deleteClient } from "../models/client.js";
import { requestApp } from "./app-request.js";

const createdGroups = [];
const createdUsers = [];
let testClientId = null;

async function createTestUser({ role, clientId, attributes = {} }) {
  const idSuffix = randomUUID();
  const user = await createUser({
    name: `Test ${idSuffix}`,
    email: `test-${idSuffix}@example.com`,
    username: `user_${idSuffix}`.slice(0, 30),
    password: "test-1234",
    role,
    clientId,
    attributes,
  });
  createdUsers.push(user.id);
  return user;
}

async function callEndpoint(app, { path, token }) {
  const response = await requestApp(app, {
    url: path,
    headers: { Authorization: `Bearer ${token}` },
  });
  let payload = null;
  try {
    payload = await response.json();
  } catch (_error) {
    payload = null;
  }
  return { status: response.status, payload };
}

afterEach(async () => {
  createdGroups.splice(0).forEach((id) => {
    try {
      deleteGroup(id);
    } catch (_error) {
      // ignore cleanup
    }
  });
  const deletions = createdUsers.splice(0).map((id) => deleteUser(id).catch(() => null));
  if (deletions.length) {
    await Promise.all(deletions);
  }
});

before(async () => {
  const idSuffix = randomUUID();
  const client = await createClient({ name: `Test Client ${idSuffix}` });
  testClientId = client.id;
});

after(async () => {
  if (!testClientId) return;
  try {
    await deleteClient(testClientId);
  } catch (_error) {
    // ignore cleanup
  }
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
    clientId: testClientId,
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

  const user = await createTestUser({
    role: "tenant_admin",
    clientId: testClientId,
    attributes: { permissionGroupId: permissionGroup.id },
  });
  const token = signSession({
    id: user.id,
    role: user.role,
    clientId: user.clientId,
    attributes: user.attributes,
  });
  const response = await callEndpoint(app, { path: "/api/secure", token });

  assert.equal(response.status, 200);
  assert.equal(response.payload.ok, true);
});

test("authorizePermission nega subpage ausente quando subpages estão definidos", async () => {
  const permissionGroup = createGroup({
    name: "Permissões monitoramento limitado",
    description: "Grupo com subpages parciais",
    clientId: testClientId,
    attributes: {
      kind: "PERMISSION_GROUP",
      permissions: {
        primary: {
          monitoring: {
            visible: true,
            access: "read",
            subpages: {
              alerts: "read",
            },
          },
        },
      },
    },
  });
  createdGroups.push(permissionGroup.id);

  const app = express();
  app.use(express.json());
  app.get(
    "/api/secure",
    authenticate,
    authorizePermission({ menuKey: "primary", pageKey: "monitoring", subKey: "alerts-conjugated" }),
    (req, res) => res.json({ ok: true }),
  );
  app.use(errorHandler);

  const user = await createTestUser({
    role: "user",
    clientId: testClientId,
    attributes: { permissionGroupId: permissionGroup.id },
  });
  const token = signSession({
    id: user.id,
    role: user.role,
    clientId: user.clientId,
    attributes: user.attributes,
  });
  const response = await callEndpoint(app, { path: "/api/secure", token });

  assert.equal(response.status, 403);
});

test("authorizeAnyPermission permite acesso quando qualquer permissão é válida", async () => {
  const permissionGroup = createGroup({
    name: "Permissões monitoramento",
    description: "Grupo somente monitoramento",
    clientId: testClientId,
    attributes: {
      kind: "PERMISSION_GROUP",
      permissions: {
        primary: {
          monitoring: "read",
        },
      },
    },
  });
  createdGroups.push(permissionGroup.id);

  const app = express();
  app.use(express.json());
  app.get(
    "/api/secure",
    authenticate,
    authorizeAnyPermission({
      permissions: [
        { menuKey: "fleet", pageKey: "vehicles" },
        { menuKey: "primary", pageKey: "monitoring" },
      ],
    }),
    (req, res) => res.json({ ok: true }),
  );
  app.use(errorHandler);

  const user = await createTestUser({
    role: "user",
    clientId: testClientId,
    attributes: { permissionGroupId: permissionGroup.id },
  });
  const token = signSession({
    id: user.id,
    role: user.role,
    clientId: user.clientId,
    attributes: user.attributes,
  });
  const response = await callEndpoint(app, { path: "/api/secure", token });

  assert.equal(response.status, 200);
  assert.equal(response.payload.ok, true);
});
