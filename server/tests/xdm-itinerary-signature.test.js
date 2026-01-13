import assert from "node:assert/strict";
import test from "node:test";

import {
  buildItinerarySignature,
  buildItinerarySignatureInput,
  buildGroupHashSummary,
} from "../services/xdm/xdm-itinerary-signature.js";

test("buildItinerarySignature é determinístico e não retorna zero", () => {
  const groupHashes = { itinerary: "abc", targets: "def", entry: "ghi" };
  const signatureA = buildItinerarySignature({ itineraryId: 10, groupHashes });
  const signatureB = buildItinerarySignature({ itineraryId: 10, groupHashes });

  assert.equal(signatureA, signatureB);
  assert.equal(Number.isInteger(signatureA), true);
  assert.equal(signatureA >= 1, true);
  assert.equal(signatureA <= 0xffffffff, true);
});

test("buildItinerarySignatureInput inclui itineraryId e hashes na ordem esperada", () => {
  const groupHashes = { itinerary: "it", targets: "tg", entry: "en" };
  const input = buildItinerarySignatureInput({ itineraryId: "55", groupHashes });
  assert.equal(input, "55|it|tg|en");
  assert.equal(buildGroupHashSummary(groupHashes), "itinerary=it|targets=tg|entry=en");
});
