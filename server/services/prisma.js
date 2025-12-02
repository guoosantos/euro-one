let PrismaClient;
try {
  ({ PrismaClient } = await import("@prisma/client"));
} catch (error) {
  console.warn("[prisma] pacote @prisma/client indisponível, usando stub em memória");
}

let prisma = null;
if (PrismaClient) {
  try {
    prisma = new PrismaClient();
  } catch (error) {
    console.warn("[prisma] falha ao inicializar PrismaClient", error?.message || error);
    prisma = null;
  }
}

export function getPrisma() {
  if (!prisma) {
    throw new Error("Prisma client não inicializado. Instale @prisma/client ou configure o banco.");
  }
  return prisma;
}

export default prisma;
