import { loadEnv } from "../utils/env.js";
import { isAdminGeneralClientName } from "../utils/admin-general.js";
import { createGroup, listGroups } from "../models/group.js";
import { MIRROR_FALLBACK_PERMISSIONS } from "../middleware/permissions.js";

function parseArgs(argv) {
  const options = {
    role: "manager",
    dryRun: false,
    createGroup: true,
  };
  argv.forEach((arg) => {
    if (arg === "--dry-run") options.dryRun = true;
    if (arg === "--no-create-group") options.createGroup = false;
    if (arg.startsWith("--role=")) options.role = arg.split("=")[1];
  });
  return options;
}

function buildDefaultPermissions() {
  const permissions = JSON.parse(JSON.stringify(MIRROR_FALLBACK_PERMISSIONS));
  delete permissions.admin;
  return permissions;
}

function resolveDefaultPermissionGroup(clientId, { createIfMissing }) {
  const groups = listGroups({ clientId });
  const permissionGroups = groups.filter((group) => group?.attributes?.kind === "PERMISSION_GROUP");
  if (permissionGroups.length) {
    const preferred = permissionGroups.find((group) => /default|padr[aã]o/i.test(group?.name || ""));
    return preferred?.id || permissionGroups[0].id;
  }
  if (!createIfMissing) return null;
  const created = createGroup({
    name: "DEFAULT_PERMISSION_GROUP",
    description: "Grupo padrão criado para usuários migrados de admin.",
    clientId,
    attributes: {
      kind: "PERMISSION_GROUP",
      permissions: buildDefaultPermissions(),
    },
  });
  return created?.id || null;
}

async function main() {
  await loadEnv();

  let PrismaClient;
  try {
    ({ PrismaClient } = await import("@prisma/client"));
  } catch (error) {
    console.error("Prisma não está instalado. Execute npm install antes de rodar a correção.");
    console.error(error?.message || error);
    process.exitCode = 1;
    return;
  }

  const options = parseArgs(process.argv.slice(2));
  if (!["manager", "user"].includes(options.role)) {
    console.error("Role inválido. Use --role=manager ou --role=user.");
    process.exitCode = 1;
    return;
  }

  const prisma = new PrismaClient();
  const clients = await prisma.client.findMany({ select: { id: true, name: true } });
  const adminGeneral = clients.find((client) => isAdminGeneralClientName(client.name));
  const adminGeneralId = adminGeneral?.id ?? null;

  if (!adminGeneralId) {
    console.warn("Cliente ADMIN GERAL (EURO ONE) não encontrado; todos admins serão avaliados.");
  }

  const adminUsers = await prisma.user.findMany({
    where: {
      role: "admin",
      clientId: { not: null },
    },
  });

  const targets = adminUsers.filter((user) => !adminGeneralId || String(user.clientId) !== String(adminGeneralId));

  if (!targets.length) {
    console.log("Nenhum usuário admin fora do EURO ONE encontrado.");
    await prisma.$disconnect();
    return;
  }

  let updated = 0;
  let skipped = 0;

  for (const user of targets) {
    const nextAttributes = { ...(user.attributes || {}) };
    if (!nextAttributes.permissionGroupId) {
      const groupId = resolveDefaultPermissionGroup(user.clientId, { createIfMissing: options.createGroup });
      if (!groupId) {
        console.warn("Usuário sem permissionGroupId e nenhum grupo disponível.", {
          userId: user.id,
          clientId: user.clientId,
        });
        skipped += 1;
        continue;
      }
      nextAttributes.permissionGroupId = groupId;
    }

    console.log("Atualizando usuário admin fora do EURO ONE", {
      userId: user.id,
      clientId: user.clientId,
      nextRole: options.role,
      permissionGroupId: nextAttributes.permissionGroupId,
    });

    if (!options.dryRun) {
      await prisma.user.update({
        where: { id: user.id },
        data: {
          role: options.role,
          attributes: nextAttributes,
          updatedAt: new Date(),
        },
      });
    }

    updated += 1;
  }

  await prisma.$disconnect();
  console.log("Correção finalizada", { updated, skipped, dryRun: options.dryRun });
}

main().catch((error) => {
  console.error("Erro ao corrigir usuários admin fora do EURO ONE", error?.message || error);
  process.exitCode = 1;
});
