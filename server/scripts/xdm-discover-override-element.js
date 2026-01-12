#!/usr/bin/env node
import { initStorage } from "../services/storage.js";
import { discoverGeozoneGroupOverrideElementId } from "../services/xdm/xdm-override-resolver.js";

async function run() {
  await initStorage();
  const correlationId = `xdm-override-discovery-${Date.now()}`;
  const result = await discoverGeozoneGroupOverrideElementId({ correlationId });
  console.log(
    `Override elementId encontrado: ${result.overrideId} (dealerId=${result.dealerId}, configName=${result.configName}, key=${result.overrideKey})`,
  );
}

run().catch((error) => {
  console.error("[xdm] Falha ao descobrir override elementId", error?.message || error);
  process.exit(1);
});
