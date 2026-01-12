import { loadEnv } from "../server/utils/env.js";
import { initStorage } from "../server/services/storage.js";
import { syncItineraryXdm } from "../server/services/xdm/itinerary-sync-service.js";

await loadEnv();
await initStorage();

const itineraryId = process.argv[2];
const clientId = process.argv[3] || null;

if (!itineraryId) {
  console.error("Uso: node scripts/xdm-sync-itinerary.js <itineraryId> [clientId]");
  process.exit(1);
}

try {
  const result = await syncItineraryXdm(itineraryId, {
    clientId,
    correlationId: "xdm-sync-manual",
  });
  console.log("[xdm-sync] ok", {
    itineraryId,
    xdmGeozoneGroupId: result.xdmGeozoneGroupId,
    groupHash: result.groupHash,
  });
} catch (error) {
  console.error("[xdm-sync] falha ao sincronizar", {
    itineraryId,
    message: error?.message || error,
  });
  process.exit(1);
}
