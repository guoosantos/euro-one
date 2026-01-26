import { backfillMirrorPermissionGroups } from "../server/services/mirror-permission-backfill.js";

backfillMirrorPermissionGroups()
  .then((summary) => {
    console.info("[mirror] backfill concluído", summary);
  })
  .catch((error) => {
    console.error("[mirror] falha no backfill", error?.message || error);
    process.exitCode = 1;
  });

