import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

async function main() {
  let PrismaClient;
  try {
    ({ PrismaClient } = await import("@prisma/client"));
  } catch (error) {
    console.error("Prisma não está instalado. Execute npm install antes de migrar.");
    console.error(error?.message || error);
    process.exit(1);
  }

  const prisma = new PrismaClient();
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const storagePath = path.resolve(__dirname, "../data/storage.json");

  if (!fs.existsSync(storagePath)) {
    console.log("Nenhum storage.json encontrado para migrar.");
    process.exit(0);
  }

  const raw = fs.readFileSync(storagePath, "utf8");
  const data = raw ? JSON.parse(raw) : {};
  const entries = Object.entries(data);

  if (!entries.length) {
    console.log("Arquivo storage.json está vazio, nada a migrar.");
    process.exit(0);
  }

  await prisma.$transaction(
    entries.map(([key, value]) =>
      prisma.storageCollection.upsert({
        where: { key },
        update: { data: value },
        create: { key, data: value },
      }),
    ),
  );

  console.log(`Migradas ${entries.length} coleções do storage.json para o banco.`);
  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error("Falha ao migrar storage.json:", error);
  process.exitCode = 1;
});
