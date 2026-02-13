import { resolveAllowedMirrorOwnerIds } from "./mirror-access.js";
import { resolveTenantScope } from "./tenant-scope.js";

export async function resolveMePermissions(user) {
  const scope = await resolveTenantScope(user);
  const allowedMirrorOwners = resolveAllowedMirrorOwnerIds(user);
  const mirrorAllowAll = allowedMirrorOwners === null;
  const mirrorOwnerIds = Array.isArray(allowedMirrorOwners)
    ? allowedMirrorOwners.map((id) => String(id))
    : [];
  const clientIds = scope.isAdmin
    ? null
    : Array.from(scope.clientIds || []).map((id) => String(id));
  return {
    isAdmin: Boolean(scope.isAdmin),
    clientIds,
    mirrorAllowAll,
    mirrorOwnerIds,
  };
}

export default resolveMePermissions;
