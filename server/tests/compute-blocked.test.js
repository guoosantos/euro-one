import assert from "node:assert/strict";
import test from "node:test";
import { computeBlocked } from "../../shared/computeBlocked.js";

test("computeBlocked applies the IO rule for all combinations", () => {
  const cases = [
    { input2: false, input4: false, out1: false, expected: "Sim" },
    { input2: false, input4: false, out1: true, expected: "Não" },
    { input2: false, input4: true, out1: false, expected: "Sim" },
    { input2: false, input4: true, out1: true, expected: "Sim" },
    { input2: true, input4: false, out1: false, expected: "Sim" },
    { input2: true, input4: false, out1: true, expected: "Sim" },
    { input2: true, input4: true, out1: false, expected: "Sim" },
    { input2: true, input4: true, out1: true, expected: "Sim" },
  ];

  cases.forEach(({ input2, input4, out1, expected }) => {
    assert.equal(computeBlocked({ input2, input4, out1 }), expected);
  });
});

test("computeBlocked returns Sim when inputs are missing", () => {
  assert.equal(computeBlocked({ input2: true, input4: false, out1: null }), "Sim");
  assert.equal(computeBlocked({ input2: undefined, input4: false, out1: true }), "Sim");
  assert.equal(computeBlocked({ input2: false, input4: undefined, out1: true }), "Sim");
  assert.equal(computeBlocked({ input2: false, input4: false, out1: undefined }), "Sim");
});
