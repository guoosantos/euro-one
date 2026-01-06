import assert from "node:assert/strict";
import test from "node:test";
import buildPositionsSchema from "../../shared/buildPositionsSchema.js";
import { resolveColumn, resolveColumnLabel } from "../../shared/positionsColumns.js";
import { resolveEventDescriptor } from "../../shared/telemetryDictionary.js";

test("does not include generic IO columns without values and dedupes by key", () => {
  const schemaWithoutValues = buildPositionsSchema([
    { gpsTime: "2024-01-01T00:00:00Z", attributes: { protocol: "teltonika" } },
  ]);
  const keysWithoutValues = schemaWithoutValues.map((c) => c.key);
  assert.ok(!keysWithoutValues.includes("digitalInput1"), "should not list digitalInput1 without data");

  const schemaWithValues = buildPositionsSchema([
    {
      gpsTime: "2024-01-01T00:00:00Z",
      digitalInput2: false,
      attributes: { temperature: 22.5, digitalInput2: false },
    },
  ]);
  const keysWithValues = schemaWithValues.map((c) => c.key);
  assert.deepEqual(
    keysWithValues.filter((key) => key === "digitalInput2"),
    ["digitalInput2"],
    "digitalInput2 should appear only once",
  );
  assert.ok(keysWithValues.includes("temperature"), "dynamic attribute should be present when value exists");
});

test("resolves IO and event labels from dictionaries", () => {
  const ioColumn = resolveColumn("io157");
  assert.equal(resolveColumnLabel(ioColumn, "pt"), "Freio de estacionamento");

  const eventDescriptor = resolveEventDescriptor("136", { protocol: "gt06" });
  assert.equal(eventDescriptor?.labelPt, "Farol baixo");
});
