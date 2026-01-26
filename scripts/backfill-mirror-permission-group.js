import { backfillMirrorPermissions } from "../server/scripts/backfill-mirror-permissions.js";

backfillMirrorPermissions()
  .then((summary) => {
    console.info("[mirror] backfill concluído", summary);
  })
  .catch((error) => {
    console.error("[mirror] falha no backfill", error?.message || error);
    process.exitCode = 1;
  });
