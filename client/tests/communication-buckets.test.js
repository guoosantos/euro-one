import test from "node:test";
import assert from "node:assert";

import { bucketCommunicationAge, groupByCommunication, COMMUNICATION_BUCKETS } from "../../server/utils/communication-buckets.js";

test("bucketCommunicationAge categoriza corretamente", () => {
  const now = Date.parse("2024-01-01T12:00:00Z");
  const oneHourAgo = now - 60 * 60 * 1000;
  const fiveHoursAgo = now - 5 * 60 * 60 * 1000;
  const twoDaysAgo = now - 48 * 60 * 60 * 1000;
  const fortyDaysAgo = now - 40 * 24 * 60 * 60 * 1000;

  assert.strictEqual(bucketCommunicationAge(oneHourAgo, { now }).key, "0-1h");
  assert.strictEqual(bucketCommunicationAge(fiveHoursAgo, { now }).key, "1-6h");
  assert.strictEqual(bucketCommunicationAge(twoDaysAgo, { now }).key, "24-72h");
  assert.strictEqual(bucketCommunicationAge(fortyDaysAgo, { now }).key, "30d+");
});

test("groupByCommunication agrega dispositivos nas faixas", () => {
  const now = Date.parse("2024-01-01T12:00:00Z");
  const devices = [
    { id: "1", lastCommunication: new Date(now - 30 * 60 * 1000).toISOString() },
    { id: "2", lastUpdate: new Date(now - 7 * 60 * 60 * 1000).toISOString() },
    { id: "3", lastUpdate: new Date(now - 5 * 24 * 60 * 60 * 1000).toISOString() },
  ];

  const groups = groupByCommunication(devices, { now });
  const byKey = new Map(groups.map((g) => [g.bucket.key, g.items]));

  assert.strictEqual(byKey.get("0-1h").length, 1);
  assert.strictEqual(byKey.get("6-12h").length, 1);
  assert.strictEqual(byKey.get("72h-10d").length, 1);
  assert.strictEqual(byKey.get("30d+").length, 0);
  // todas as faixas devem existir
  assert.strictEqual(groups.length, COMMUNICATION_BUCKETS.length);
});
