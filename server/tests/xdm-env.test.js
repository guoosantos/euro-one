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

async function withProductionEnvFile(contents, fn) {
  const envPath = "/home/ubuntu/euro-one/server/.env";
  let previous = null;
  try {
    previous = await fs.readFile(envPath, "utf8");
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }

  await fs.mkdir(path.dirname(envPath), { recursive: true });
  await fs.writeFile(envPath, contents, "utf8");

  try {
    await fn();
  } finally {
    if (previous == null) {
      await fs.rm(envPath, { force: true });
    } else {
      await fs.writeFile(envPath, previous, "utf8");
    }
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

test("loadEnv sobrescreve env em produção quando override está ativo", async () => {
  await withTempEnv({ NODE_ENV: "production", XDM_AUTH_URL: "https://old.example" }, async () => {
    await withProductionEnvFile("XDM_AUTH_URL=https://new.example\n", async () => {
      const { loadEnv } = await import(`../utils/env.js?prod-override-${Date.now()}`);
      await loadEnv();
      assert.equal(process.env.XDM_AUTH_URL, "https://new.example");
    });
  });
});
