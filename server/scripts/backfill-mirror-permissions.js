import { listMirrors, updateMirror } from "../models/mirror.js";
import { listGroups, createGroup, updateGroup, getGroupById } from "../models/group.js";
import { MIRROR_FALLBACK_PERMISSIONS } from "../middleware/permissions.js";

/*
 * Script de backfill para garantir que todos os espelhos tenham um grupo de permissão associado.
 * Ele cria (ou reutiliza) um grupo padrão por owner chamado "MIRROR_TARGET_READ" baseado nas permissões de fallback,
 * adicionando permissão total para a subpágina de grupos de veículos (users-vehicle-groups).
 */

const DEFAULT_GROUP_NAME = "MIRROR_TARGET_READ";
const DEFAULT_GROUP_KIND = "PERMISSION_GROUP";
const DEFAULT_GROUP_DESCRIPTION =
  "Grupo padrão de leitura para espelho (inclui criação de grupos de veículos)";

function buildDefaultMirrorPermissions() {
  const perms = JSON.parse(JSON.stringify(MIRROR_FALLBACK_PERMISSIONS));
  perms.admin = perms.admin || {};
  perms.admin.users = perms.admin.users || {};
  perms.admin.users.visible = true;
  perms.admin.users.access = "read";
  perms.admin.users.subpages = perms.admin.users.subpages || {};
  perms.admin.users.subpages["users-vehicle-groups"] = "full";
  perms.primary = perms.primary || {};
  perms.primary.monitoring = perms.primary.monitoring || {};
  perms.primary.monitoring.visible = true;
  perms.primary.monitoring.access = "read";
  perms.primary.monitoring.subpages = perms.primary.monitoring.subpages || {};
  if (!perms.primary.monitoring.subpages.positions) {
    perms.primary.monitoring.subpages.positions = "read";
  }
  if (!perms.primary.monitoring.subpages.telemetry) {
    perms.primary.monitoring.subpages.telemetry = "read";
  }
  if (!perms.primary.monitoring.subpages.alerts) {
    perms.primary.monitoring.subpages.alerts = "read";
  }
  if (!perms.primary.monitoring.subpages["alerts-conjugated"]) {
    perms.primary.monitoring.subpages["alerts-conjugated"] = "read";
  }
  return perms;
}

function normalizePermissions(value) {
  if (Array.isArray(value)) {
    return value.map((item) => normalizePermissions(item));
  }
  if (value && typeof value === "object") {
    return Object.keys(value)
      .sort()
      .reduce((acc, key) => {
        acc[key] = normalizePermissions(value[key]);
        return acc;
      }, {});
  }
  return value;
}

function arePermissionsEqual(left, right) {
  return JSON.stringify(normalizePermissions(left)) === JSON.stringify(normalizePermissions(right));
}

function resolveLogger(opts = {}) {
  const logger = opts?.logger || console;
  return {
    info: typeof logger?.info === "function" ? logger.info.bind(logger) : console.info.bind(console),
    warn: typeof logger?.warn === "function" ? logger.warn.bind(logger) : console.warn.bind(console),
  };
}

export async function backfillMirrorPermissions(opts = {}) {
  const logger = resolveLogger(opts);
  const defaultPermissions = buildDefaultMirrorPermissions();
  const mirrors = listMirrors();
  for (const mirror of mirrors) {
    if (mirror.permissionGroupId) {
      const existingGroup = getGroupById(mirror.permissionGroupId);
      if (
        existingGroup?.attributes?.kind === DEFAULT_GROUP_KIND &&
        existingGroup?.name === DEFAULT_GROUP_NAME
      ) {
        const currentPermissions = existingGroup?.attributes?.permissions || {};
        if (!arePermissionsEqual(currentPermissions, defaultPermissions)) {
          updateGroup(existingGroup.id, {
            description: existingGroup.description || DEFAULT_GROUP_DESCRIPTION,
            attributes: {
              ...existingGroup.attributes,
              kind: DEFAULT_GROUP_KIND,
              permissions: defaultPermissions,
            },
          });
          logger.info(
            `[mirror] grupo ${DEFAULT_GROUP_NAME} atualizado para espelho ${mirror.id}`,
          );
        }
      }
      continue;
    }
    const ownerId = mirror.ownerClientId;
    const groups = listGroups({ clientId: ownerId });
    let defaultGroup = groups.find(
      (g) =>
        g?.attributes?.kind === DEFAULT_GROUP_KIND &&
        g?.name === DEFAULT_GROUP_NAME &&
        String(g.clientId) === String(ownerId),
    );
    if (!defaultGroup) {
      defaultGroup = createGroup({
        name: DEFAULT_GROUP_NAME,
        clientId: ownerId,
        description: DEFAULT_GROUP_DESCRIPTION,
        attributes: {
          kind: DEFAULT_GROUP_KIND,
          permissions: defaultPermissions,
        },
      });
      logger.info(`[mirror] grupo ${DEFAULT_GROUP_NAME} criado para owner ${ownerId}`);
    } else if (
      !arePermissionsEqual(defaultGroup?.attributes?.permissions, defaultPermissions) ||
      defaultGroup?.attributes?.kind !== DEFAULT_GROUP_KIND ||
      !defaultGroup.description
    ) {
      defaultGroup = updateGroup(defaultGroup.id, {
        description: defaultGroup.description || DEFAULT_GROUP_DESCRIPTION,
        attributes: {
          ...defaultGroup.attributes,
          kind: DEFAULT_GROUP_KIND,
          permissions: defaultPermissions,
        },
      });
      logger.info(`[mirror] grupo ${DEFAULT_GROUP_NAME} atualizado para owner ${ownerId}`);
    }
    updateMirror(mirror.id, { permissionGroupId: defaultGroup.id });
    logger.info(`[mirror] espelho ${mirror.id} atualizado com permissionGroupId ${defaultGroup.id}`);
  }
}

export default backfillMirrorPermissions;
