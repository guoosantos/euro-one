import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
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

  const {
    crmClients = [],
    crmPipelineStages = [],
    crmDeals = [],
    crmActivities = [],
    crmReminders = [],
    crmTags = [],
    tasks = [],
  } = data;

  await prisma.$transaction(
    entries.map(([key, value]) =>
      prisma.storageCollection.upsert({
        where: { key },
        update: { data: value },
        create: { key, data: value },
      }),
    ),
  );

  if (crmTags.length) {
    await prisma.crmTag.createMany({
      data: crmTags.map((tag) => ({
        id: tag.id || randomUUID(),
        clientId: String(tag.clientId),
        name: tag.name,
        color: tag.color || null,
        createdAt: tag.createdAt ? new Date(tag.createdAt) : new Date(),
        updatedAt: tag.updatedAt ? new Date(tag.updatedAt) : new Date(),
      })),
      skipDuplicates: true,
    });
    console.log(`Migradas ${crmTags.length} tags do CRM.`);
  }

  if (crmPipelineStages.length) {
    await prisma.pipelineStage.createMany({
      data: crmPipelineStages.map((stage) => ({
        id: stage.id || randomUUID(),
        clientId: stage.clientId ? String(stage.clientId) : null,
        name: stage.name,
        probability: stage.probability ?? null,
        order: stage.order ?? 0,
        createdAt: stage.createdAt ? new Date(stage.createdAt) : new Date(),
        updatedAt: stage.updatedAt ? new Date(stage.updatedAt) : new Date(),
      })),
      skipDuplicates: true,
    });
    console.log(`Migradas ${crmPipelineStages.length} etapas de pipeline.`);
  }

  if (crmDeals.length) {
    await prisma.deal.createMany({
      data: crmDeals.map((deal) => ({
        id: deal.id || randomUUID(),
        clientId: deal.clientId ? String(deal.clientId) : null,
        crmClientId: deal.crmClientId || null,
        title: deal.title || deal.name || "Lead",
        value: Number(deal.value) || 0,
        probability: Number(deal.probability) || 0,
        stageId: deal.stageId,
        status: deal.status || "open",
        ownerUserId: deal.ownerUserId || null,
        expectedCloseDate: deal.expectedCloseDate ? new Date(deal.expectedCloseDate) : null,
        createdAt: deal.createdAt ? new Date(deal.createdAt) : new Date(),
        updatedAt: deal.updatedAt ? new Date(deal.updatedAt) : new Date(),
        wonAt: deal.wonAt ? new Date(deal.wonAt) : null,
        lostAt: deal.lostAt ? new Date(deal.lostAt) : null,
        soldDeviceIds: Array.isArray(deal.soldDeviceIds) ? deal.soldDeviceIds : [],
      })),
      skipDuplicates: true,
    });
    console.log(`Migrados ${crmDeals.length} negócios do pipeline.`);
  }

  if (crmActivities.length) {
    await prisma.activity.createMany({
      data: crmActivities.map((activity) => ({
        id: activity.id || randomUUID(),
        clientId: activity.clientId ? String(activity.clientId) : null,
        crmClientId: activity.crmClientId || null,
        dealId: activity.dealId || null,
        type: activity.type || "outreach",
        date: activity.date ? new Date(activity.date) : new Date(),
        result: activity.result || "",
        notes: activity.notes || "",
        createdByUserId: activity.createdByUserId || null,
        createdAt: activity.createdAt ? new Date(activity.createdAt) : new Date(),
      })),
      skipDuplicates: true,
    });
    console.log(`Migradas ${crmActivities.length} atividades de CRM.`);
  }

  if (crmReminders.length) {
    await prisma.reminder.createMany({
      data: crmReminders.map((reminder) => ({
        id: reminder.id || randomUUID(),
        clientId: reminder.clientId ? String(reminder.clientId) : null,
        crmClientId: reminder.crmClientId || null,
        dealId: reminder.dealId || null,
        description: reminder.description || "Lembrete",
        remindAt: reminder.remindAt ? new Date(reminder.remindAt) : null,
        category: reminder.category || "follow-up",
        status: reminder.status || "pending",
        createdByUserId: reminder.createdByUserId || null,
        createdAt: reminder.createdAt ? new Date(reminder.createdAt) : new Date(),
      })),
      skipDuplicates: true,
    });
    console.log(`Migrados ${crmReminders.length} lembretes de CRM.`);
  }

  if (crmClients.length) {
    await prisma.crmClient.createMany({
      data: crmClients.map((client) => ({
        id: client.id || randomUUID(),
        clientId: client.clientId ? String(client.clientId) : "",
        cnpj: client.cnpj || null,
        name: client.name || "Cliente",
        segment: client.segment || null,
        companySize: client.companySize || null,
        city: client.city || null,
        state: client.state || null,
        website: client.website || null,
        mainContactName: client.mainContactName || null,
        mainContactRole: client.mainContactRole || null,
        mainContactPhone: client.mainContactPhone || null,
        mainContactEmail: client.mainContactEmail || null,
        interestLevel: client.interestLevel || null,
        closeProbability: client.closeProbability || null,
        tags: Array.isArray(client.tags) ? client.tags : [],
        hasCompetitorContract: Boolean(client.hasCompetitorContract),
        competitorName: client.competitorName || null,
        competitorContractStart: client.competitorContractStart ? new Date(client.competitorContractStart) : null,
        competitorContractEnd: client.competitorContractEnd ? new Date(client.competitorContractEnd) : null,
        inTrial: Boolean(client.inTrial),
        trialProduct: client.trialProduct || null,
        trialStart: client.trialStart ? new Date(client.trialStart) : null,
        trialDurationDays: client.trialDurationDays ?? null,
        trialEnd: client.trialEnd ? new Date(client.trialEnd) : null,
        notes: client.notes || "",
        relationshipType: client.relationshipType || "prospection",
        createdByUserId: client.createdByUserId || null,
        reservedDeviceIds: Array.isArray(client.reservedDeviceIds) ? client.reservedDeviceIds : [],
        contractStart: client.contractStart ? new Date(client.contractStart) : null,
        contractDurationDays: client.contractDurationDays ?? null,
        contractEnd: client.contractEnd ? new Date(client.contractEnd) : null,
        convertedClientId: client.convertedClientId || null,
        traccarGroupId: client.traccarGroupId || null,
        traccarGroupName: client.traccarGroupName || client.traccarGroup || null,
        traccarUserId: client.traccarUserId || null,
        conversionError: client.conversionError || null,
        dealId: client.dealId || null,
        contacts: Array.isArray(client.contacts)
          ? client.contacts
          : Array.isArray(client.interactions)
            ? client.interactions
            : [],
        soldDeviceIds: Array.isArray(client.soldDeviceIds) ? client.soldDeviceIds : [],
        createdAt: client.createdAt ? new Date(client.createdAt) : new Date(),
        updatedAt: client.updatedAt ? new Date(client.updatedAt) : new Date(),
      })),
      skipDuplicates: true,
    });
    console.log(`Migrados ${crmClients.length} clientes do CRM.`);
  }

  if (tasks.length) {
    await prisma.task.createMany({
      data: tasks.map((task) => ({
        id: task.id || randomUUID(),
        clientId: task.clientId ? String(task.clientId) : "",
        vehicleId: task.vehicleId || null,
        driverId: task.driverId || null,
        address: task.address || null,
        geoFenceId: task.geoFenceId || null,
        geofenceRadius: task.geofenceRadius ? Number(task.geofenceRadius) : null,
        latitude: task.latitude ? Number(task.latitude) : null,
        longitude: task.longitude ? Number(task.longitude) : null,
        startTimeExpected: task.startTimeExpected ? new Date(task.startTimeExpected) : null,
        endTimeExpected: task.endTimeExpected ? new Date(task.endTimeExpected) : null,
        arrivalTime: task.arrivalTime ? new Date(task.arrivalTime) : null,
        serviceStartTime: task.serviceStartTime ? new Date(task.serviceStartTime) : null,
        serviceEndTime: task.serviceEndTime ? new Date(task.serviceEndTime) : null,
        checklistCompleted: Boolean(task.checklistCompleted),
        type: task.type || "entrega",
        status: task.status || "pendente",
        attachments: Array.isArray(task.attachments) ? task.attachments : [],
        createdAt: task.createdAt ? new Date(task.createdAt) : new Date(),
        updatedAt: task.updatedAt ? new Date(task.updatedAt) : new Date(),
      })),
      skipDuplicates: true,
    });
    console.log(`Migradas ${tasks.length} tasks.`);
  }

  console.log(`Migradas ${entries.length} coleções do storage.json para o banco.`);
  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error("Falha ao migrar storage.json:", error);
  process.exitCode = 1;
});
