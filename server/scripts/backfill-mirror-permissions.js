import { listMirrors, updateMirror } from "../models/mirror.js";
import { listGroups, createGroup } from "../models/group.js";
import { MIRROR_FALLBACK_PERMISSIONS } from "../middleware/permissions.js";

/*
 * Script de backfill para garantir que todos os espelhos tenham um grupo de permissão associado.
 * Ele cria (ou reutiliza) um grupo padrão por owner chamado "MIRROR_TARGET_READ" baseado nas permissões de fallback,
 * adicionando permissão total para a subpágina de grupos de veículos (users-vehicle-groups).
 */

function buildDefaultMirrorPermissions() {
  const perms = JSON.parse(JSON.stringify(MIRROR_FALLBACK_PERMISSIONS));
  perms.admin = perms.admin || {};
  perms.admin.users = perms.admin.users || {};
  perms.admin.users.visible = true;
  perms.admin.users.access = 'read';
  perms.admin.users.subpages = perms.admin.users.subpages || {};
  perms.admin.users.subpages['users-vehicle-groups'] = 'full';
  return perms;
}

export default async function backfillMirrorPermissions() {
  const mirrors = listMirrors();
  for (const mirror of mirrors) {
    if (mirror.permissionGroupId) continue;
    const ownerId = mirror.ownerClientId;
    const groups = listGroups({ clientId: ownerId });
    let defaultGroup = groups.find(
      (g) =>
        g?.attributes?.kind === 'PERMISSION_GROUP' &&
        g?.name === 'MIRROR_TARGET_READ' &&
        String(g.clientId) === String(ownerId)
    );
    if (!defaultGroup) {
      defaultGroup = createGroup({
        name: 'MIRROR_TARGET_READ',
        clientId: ownerId,
        description: 'Grupo padrão de leitura para espelho (inclui criação de grupos de veículos)',
        attributes: {
          kind: 'PERMISSION_GROUP',
          permissions: buildDefaultMirrorPermissions(),
        },
      });
    }
    updateMirror(mirror.id, { permissionGroupId: defaultGroup.id });
  }
}
