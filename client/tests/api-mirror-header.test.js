import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
import { JSDOM } from "jsdom";

import api, { clearStoredSession, setStoredSession } from "../src/lib/api.js";

function setupDom() {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost" });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  Object.defineProperty(globalThis, "navigator", {
    value: dom.window.navigator,
    configurable: true,
  });
  return dom;
}

afterEach(() => {
  clearStoredSession();
  delete globalThis.window;
  delete globalThis.document;
  delete globalThis.navigator;
  delete globalThis.fetch;
});

test("api adiciona X-Owner-Client-Id em chamadas do modo espelho", async () => {
  setupDom();
  setStoredSession({
    token: "token",
    user: { id: "user-1", role: "user", activeMirrorOwnerClientId: "owner-123" },
  });

  const captured = [];
  globalThis.fetch = async (_url, init) => {
    const headers = new Headers(init?.headers);
    captured.push(headers.get("X-Owner-Client-Id"));
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  const endpoints = ["/alerts", "/positions/last", "/events", "/devices"];
  for (const endpoint of endpoints) {
    await api.get(endpoint);
  }

  assert.deepEqual(captured, ["owner-123", "owner-123", "owner-123", "owner-123"]);
});

test("api substitui clientId explícito pelo owner em modo espelho", async () => {
  setupDom();
  setStoredSession({
    token: "token",
    user: { id: "user-5", role: "user", activeMirrorOwnerClientId: "owner-555", mirrorContextMode: "target" },
  });

  let capturedUrl = "";
  globalThis.fetch = async (url) => {
    capturedUrl = String(url);
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  await api.get("/positions/last", {
    params: { clientId: "target-1", tenantId: "target-2", foo: "bar" },
  });

  const parsed = new URL(capturedUrl);
  assert.equal(parsed.searchParams.get("clientId"), "owner-555");
  assert.equal(parsed.searchParams.get("tenantId"), null);
  assert.equal(parsed.searchParams.get("foo"), "bar");
});

test("api envia X-Owner-Client-Id com mirrorContextMode indefinido quando owner está salvo", async () => {
  const dom = setupDom();
  dom.window.localStorage.setItem("euro-one.mirror.owner-client-id", "owner-storage-1");
  setStoredSession({
    token: "token",
    user: { id: "user-4", role: "user" },
  });

  let headerValue = "unset";
  globalThis.fetch = async (_url, init) => {
    const headers = new Headers(init?.headers);
    headerValue = headers.get("X-Owner-Client-Id");
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  await api.get("/alerts");

  assert.equal(headerValue, "owner-storage-1");
});

test("api não adiciona X-Owner-Client-Id quando mirror não está ativo", async () => {
  setupDom();
  setStoredSession({ token: "token", user: { id: "user-2", role: "user", activeMirrorOwnerClientId: null } });

  let headerValue = "unset";
  globalThis.fetch = async (_url, init) => {
    const headers = new Headers(init?.headers);
    headerValue = headers.get("X-Owner-Client-Id");
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  await api.get("/alerts");

  assert.equal(headerValue, null);
});

test("api não adiciona X-Owner-Client-Id para endpoints fora da allowlist", async () => {
  setupDom();
  setStoredSession({
    token: "token",
    user: { id: "user-3", role: "user", activeMirrorOwnerClientId: "owner-321", mirrorContextMode: "owner" },
  });

  let headerValue = "unset";
  globalThis.fetch = async (_url, init) => {
    const headers = new Headers(init?.headers);
    headerValue = headers.get("X-Owner-Client-Id");
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  await api.get("/session");

  assert.equal(headerValue, null);
});

test("api não adiciona X-Owner-Client-Id para admins mesmo com owner ativo", async () => {
  setupDom();
  setStoredSession({
    token: "token",
    user: { id: "admin-1", role: "admin", activeMirrorOwnerClientId: "owner-999" },
  });

  let headerValue = "unset";
  globalThis.fetch = async (_url, init) => {
    const headers = new Headers(init?.headers);
    headerValue = headers.get("X-Owner-Client-Id");
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  await api.get("/alerts");

  assert.equal(headerValue, null);
});
