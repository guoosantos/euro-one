import { randomUUID } from "crypto";
import createError from "http-errors";

import prisma from "../services/prisma.js";
import { createTask } from "./task.js";

const DEFAULT_STAGES = [
  { name: "Prospecção", probability: 10 },
  { name: "Qualificação", probability: 30 },
  { name: "Proposta", probability: 60 },
  { name: "Fechamento", probability: 100 },
];

function clone(value) {
  if (!value) return value;
  return JSON.parse(JSON.stringify(value));
}

async function seedDefaultStages(clientId) {
  const now = new Date();
  await prisma.pipelineStage.createMany({
    data: DEFAULT_STAGES.map((stage, index) => ({
      id: randomUUID(),
      clientId: clientId ? String(clientId) : null,
      name: stage.name,
      probability: stage.probability,
      order: index + 1,
      createdAt: now,
      updatedAt: now,
    })),
    skipDuplicates: true,
  });
  return prisma.pipelineStage.findMany({
    where: clientId ? { clientId: String(clientId) } : { clientId: null },
    orderBy: { order: "asc" },
  });
}

async function ensureStages(clientId) {
  const stages = await prisma.pipelineStage.findMany({
    where: clientId ? { clientId: String(clientId) } : { clientId: null },
    orderBy: { order: "asc" },
  });
  if (stages.length) return stages;
  return seedDefaultStages(clientId);
}

export async function listPipelineStages({ clientId } = {}) {
  return ensureStages(clientId);
}

export async function createDeal(payload = {}, { clientId, user } = {}) {
  const stages = await ensureStages(clientId);
  const stageId = payload.stageId && stages.find((stage) => stage.id === payload.stageId)?.id;
  const defaultStageId = stageId || stages[0]?.id;
  if (!defaultStageId) {
    throw createError(400, "Pipeline não possui etapas configuradas");
  }
  const now = new Date();
  const record = await prisma.deal.create({
    data: {
      id: randomUUID(),
      clientId: clientId ? String(clientId) : null,
      crmClientId: payload.crmClientId || null,
      title: payload.title || payload.name || "Lead",
      value: Number(payload.value) || 0,
      probability:
        Number(payload.probability) || stages.find((stage) => stage.id === defaultStageId)?.probability || 0,
      stageId: defaultStageId,
      status: "open",
      ownerUserId: payload.ownerUserId || user?.id || null,
      expectedCloseDate: payload.expectedCloseDate || null,
      createdAt: now,
      updatedAt: now,
      wonAt: null,
      lostAt: null,
    },
    include: { stage: true },
  });
  return record;
}

export async function ensureDealForCrmClient(crmClient, { clientId, user } = {}) {
  if (!crmClient?.id) return null;
  const existing = await prisma.deal.findFirst({ where: { crmClientId: crmClient.id } });
  if (existing) {
    return prisma.deal.findUnique({ where: { id: existing.id }, include: { stage: true } });
  }
  return createDeal(
    { crmClientId: crmClient.id, title: crmClient.name || "Lead", probability: 10 },
    { clientId: clientId || crmClient.clientId, user },
  );
}

export async function listDeals({ clientId, user, view } = {}) {
  const isAdmin = user?.role === "admin";
  const shouldFilterByOwner = !isAdmin || view === "mine";
  const ownerId = shouldFilterByOwner ? user?.id : undefined;
  const deals = await prisma.deal.findMany({
    where: {
      clientId: clientId ? String(clientId) : undefined,
      ownerUserId: ownerId || undefined,
    },
    include: { stage: true },
    orderBy: { createdAt: "desc" },
  });
  return deals.map(clone);
}

export async function getDealById(id, { clientId } = {}) {
  const record = await prisma.deal.findUnique({ where: { id: String(id) }, include: { stage: true } });
  if (!record) return null;
  if (clientId && String(record.clientId) !== String(clientId)) {
    throw createError(403, "Registro não pertence ao cliente informado");
  }
  return clone(record);
}

export async function moveDealToStage(id, stageId, { clientId, onWon } = {}) {
  const record = await prisma.deal.findUnique({ where: { id: String(id) } });
  if (!record) {
    throw createError(404, "Negócio não encontrado");
  }
  if (clientId && String(record.clientId) !== String(clientId)) {
    throw createError(403, "Registro não pertence ao cliente informado");
  }
  const stages = await ensureStages(clientId || record.clientId);
  const target = stages.find((stage) => stage.id === stageId);
  if (!target) {
    throw createError(400, "Etapa inválida para este pipeline");
  }
  const shouldMarkWon = target.probability >= 100 || /fechado|ganh|won/i.test((target.name || "").toLowerCase());
  const updated = await prisma.deal.update({
    where: { id: record.id },
    data: {
      stageId: target.id,
      probability: target.probability ?? record.probability,
      updatedAt: new Date(),
      status: shouldMarkWon ? "won" : record.status,
      wonAt: shouldMarkWon ? new Date() : record.wonAt,
      lostAt: shouldMarkWon ? null : record.lostAt,
    },
    include: { stage: true },
  });
  const cloned = clone(updated);
  if (shouldMarkWon && typeof onWon === "function") {
    await onWon(cloned);
  }
  return cloned;
}

export async function markDealAsWon(id, { clientId, onWon } = {}) {
  const record = await prisma.deal.findUnique({ where: { id: String(id) } });
  if (!record) return null;
  if (clientId && String(record.clientId) !== String(clientId)) {
    throw createError(403, "Registro não pertence ao cliente informado");
  }
  const stages = await ensureStages(clientId || record.clientId);
  const lastStage = [...stages].sort((a, b) => b.order - a.order)[0];
  const updated = await prisma.deal.update({
    where: { id: record.id },
    data: {
      stageId: lastStage?.id || record.stageId,
      status: "won",
      wonAt: new Date(),
      updatedAt: new Date(),
    },
    include: { stage: true },
  });
  const cloned = clone(updated);
  if (typeof onWon === "function") {
    await onWon(cloned);
  }
  return cloned;
}

export async function createActivity(payload = {}, { clientId, user } = {}) {
  const now = new Date();
  const record = await prisma.activity.create({
    data: {
      id: randomUUID(),
      clientId: clientId ? String(clientId) : null,
      crmClientId: payload.crmClientId || null,
      dealId: payload.dealId || null,
      type: payload.type || "outreach",
      date: payload.date || now,
      result: payload.result || "",
      notes: payload.notes || "",
      createdByUserId: user?.id || payload.createdByUserId || null,
      createdAt: now,
    },
  });
  return clone(record);
}

export async function listActivities({ clientId, user, view } = {}) {
  const isAdmin = user?.role === "admin";
  const shouldFilterByOwner = !isAdmin || view === "mine";
  const activities = await prisma.activity.findMany({
    where: {
      clientId: clientId ? String(clientId) : undefined,
      createdByUserId: shouldFilterByOwner ? user?.id : undefined,
    },
    orderBy: { date: "desc" },
  });
  return activities.map(clone);
}

export async function createReminder(payload = {}, { clientId, user } = {}) {
  const now = new Date();
  const record = await prisma.reminder.create({
    data: {
      id: randomUUID(),
      clientId: clientId ? String(clientId) : null,
      crmClientId: payload.crmClientId || null,
      dealId: payload.dealId || null,
      description: payload.description || "Lembrete",
      remindAt: payload.remindAt || null,
      category: payload.category || "follow-up",
      status: payload.status || "pending",
      createdByUserId: user?.id || payload.createdByUserId || null,
      createdAt: now,
    },
  });
  return clone(record);
}

export async function listReminders({ clientId, user, view } = {}) {
  const isAdmin = user?.role === "admin";
  const shouldFilterByOwner = !isAdmin || view === "mine";
  const reminders = await prisma.reminder.findMany({
    where: {
      clientId: clientId ? String(clientId) : undefined,
      createdByUserId: shouldFilterByOwner ? user?.id : undefined,
    },
    orderBy: { remindAt: "asc" },
  });
  return reminders.map(clone);
}

export async function scheduleRenewalReminders({
  clientId,
  crmClientId,
  dealId,
  contractEnd,
  user,
} = {}) {
  if (!contractEnd) return [];
  const endDate = new Date(contractEnd);
  if (Number.isNaN(endDate.getTime())) return [];

  const remindersToCreate = [
    { offsetDays: 30, label: "Renovação em 30 dias" },
    { offsetDays: 0, label: "Contrato vence hoje" },
  ];

  const results = [];
  for (const { offsetDays, label } of remindersToCreate) {
    const remindDate = new Date(endDate);
    remindDate.setDate(remindDate.getDate() - offsetDays);
    // eslint-disable-next-line no-await-in-loop
    const reminder = await createReminder(
      { crmClientId, dealId, description: label, remindAt: remindDate.toISOString(), category: "renewal" },
      { clientId, user },
    );
    results.push(reminder);
  }
  return results;
}

export async function scheduleRenewalTasks({ clientId, crmClientId, dealId, contractEnd } = {}) {
  if (!contractEnd || !clientId) return [];
  const endDate = new Date(contractEnd);
  if (Number.isNaN(endDate.getTime())) return [];

  const tasksToCreate = [
    { offsetDays: 30, label: "Renovação em 30 dias" },
    { offsetDays: 0, label: "Contrato vence hoje" },
  ];

  const created = [];
  for (const { offsetDays, label } of tasksToCreate) {
    const remindDate = new Date(endDate);
    remindDate.setDate(remindDate.getDate() - offsetDays);
    // eslint-disable-next-line no-await-in-loop
    const task = await createTask({
      clientId: String(clientId),
      startTimeExpected: remindDate.toISOString(),
      endTimeExpected: remindDate.toISOString(),
      status: "pendente",
      type: "crm-renovacao",
      address: label,
    });
    created.push(task);
  }
  return created;
}

export function attachDealSummary(deal) {
  if (!deal) return null;
  return { ...clone(deal), stage: deal.stage ? clone(deal.stage) : null };
}

export function mapDealsWithStage(list = []) {
  return list.map((deal) => attachDealSummary(deal));
}
