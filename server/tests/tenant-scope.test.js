import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { buildSessionPayload } from "../routes/auth.js";
import { deleteUser } from "../models/user.js";

describe("multi-tenant session scoping", () => {
  it("returns all clients for admin geral", async () => {
    const prismaClient = {
      user: {
        findUnique: async () => ({
          id: "admin-1",
          name: "Admin Geral",
          email: "admin@euro.one",
          username: "admin",
          role: "admin",
          clientId: "client-euro-one",
          client: { id: "client-euro-one", name: "EURO ONE" },
          attributes: {},
        }),
      },
      userPreference: {
        findUnique: async () => null,
        upsert: async () => null,
      },
    };
    const clients = [
      { id: "client-euro-one", name: "EURO ONE" },
      { id: "client-2", name: "Client Two" },
    ];

    const payload = await buildSessionPayload("admin-1", "admin", {
      prismaClient,
      isPrismaAvailableFn: () => true,
      listClientsFn: async () => clients,
    });

    assert.deepEqual(
      payload.clients.map((client) => client.id),
      ["client-euro-one", "client-2"],
    );
  });

  it("returns only scoped clients for manager", async () => {
    const prismaClient = {
      user: {
        findUnique: async () => ({
          id: "manager-1",
          name: "Manager One",
          email: "manager@client.com",
          username: "manager",
          role: "manager",
          clientId: "client-a",
          client: { id: "client-a", name: "Client A", attributes: { canCreateSubclients: true } },
          attributes: { clientScopeIds: ["client-b"] },
        }),
      },
      userPreference: {
        findUnique: async () => null,
        upsert: async () => null,
      },
    };
    const clients = [
      { id: "client-a", name: "Client A", attributes: { canCreateSubclients: true } },
      { id: "client-b", name: "Client B" },
      { id: "client-c", name: "Client C", attributes: { parentClientId: "client-a" } },
      { id: "client-d", name: "Client D" },
    ];

    const payload = await buildSessionPayload("manager-1", "manager", {
      prismaClient,
      isPrismaAvailableFn: () => true,
      listClientsFn: async () => clients,
    });

    assert.deepEqual(
      payload.clients.map((client) => client.id).sort(),
      ["client-a", "client-b", "client-c"].sort(),
    );
  });
});

describe("deleteUser cleanup", () => {
  it("deletes user preferences before removing user", async () => {
    const calls = [];
    const prismaClient = {
      userPreference: {
        deleteMany: async () => {
          calls.push("prefs");
          return { count: 1 };
        },
      },
      user: {
        delete: async () => {
          calls.push("user");
          return {
            id: "user-1",
            name: "User One",
            email: "user@client.com",
            username: "user",
            role: "user",
            passwordHash: "hashed",
          };
        },
      },
    };

    const result = await deleteUser("user-1", { prismaClient });

    assert.deepEqual(calls, ["prefs", "user"]);
    assert.equal(result.passwordHash, undefined);
    assert.equal(result.id, "user-1");
  });
});
