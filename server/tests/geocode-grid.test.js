import assert from "node:assert/strict";
import test from "node:test";

import { buildGridKey } from "../jobs/geocode.queue.js";

test("buildGridKey usa precisão padrão (4 casas)", () => {
  const key = buildGridKey(-23.55052, -46.633308);
  assert.equal(key, "-23.5505,-46.6333");
});
