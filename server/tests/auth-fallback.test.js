import { before, after, describe, it } from "node:test";
import assert from "node:assert/strict";

const originalEnv = { ...process.env };
let buildSessionPayload;

before(async () => {
  process.env.ENABLE_DEMO_FALLBACK = "true";
  process.env.DEMO_LOGIN_ONLY = "false";
  const authModule = await import("../routes/auth.js");
  buildSessionPayload = authModule.buildSessionPayload;
});

after(() => {
  Object.keys(process.env).forEach((key) => {
    if (Object.prototype.hasOwnProperty.call(originalEnv, key)) {
      process.env[key] = originalEnv[key];
    } else {
      delete process.env[key];
    }
  });
});

describe("buildSessionPayload fallback handling", () => {
  it("does not return demo-client when Prisma throws", async () => {
    const prismaClient = {
      user: {
        findUnique: async () => {
          throw new Error("boom");
        },
      },
      userPreference: {
        findUnique: async () => null,
        upsert: async () => null,
      },
    };

    await assert.rejects(
      () =>
        buildSessionPayload("user-1", "admin", {
          prismaClient,
          isPrismaAvailableFn: () => true,
          listClientsFn: async () => [],
        }),
      (error) => {
        assert.equal(error.status, 500);
        return true;
      },
    );
  });

  it("keeps the real client when Prisma está disponível mesmo com fallback habilitado", async () => {
    const prismaClient = {
      user: {
        findUnique: async () => ({
          id: "user-1",
          name: "User One",
          email: "user@client.com",
          username: "user",
          role: "manager",
          clientId: "real-client",
          client: { id: "real-client", name: "Real Client" },
          attributes: {},
        }),
      },
      userPreference: {
        findUnique: async () => null,
        upsert: async () => null,
      },
    };

    const payload = await buildSessionPayload("user-1", "manager", {
      prismaClient,
      isPrismaAvailableFn: () => true,
      listClientsFn: async () => [{ id: "real-client", name: "Real Client" }],
    });

    assert.equal(payload.clientId, "real-client");
    assert.equal(payload.client?.id, "real-client");
    assert.equal(payload.user.clientId, "real-client");
  });

  it("falls back to demo-client when Prisma is unavailable and fallback is allowed", async () => {
    const payload = await buildSessionPayload("user-1", "admin", {
      prismaClient: {},
      isPrismaAvailableFn: () => false,
    });

    assert.equal(payload.clientId, "demo-client");
    assert.equal(payload.client?.id, "demo-client");
    assert.equal(payload.user?.clientId, "demo-client");
  });
});
