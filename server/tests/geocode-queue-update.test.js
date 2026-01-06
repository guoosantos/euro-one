import test from "node:test";
import assert from "node:assert/strict";

process.env.NODE_ENV = "test";
process.env.GEOCODE_QUEUE_DISABLED = "true";

const { enqueueGeocodeJob, buildGridKey, getGeocodeQueue, closeGeocodeQueue } = await import(
  "../jobs/geocode.queue.js"
);

test("enqueueGeocodeJob atualiza dados do job existente", async (t) => {
  t.after(async () => {
    await closeGeocodeQueue();
  });

  const lat = -23.55052;
  const lng = -46.633308;
  const gridKey = buildGridKey(lat, lng);
  const gridJobId = `geocode:grid:${gridKey}`;

  await enqueueGeocodeJob({ positionId: 101, lat, lng, reason: "initial" });
  await enqueueGeocodeJob({ positionId: 202, lat, lng, reason: "merge" });

  const queue = getGeocodeQueue();
  const job = await queue.getJob(gridJobId);

  assert.ok(job, "job existente deve permanecer após atualização");
  assert.deepEqual(job.data.positionIds.sort(), ["101", "202"]);
  assert.equal(job.data.positionId, 202);
  assert.equal(job.data.reason, "merge");
});
