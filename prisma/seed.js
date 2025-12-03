import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../server/utils/password.js";

const prisma = new PrismaClient();

async function ensureDefaultClient() {
  const existing = await prisma.client.findFirst({ where: { name: "Cliente Euro Soluções" } });
  if (existing) return existing;
  return prisma.client.create({
    data: {
      name: "Cliente Euro Soluções",
      deviceLimit: 100,
      userLimit: 50,
      attributes: { companyName: "Cliente Euro Soluções" },
    },
  });
}

async function ensureAdminUser(clientId) {
  const email = "admin@euro.one";
  const username = "admin";
  const passwordHash = await hashPassword("admin");
  const existing = await prisma.user.findUnique({ where: { email } });

  if (existing) {
    return prisma.user.update({
      where: { id: existing.id },
      data: {
        name: existing.name || "Administrador",
        role: "admin",
        clientId: clientId || existing.clientId,
        passwordHash,
        emailNormalized: email.toLowerCase(),
        username: existing.username || username,
        usernameNormalized: (existing.username || username).toLowerCase(),
        attributes: existing.attributes || {},
      },
    });
  }

  return prisma.user.create({
    data: {
      name: "Administrador",
      email,
      emailNormalized: email.toLowerCase(),
      username,
      usernameNormalized: username.toLowerCase(),
      passwordHash,
      role: "admin",
      clientId,
      attributes: {},
    },
  });
}

async function ensureUserPreference(userId, clientId) {
  if (!userId || !clientId) return null;
  return prisma.userPreference.upsert({
    where: { userId },
    update: { clientId },
    create: { userId, clientId, payload: {} },
  });
}

async function main() {
  const client = await ensureDefaultClient();
  const admin = await ensureAdminUser(client.id);
  await ensureUserPreference(admin.id, client.id);
  console.log(`Seed concluída. Client ${client.name} (${client.id}) e admin ${admin.email}.`);
}

main()
  .catch((error) => {
    console.error("Seed falhou", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
