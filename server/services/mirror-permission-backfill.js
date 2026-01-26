import { MIRROR_FALLBACK_PERMISSIONS } from "../middleware/permissions.js";
import { getAdminGeneralClient, listClients } from "../models/client.js";
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

async function resolvePermissionGroupClientId() {
  const adminGeneral = await getAdminGeneralClient().catch(() => null);
  if (adminGeneral?.id) return adminGeneral.id;
  const clients = await listClients();
  if (!clients.length) {
    throw new Error("Nenhum cliente disponível para criar o grupo MIRROR_TARGET_READ.");
  }
  return clients[0].id;
}

export async function ensureMirrorPermissionGroup({ logger = console } = {}) {
  const permissions = buildDefaultPermissions();
  const attributes = {
    kind: "PERMISSION_GROUP",
    scope: "global",
    permissions,
  };

  const existing = listGroups().find((group) => group.name === DEFAULT_PERMISSION_GROUP_NAME);
  if (existing) {
    const updated = updateGroup(existing.id, {
      name: DEFAULT_PERMISSION_GROUP_NAME,
      description: DEFAULT_PERMISSION_GROUP_DESCRIPTION,
      attributes,
    });
    if (logger?.info) {
      logger.info("[mirror] grupo de permissão padrão atualizado", { groupId: updated.id });
    }
    return updated;
  }

  const clientId = await resolvePermissionGroupClientId();
  const created = createGroup({
    name: DEFAULT_PERMISSION_GROUP_NAME,
    description: DEFAULT_PERMISSION_GROUP_DESCRIPTION,
    clientId,
    attributes,
  });
  if (logger?.info) {
    logger.info("[mirror] grupo de permissão padrão criado", { groupId: created.id, clientId });
  }
  return created;
}

export async function backfillMirrorPermissionGroups({ logger = console } = {}) {
  const group = await ensureMirrorPermissionGroup({ logger });
  const mirrors = listMirrors();
  const missing = mirrors.filter((mirror) => !mirror.permissionGroupId);
  missing.forEach((mirror) => {
    updateMirror(mirror.id, { permissionGroupId: group.id });
  });
  if (logger?.info) {
    logger.info("[mirror] backfill de permissionGroupId concluído", {
      total: mirrors.length,
      updated: missing.length,
      groupId: group.id,
    });
  }
  return { total: mirrors.length, updated: missing.length, groupId: group.id };
}

