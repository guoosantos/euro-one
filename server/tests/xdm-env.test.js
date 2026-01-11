import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

async function withTempEnvFile(contents, fn) {
  const baseDir = await fs.mkdtemp(path.join(os.tmpdir(), "xdm-env-"));
  const envPath = path.join(baseDir, ".env");
  const previousCwd = process.cwd();
  await fs.writeFile(envPath, contents, "utf8");
  process.chdir(baseDir);
  try {
    await fn();
  } finally {
    process.chdir(previousCwd);
  }
}

async function withTempEnv(vars, fn) {
  const previous = {};
  Object.keys(vars).forEach((key) => {
    previous[key] = process.env[key];
    if (vars[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = vars[key];
    }
  });
  try {
    await fn();
  } finally {
    Object.keys(vars).forEach((key) => {
      if (previous[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = previous[key];
      }
    });
  }
}

test("loadEnv remove aspas em XDM_CONFIG_NAME", async () => {
  await withTempEnv({ NODE_ENV: "test", XDM_CONFIG_NAME: undefined }, async () => {
    await withTempEnvFile('XDM_CONFIG_NAME="Config XDM 01"\n', async () => {
      const { loadEnv } = await import(`../utils/env.js?quoted-${Date.now()}`);
      await loadEnv();
      assert.equal(process.env.XDM_CONFIG_NAME, "Config XDM 01");
    });
  });
});

test("loadEnv não sobrescreve XDM_CONFIG_NAME já definido", async () => {
  await withTempEnv({ NODE_ENV: "test", XDM_CONFIG_NAME: "Config Atual" }, async () => {
    await withTempEnvFile('XDM_CONFIG_NAME="Config Nova"\n', async () => {
      const { loadEnv } = await import(`../utils/env.js?no-override-${Date.now()}`);
      await loadEnv();
      assert.equal(process.env.XDM_CONFIG_NAME, "Config Atual");
    });
  });
});
