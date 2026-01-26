import { MIRROR_FALLBACK_PERMISSIONS } from "../middleware/permissions.js";
import { createGroup, listGroups, updateGroup } from "../models/group.js";
import { listMirrors, updateMirror } from "../models/mirror.js";

const DEFAULT_PERMISSION_GROUP_NAME = "MIRROR_TARGET_READ";
const DEFAULT_PERMISSION_GROUP_DESCRIPTION = "Permissões padrão para espelhamento (somente leitura).";

function buildDefaultPermissions() {
  return {
    ...MIRROR_FALLBACK_PERMISSIONS,
    admin: {
      users: {
        visible: true,
        access: "read",
        subpages: {
          "users-vehicle-groups": "full",
        },
      },
    },
  };
}

export function ensureMirrorPermissionGroup(clientId, { logger = console } = {}) {
  if (!clientId) {
    throw new Error("clientId é obrigatório para criar o grupo MIRROR_TARGET_READ.");
  }

  const permissions = buildDefaultPermissions();
  const attributes = {
    kind: "PERMISSION_GROUP",
    permissions,
  };

  const existing = listGroups({ clientId }).find((group) => group.name === DEFAULT_PERMISSION_GROUP_NAME);
  if (existing) {
    const updated = updateGroup(existing.id, {
      name: DEFAULT_PERMISSION_GROUP_NAME,
      description: DEFAULT_PERMISSION_GROUP_DESCRIPTION,
      attributes,
    });
    logger?.info?.("[mirror] grupo de permissão padrão atualizado", {
      groupId: updated.id,
      clientId: updated.clientId,
    });
    return updated;
  }

  const created = createGroup({
    name: DEFAULT_PERMISSION_GROUP_NAME,
    description: DEFAULT_PERMISSION_GROUP_DESCRIPTION,
    clientId,
    attributes,
  });
  logger?.info?.("[mirror] grupo de permissão padrão criado", {
    groupId: created.id,
    clientId: created.clientId,
  });
  return created;
}

export async function backfillMirrorPermissions({ logger = console } = {}) {
  const mirrors = listMirrors();
  const groupCache = new Map();
  let updated = 0;

  mirrors.forEach((mirror) => {
    if (mirror.permissionGroupId) return;

    const clientId = mirror.ownerClientId;
    if (!clientId) return;

    const cacheKey = String(clientId);
    let group = groupCache.get(cacheKey);
    if (!group) {
      group = ensureMirrorPermissionGroup(clientId, { logger });
      groupCache.set(cacheKey, group);
    }

    updateMirror(mirror.id, { permissionGroupId: group.id });
    updated += 1;
  });

  logger?.info?.("[mirror] backfill de permissionGroupId concluído", {
    total: mirrors.length,
    updated,
    groups: groupCache.size,
  });

  return { total: mirrors.length, updated, groups: groupCache.size };
}
