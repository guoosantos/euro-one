import { after, afterEach, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import createError from "http-errors";

import app from "../app.js";
import { __resetAuthRouteDeps, __setAuthRouteDeps } from "../routes/auth.js";

let server;
let baseUrl;

before(async () => {
  server = app.listen(0);
  await once(server, "listening");
  const { port } = server.address();
  baseUrl = `http://127.0.0.1:${port}`;
});

after(() => {
  if (server) {
    server.close();
  }
});

afterEach(() => {
  __resetAuthRouteDeps();
});

async function postLogin(payload) {
  const response = await fetch(`${baseUrl}/api/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await response.json();
  return { status: response.status, body: data };
}

describe("POST /api/login", () => {
  it("returns token and user on success", async () => {
    const user = {
      id: "user-1",
      name: "User One",
      email: "user@euro.one",
      username: "user",
      role: "admin",
      clientId: "client-1",
      attributes: {},
    };
    const payload = {
      user,
      client: { id: "client-1", name: "Client One" },
      clientId: "client-1",
      clients: [{ id: "client-1", name: "Client One" }],
    };

    __setAuthRouteDeps({
      authenticateWithTraccar: async () => ({ ok: true, user: { id: 123 } }),
      verifyUserCredentials: async () => user,
      sanitizeUser: (value) => value,
      buildSessionPayload: async () => payload,
      signSession: () => "token-123",
      isPrismaAvailable: () => true,
      shouldUseDemoFallback: () => false,
    });

    const response = await postLogin({ email: "user@euro.one", password: "secret" });

    assert.equal(response.status, 200);
    assert.equal(response.body.token, "token-123");
    assert.equal(response.body.user.id, "user-1");
    assert.equal(response.body.clientId, "client-1");
  });

  it("returns 400 when password is missing", async () => {
    const response = await postLogin({ email: "user@euro.one" });

    assert.equal(response.status, 400);
    assert.equal(response.body.error, "Campos obrigatórios: usuário e senha");
    assert.equal(response.body.errorCode, "MISSING_CREDENTIALS");
  });

  it("returns 401 when credentials are invalid", async () => {
    __setAuthRouteDeps({
      authenticateWithTraccar: async () => ({ ok: true, user: { id: 123 } }),
      verifyUserCredentials: async () => {
        throw createError(401, "Credenciais inválidas");
      },
    });

    const response = await postLogin({ email: "user@euro.one", password: "wrong" });

    assert.equal(response.status, 401);
    assert.equal(response.body.error, "Usuário ou senha inválidos");
    assert.equal(response.body.errorCode, "INVALID_CREDENTIALS");
  });

  it("returns 503 when database is unavailable and fallback is disabled", async () => {
    __setAuthRouteDeps({
      authenticateWithTraccar: async () => ({ ok: true, user: null }),
      verifyUserCredentials: async () => {
        const error = createError(503, "Banco de dados indisponível");
        error.code = "DATABASE_UNAVAILABLE";
        throw error;
      },
      isPrismaAvailable: () => false,
      shouldUseDemoFallback: () => false,
    });

    const response = await postLogin({ email: "user@euro.one", password: "secret" });

    assert.equal(response.status, 503);
    assert.equal(response.body.error, "Banco de dados indisponível ou mal configurado");
    assert.equal(response.body.errorCode, "DATABASE_UNAVAILABLE");
  });

  it("returns 502 when Traccar is unavailable", async () => {
    __setAuthRouteDeps({
      authenticateWithTraccar: async () => {
        throw createError(502, "Servidor Traccar indisponível");
      },
    });

    const response = await postLogin({ email: "user@euro.one", password: "secret" });

    assert.equal(response.status, 502);
    assert.equal(response.body.error, "Servidor Traccar indisponível");
    assert.equal(response.body.errorCode, "TRACCAR_UNAVAILABLE");
  });

  it("returns 400 when user has no tenant", async () => {
    const user = {
      id: "user-2",
      name: "Tenantless User",
      email: "tenantless@euro.one",
      username: "tenantless",
      role: "manager",
      clientId: null,
    };

    __setAuthRouteDeps({
      authenticateWithTraccar: async () => ({ ok: true, user: { id: 321 } }),
      verifyUserCredentials: async () => user,
      sanitizeUser: (value) => value,
      buildSessionPayload: async () => ({ user, clientId: null, clients: [] }),
      signSession: () => "token-tenantless",
      isPrismaAvailable: () => true,
      shouldUseDemoFallback: () => false,
    });

    const response = await postLogin({ email: "tenantless@euro.one", password: "secret" });

    assert.equal(response.status, 400);
    assert.equal(response.body.error, "Usuário sem tenant associado");
    assert.equal(response.body.errorCode, "MISSING_TENANT");
  });
});
