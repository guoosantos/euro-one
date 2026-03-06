import test from "node:test";
import assert from "node:assert/strict";

import { __resetStorageForTests, loadCollection, saveCollection } from "../services/storage.js";
import {
  createTrustCounterKey,
  listTrustCounterKeys,
  listTrustUserOptions,
  listTrustUsers,
  useTrustCounterKey,
} from "../services/trust-center.js";

function seedBaseData() {
  saveCollection("users", [
    {
      id: "11111111-1111-4111-8111-111111111111",
      name: "Operador A",
      role: "manager",
      clientId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    },
    {
      id: "22222222-2222-4222-8222-222222222222",
      name: "Operador B",
      role: "user",
      clientId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    },
    {
      id: "33333333-3333-4333-8333-333333333333",
      name: "Operador C",
      role: "user",
      clientId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    },
  ]);
  saveCollection("clients", [
    {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      name: "Cliente Teste",
    },
  ]);
  saveCollection("vehicles", [
    {
      id: "44444444-4444-4444-8444-444444444444",
      clientId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      plate: "ABC1234",
      name: "Veículo Teste",
    },
  ]);
  saveCollection("devices", [
    {
      id: "55555555-5555-4555-8555-555555555555",
      clientId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      name: "ESP32-TESTE",
      uniqueId: "ESP32-001",
    },
  ]);
}

test("listTrustUsers aplica prioridade de estado ONLINE -> TENTANDO -> ACESSO_REGISTRADO", () => {
  __resetStorageForTests();
  seedBaseData();

  const payload = listTrustUsers({ page: 1, pageSize: 20 });
  const priorities = payload.items.map((item) => item.state);
  const ranks = priorities.map((state) => ["ONLINE", "TENTANDO", "ACESSO_REGISTRADO"].indexOf(state));

  for (let index = 1; index < ranks.length; index += 1) {
    assert.ok(ranks[index] >= ranks[index - 1]);
  }
});

test("create/use counter-key mantém senha base apenas em hash e atualiza status", () => {
  __resetStorageForTests();
  seedBaseData();

  const options = listTrustUserOptions({});
  assert.ok(options.users.length > 0);

  const created = createTrustCounterKey({
    userId: options.users[0].id,
    vehicle: "ABC1234",
    basePassword: "123456",
    actor: { id: "admin-1", name: "Admin" },
  });

  assert.equal(created.basePasswordMasked, "••••••");

  const stored = loadCollection("trustCenter.counterKeys", []);
  assert.equal(stored.length, 1);
  assert.notEqual(stored[0].basePasswordHash, "123456");

  const used = useTrustCounterKey({
    id: created.id,
    usedBy: { id: "user-x", name: "Operador de Campo" },
  });

  assert.equal(used.status, "USADA");
  assert.equal(used.usesCount, 1);

  const listed = listTrustCounterKeys({ page: 1, pageSize: 20 });
  assert.equal(listed.items[0].status, "USADA");
});
