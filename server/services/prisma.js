let PrismaClient;
try {
  ({ PrismaClient } = await import("@prisma/client"));
} catch (error) {
  console.warn("[prisma] pacote @prisma/client indisponível, usando stub em memória");
}

const prisma = PrismaClient ? new PrismaClient() : null;

export function getPrisma() {
  if (!prisma) {
    throw new Error("Prisma client não inicializado. Instale @prisma/client ou configure o banco.");
  }
  return prisma;
}

export default prisma;
