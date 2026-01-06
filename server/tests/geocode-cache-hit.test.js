import assert from "node:assert/strict";
import test, { mock } from "node:test";

import { incrementGeocodeCacheHit } from "../utils/address.js";

const updateMany = mock.fn(async () => ({ count: 0 }));
const create = mock.fn(async () => ({ key: "geo:key", hitsCount: 1 }));

const prismaClient = {
  geocodeCache: {
    updateMany,
    create,
  },
};

test("incrementGeocodeCacheHit cria registro quando cache não existe", async () => {
  await incrementGeocodeCacheHit("geo:key", { prismaClient, dbAvailable: true });

  assert.equal(updateMany.mock.callCount(), 1);
  assert.deepEqual(updateMany.mock.calls[0].arguments[0], {
    where: { key: "geo:key" },
    data: { hitsCount: { increment: 1 } },
  });
  assert.equal(create.mock.callCount(), 1);
  assert.deepEqual(create.mock.calls[0].arguments[0], {
    data: {
      key: "geo:key",
      data: { key: "geo:key" },
      hitsCount: 1,
    },
  });
});

test("incrementGeocodeCacheHit não cria registro quando updateMany encontra entrada", async () => {
  updateMany.mock.mockImplementationOnce(async () => ({ count: 1 }));

  await incrementGeocodeCacheHit("geo:key", { prismaClient, dbAvailable: true });

  assert.equal(updateMany.mock.callCount(), 2);
  assert.equal(create.mock.callCount(), 1);
});
