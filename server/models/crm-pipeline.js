import createError from "http-errors";
import { randomUUID } from "crypto";

import { loadCollection, saveCollection } from "../services/storage.js";

const PIPELINE_KEY = "crmPipelineStages";
const DEALS_KEY = "crmDeals";
const ACTIVITIES_KEY = "crmActivities";
const REMINDERS_KEY = "crmReminders";

const stageIndex = new Map();
const stagesByClient = new Map();
const deals = new Map();
const activities = new Map();
const reminders = new Map();

function syncStages() {
  saveCollection(PIPELINE_KEY, Array.from(stageIndex.values()));
}

function syncDeals() {
  saveCollection(DEALS_KEY, Array.from(deals.values()));
}

function syncActivities() {
  saveCollection(ACTIVITIES_KEY, Array.from(activities.values()));
}

function syncReminders() {
  saveCollection(REMINDERS_KEY, Array.from(reminders.values()));
}

function clone(value) {
  if (!value) return value;
  return JSON.parse(JSON.stringify(value));
}

function addStage(stage, { skipSync = false } = {}) {
  const clientKey = stage.clientId || "global";
  stageIndex.set(stage.id, stage);
  const list = stagesByClient.get(clientKey) || [];
  const existingIdx = list.findIndex((item) => item.id === stage.id);
  if (existingIdx >= 0) {
    list[existingIdx] = stage;
  } else {
    list.push(stage);
  }
  stagesByClient.set(clientKey, list);
  if (!skipSync) syncStages();
  return stage;
}

function seedDefaultStages(clientId) {
  const now = new Date().toISOString();
  const defaults = [
    { name: "Prospecção", probability: 10 },
    { name: "Qualificação", probability: 30 },
    { name: "Proposta", probability: 60 },
    { name: "Fechamento", probability: 100 },
  ];
  return defaults.map((stage, index) =>
    addStage(
      {
        id: randomUUID(),
        clientId: clientId || null,
        name: stage.name,
        probability: stage.probability,
        order: index + 1,
        createdAt: now,
        updatedAt: now,
      },
      { skipSync: true },
    ),
  );
}

function ensureStages(clientId) {
  const key = clientId ? String(clientId) : "global";
  if (!stagesByClient.has(key) || stagesByClient.get(key).length === 0) {
    const seeded = seedDefaultStages(clientId);
    stagesByClient.set(key, seeded);
    syncStages();
  }
  return stagesByClient.get(key).slice().sort((a, b) => a.order - b.order);
}

function persistDeal(record, { skipSync = false } = {}) {
  deals.set(record.id, record);
  if (!skipSync) syncDeals();
  return clone(record);
}

function persistActivity(record, { skipSync = false } = {}) {
  activities.set(record.id, record);
  if (!skipSync) syncActivities();
  return clone(record);
}

function persistReminder(record, { skipSync = false } = {}) {
  reminders.set(record.id, record);
  if (!skipSync) syncReminders();
  return clone(record);
}

function loadPersistedCollections() {
  const persistedStages = loadCollection(PIPELINE_KEY, []);
  persistedStages.forEach((stage) => {
    if (stage?.id) {
      addStage({ ...stage }, { skipSync: true });
    }
  });

  const persistedDeals = loadCollection(DEALS_KEY, []);
  persistedDeals.forEach((record) => {
    if (record?.id) {
      persistDeal({ ...record }, { skipSync: true });
    }
  });

  const persistedActivities = loadCollection(ACTIVITIES_KEY, []);
  persistedActivities.forEach((record) => {
    if (record?.id) {
      persistActivity({ ...record }, { skipSync: true });
    }
  });

  const persistedReminders = loadCollection(REMINDERS_KEY, []);
  persistedReminders.forEach((record) => {
    if (record?.id) {
      persistReminder({ ...record }, { skipSync: true });
    }
  });
}

loadPersistedCollections();

export function listPipelineStages({ clientId } = {}) {
  return ensureStages(clientId).map(clone);
}

export function createDeal(payload = {}, { clientId, user } = {}) {
  const stages = ensureStages(clientId);
  const stageId = payload.stageId && stages.find((stage) => stage.id === payload.stageId)?.id;
  const defaultStageId = stageId || stages[0]?.id;
  if (!defaultStageId) {
    throw createError(400, "Pipeline não possui etapas configuradas");
  }
  const now = new Date().toISOString();
  const record = {
    id: randomUUID(),
    clientId: clientId ? String(clientId) : null,
    crmClientId: payload.crmClientId || null,
    title: payload.title || payload.name || "Lead",
    value: Number(payload.value) || 0,
    probability: Number(payload.probability) || stages.find((stage) => stage.id === defaultStageId)?.probability || 0,
    stageId: defaultStageId,
    status: "open",
    ownerUserId: payload.ownerUserId || user?.id || null,
    expectedCloseDate: payload.expectedCloseDate || null,
    createdAt: now,
    updatedAt: now,
    wonAt: null,
    lostAt: null,
  };
  return persistDeal(record);
}

export function ensureDealForCrmClient(crmClient, { clientId, user } = {}) {
  if (!crmClient?.id) return null;
  const existing = Array.from(deals.values()).find((deal) => deal.crmClientId === crmClient.id);
  if (existing) return clone(existing);
  return createDeal(
    {
      crmClientId: crmClient.id,
      title: crmClient.name || "Lead",
      probability: 10,
    },
    { clientId: clientId || crmClient.clientId, user },
  );
}

export function listDeals({ clientId, user, view } = {}) {
  return Array.from(deals.values())
    .filter((deal) => (clientId ? String(deal.clientId) === String(clientId) : true))
    .filter((deal) => {
      if (!user || user.role === "admin") return true;
      if (view === "mine") return deal.ownerUserId === user.id;
      return true;
    })
    .map(clone);
}

export function getDealById(id, { clientId } = {}) {
  const record = deals.get(String(id));
  if (!record) return null;
  if (clientId && String(record.clientId) !== String(clientId)) {
    throw createError(403, "Registro não pertence ao cliente informado");
  }
  return clone(record);
}

export function moveDealToStage(id, stageId, { clientId } = {}) {
  const record = deals.get(String(id));
  if (!record) {
    throw createError(404, "Negócio não encontrado");
  }
  const stages = ensureStages(clientId || record.clientId);
  const target = stages.find((stage) => stage.id === stageId);
  if (!target) {
    throw createError(400, "Etapa inválida para este pipeline");
  }
  record.stageId = target.id;
  record.probability = target.probability ?? record.probability;
  record.updatedAt = new Date().toISOString();
  return persistDeal(record);
}

export function markDealAsWon(id, { clientId } = {}) {
  const record = deals.get(String(id));
  if (!record) return null;
  const stages = ensureStages(clientId || record.clientId);
  const lastStage = stages.sort((a, b) => b.order - a.order)[0];
  record.stageId = lastStage?.id || record.stageId;
  record.status = "won";
  record.wonAt = new Date().toISOString();
  record.updatedAt = record.wonAt;
  return persistDeal(record);
}

export function createActivity(payload = {}, { clientId, user } = {}) {
  const now = new Date().toISOString();
  const record = {
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
  };
  return persistActivity(record);
}

export function listActivities({ clientId, user, view } = {}) {
  return Array.from(activities.values())
    .filter((activity) => (clientId ? String(activity.clientId) === String(clientId) : true))
    .filter((activity) => {
      if (!user || user.role === "admin") return true;
      if (view === "mine") return activity.createdByUserId === user.id;
      return true;
    })
    .map(clone);
}

export function createReminder(payload = {}, { clientId, user } = {}) {
  const record = {
    id: randomUUID(),
    clientId: clientId ? String(clientId) : null,
    crmClientId: payload.crmClientId || null,
    dealId: payload.dealId || null,
    description: payload.description || "Lembrete",
    remindAt: payload.remindAt || null,
    category: payload.category || "follow-up",
    status: payload.status || "pending",
    createdByUserId: user?.id || payload.createdByUserId || null,
    createdAt: new Date().toISOString(),
  };
  return persistReminder(record);
}

export function listReminders({ clientId, user, view } = {}) {
  return Array.from(reminders.values())
    .filter((reminder) => (clientId ? String(reminder.clientId) === String(clientId) : true))
    .filter((reminder) => {
      if (!user || user.role === "admin") return true;
      if (view === "mine") return reminder.createdByUserId === user.id;
      return true;
    })
    .map(clone);
}

export function scheduleRenewalReminders({
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

  return remindersToCreate.map(({ offsetDays, label }) => {
    const remindDate = new Date(endDate);
    remindDate.setDate(remindDate.getDate() - offsetDays);
    return createReminder(
      {
        crmClientId,
        dealId,
        description: label,
        remindAt: remindDate.toISOString(),
        category: "renewal",
      },
      { clientId, user },
    );
  });
}

export function attachDealSummary(deal) {
  if (!deal) return null;
  const stage = stageIndex.get(deal.stageId) || null;
  return { ...clone(deal), stage };
}

export function mapDealsWithStage(list = []) {
  return list.map((deal) => attachDealSummary(deal));
}
