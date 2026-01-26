import {
  backfillMirrorPermissions,
  ensureMirrorPermissionGroup,
} from "../scripts/backfill-mirror-permissions.js";

export { ensureMirrorPermissionGroup };

export async function backfillMirrorPermissionGroups({ logger = console } = {}) {
  return backfillMirrorPermissions({ logger });
}
