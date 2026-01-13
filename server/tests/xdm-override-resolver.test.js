import assert from "node:assert/strict";
import test from "node:test";

import { getGeozoneGroupOverrideConfigByRole } from "../services/xdm/xdm-override-resolver.js";

const ENV_KEYS = [
  "XDM_GEOZONE_GROUP_OVERRIDE_KEY",
  "XDM_GEOZONE_GROUP_OVERRIDE_KEYS",
  "XDM_GEOZONE_GROUP_OVERRIDE_KEY_ITINERARY",
  "XDM_GEOZONE_GROUP_OVERRIDE_KEY_TARGETS",
  "XDM_GEOZONE_GROUP_OVERRIDE_KEY_ENTRY",
  "XDM_GEOZONE_GROUP_OVERRIDE_KEY_1",
  "XDM_GEOZONE_GROUP_OVERRIDE_KEY_2",
  "XDM_GEOZONE_GROUP_OVERRIDE_KEY_3",
  "XDM_GEOZONE_GROUP_OVERRIDE_ID",
  "XDM_GEOZONE_GROUP_OVERRIDE_IDS",
  "XDM_GEOZONE_GROUP_OVERRIDE_ID_1",
  "XDM_GEOZONE_GROUP_OVERRIDE_ID_2",
  "XDM_GEOZONE_GROUP_OVERRIDE_ID_3",
  "XDM_GEOZONE_GROUP_OVERRIDE_ID_ITINERARY",
  "XDM_GEOZONE_GROUP_OVERRIDE_ID_TARGETS",
  "XDM_GEOZONE_GROUP_OVERRIDE_ID_ENTRY",
];

function withEnv(overrides, fn) {
  const snapshot = {};
  const keys = new Set([...ENV_KEYS, ...Object.keys(overrides || {})]);
  for (const key of keys) {
    snapshot[key] = Object.prototype.hasOwnProperty.call(process.env, key) ? process.env[key] : undefined;
  }

  for (const [key, value] of Object.entries(overrides || {})) {
    if (value == null) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  try {
    return fn();
  } finally {
    for (const key of keys) {
      if (snapshot[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = snapshot[key];
      }
    }
  }
}

test("resolve override keys from base key without index", () => {
  withEnv({
    XDM_GEOZONE_GROUP_OVERRIDE_KEY: "geoGroup",
    XDM_GEOZONE_GROUP_OVERRIDE_KEYS: null,
    XDM_GEOZONE_GROUP_OVERRIDE_KEY_1: null,
    XDM_GEOZONE_GROUP_OVERRIDE_KEY_2: null,
    XDM_GEOZONE_GROUP_OVERRIDE_KEY_3: null,
    XDM_GEOZONE_GROUP_OVERRIDE_KEY_ITINERARY: null,
    XDM_GEOZONE_GROUP_OVERRIDE_KEY_TARGETS: null,
    XDM_GEOZONE_GROUP_OVERRIDE_KEY_ENTRY: null,
  }, () => {
    const itinerary = getGeozoneGroupOverrideConfigByRole("itinerary");
    const targets = getGeozoneGroupOverrideConfigByRole("targets");
    const entry = getGeozoneGroupOverrideConfigByRole("entry");

    assert.equal(itinerary.overrideKey, "geoGroup1");
    assert.equal(targets.overrideKey, "geoGroup2");
    assert.equal(entry.overrideKey, "geoGroup3");
  });
});

test("base override key with index only applies to matching role", () => {
  withEnv({
    XDM_GEOZONE_GROUP_OVERRIDE_KEY: "geoGroup1",
    XDM_GEOZONE_GROUP_OVERRIDE_KEYS: null,
    XDM_GEOZONE_GROUP_OVERRIDE_KEY_1: null,
    XDM_GEOZONE_GROUP_OVERRIDE_KEY_2: null,
    XDM_GEOZONE_GROUP_OVERRIDE_KEY_3: null,
    XDM_GEOZONE_GROUP_OVERRIDE_KEY_ITINERARY: null,
    XDM_GEOZONE_GROUP_OVERRIDE_KEY_TARGETS: null,
    XDM_GEOZONE_GROUP_OVERRIDE_KEY_ENTRY: null,
  }, () => {
    const itinerary = getGeozoneGroupOverrideConfigByRole("itinerary");
    const targets = getGeozoneGroupOverrideConfigByRole("targets");
    const entry = getGeozoneGroupOverrideConfigByRole("entry");

    assert.equal(itinerary.overrideKey, "geoGroup1");
    assert.equal(targets.overrideKey, "geoGroup2");
    assert.equal(entry.overrideKey, "geoGroup3");
  });
});
