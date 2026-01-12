import { loadEnv } from "../server/utils/env.js";
import { initStorage } from "../server/services/storage.js";
import {
  getGeozoneGroupOverrideConfig,
  resolveGeozoneGroupOverrideElementId,
} from "../server/services/xdm/xdm-override-resolver.js";

await loadEnv();
await initStorage();

const config = getGeozoneGroupOverrideConfig();
if (!config.overrideKey) {
  console.error("[xdm-discover] override key ausente. Configure XDM_GEOZONE_GROUP_OVERRIDE_KEY.");
  process.exit(1);
}

try {
  const result = await resolveGeozoneGroupOverrideElementId({ correlationId: "xdm-override-discovery-cli" });
  console.log("[xdm-discover] userElementId encontrado:", {
    overrideId: result.overrideId,
    overrideKey: result.overrideKey,
    source: result.source,
  });
} catch (error) {
  console.error("[xdm-discover] falha ao descobrir overrideId", {
    message: error?.message || error,
  });
  process.exit(1);
}
