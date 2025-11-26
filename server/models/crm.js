import createError from "http-errors";
import { randomUUID } from "crypto";

import { loadCollection, saveCollection } from "../services/storage.js";
import { normaliseClientTags } from "./crm-tags.js";

const STORAGE_KEY = "crmClients";
const crmClients = new Map();

function syncStorage() {
  saveCollection(STORAGE_KEY, Array.from(crmClients.values()));
}

function normaliseBoolean(value) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const lower = value.trim().toLowerCase();
    return ["true", "1", "yes", "sim", "y"].includes(lower);
  }
  return Boolean(value);
}

function normaliseTags(tags, { clientId } = {}) {
  if (!clientId) return [];
  const resolved = normaliseClientTags(tags, { clientId });
  return resolved.slice(0, 30);
}

function normaliseString(value) {
  return typeof value === "string" ? value.trim() : value ?? "";
}

function normaliseDate(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function normaliseCnpj(value) {
  if (!value) return "";
  return String(value).replace(/\D/g, "").slice(0, 14);
}

function normaliseRelationshipType(value) {
  const key = typeof value === "string" ? value.toLowerCase() : value;
  const map = {
    prospection: "prospection",
    prospect: "prospection",
    prospecting: "prospection",
    cliente: "customer",
    customer: "customer",
    client: "customer",
    supplier: "supplier",
    fornecedor: "supplier",
  };
  return map[key] || "prospection";
}

function duplicateCnpjError() {
  const message = "Já existe um cliente com este CNPJ na base do CRM.";
  const error = createError(409, message);
  error.code = "DUPLICATE_CNPJ";
  error.expose = true;
  error.data = { code: "DUPLICATE_CNPJ", message };
  return error;
}

function findDuplicateCnpj({ clientId, cnpj, ignoreId } = {}) {
  if (!clientId || !cnpj) return null;

  const clientKey = String(clientId);
  return Array.from(crmClients.values()).find((record) => {
    if (ignoreId && record.id === ignoreId) return false;
    const sameTenant = String(record.clientId) === clientKey;
    const hasCnpj = Boolean(record.cnpj);
    return sameTenant && hasCnpj && record.cnpj === cnpj;
  });
}

function computeTrialEnd(startDate, durationDays, endDate) {
  const explicitEnd = normaliseDate(endDate);
  if (explicitEnd) return explicitEnd;
  const start = normaliseDate(startDate);
  const duration = Number(durationDays);
  if (!start || !Number.isFinite(duration)) return null;
  const date = new Date(start);
  date.setDate(date.getDate() + duration);
  return date.toISOString();
}

function normaliseContactType(value) {
  const map = {
    "ligação": "ligacao",
    ligação: "ligacao",
    ligacao: "ligacao",
    whatsapp: "whatsapp",
    "e-mail": "email",
    email: "email",
    reuniao: "reuniao",
    reunião: "reuniao",
  };
  return map[value] || "ligacao";
}

function isDateWithinDays(dateValue, withinDays) {
  if (!withinDays || withinDays <= 0) return false;
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return false;

  const now = new Date();
  const limit = new Date();
  limit.setDate(limit.getDate() + withinDays);

  return date >= now && date <= limit;
}

function isDatePastOrToday(dateValue) {
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return false;
  const now = new Date();
  return date <= now;
}

function ensureClientAccessible(record, clientId, user) {
  if (!record) {
    throw createError(404, "Cliente CRM não encontrado");
  }
  if (clientId && String(record.clientId) !== String(clientId)) {
    throw createError(403, "Registro não pertence ao cliente informado");
  }
  if (user && user.role !== "admin" && record.createdByUserId !== user.id) {
    throw createError(403, "Você não tem permissão para acessar este cliente");
  }
}

function toContactSnapshot(contact = {}) {
  return {
    ...contact,
    clientId: contact.clientId,
  };
}

function hydrateRecord(record) {
  return { ...record, contacts: Array.isArray(record.contacts) ? [...record.contacts] : [] };
}

function persistClient(record, { skipSync = false } = {}) {
  const prepared = { ...record, contacts: Array.isArray(record.contacts) ? record.contacts : [] };
  crmClients.set(prepared.id, prepared);
  if (!skipSync) {
    syncStorage();
  }
  return hydrateRecord(prepared);
}

function migrateLegacy(record) {
  if (!record) return null;
  const contacts = Array.isArray(record.interactions)
    ? record.interactions.map((item) => ({
        ...item,
        clientId: record.clientId,
        type: normaliseContactType(item.type),
      }))
    : Array.isArray(record.contacts)
      ? record.contacts
      : [];
  return {
    id: record.id,
    clientId: record.clientId,
    cnpj: normaliseCnpj(record.cnpj) || null,
    name: record.name,
    segment: record.segment,
    companySize: record.companySize === "médio" ? "media" : record.companySize,
    city: record.city,
    state: record.state,
    website: record.website,
    mainContactName: record.primaryContact?.name || record.mainContactName,
    mainContactRole: record.primaryContact?.role || record.mainContactRole,
    mainContactPhone: record.primaryContact?.phone || record.mainContactPhone,
    mainContactEmail: record.primaryContact?.email || record.mainContactEmail,
    interestLevel: record.interestLevel === "médio" ? "medio" : record.interestLevel,
    closeProbability: record.closeProbability === "média" ? "media" : record.closeProbability,
    tags: normaliseTags(record.tags, { clientId: record.clientId }),
    hasCompetitorContract: record.hasCompetitorContract,
    competitorName: record.competitorName,
    competitorContractStart: record.contractStart || record.competitorContractStart,
    competitorContractEnd: record.contractEnd || record.competitorContractEnd,
    inTrial: record.inTrial || record.trial?.active || false,
    trialProduct: record.trial?.product || record.trialProduct,
    trialStart: record.trial?.startDate || record.trialStart,
    trialDurationDays: record.trial?.durationDays ?? record.trialDurationDays ?? null,
    trialEnd: record.trial?.endDate || record.trialEnd,
    notes: record.notes || record.contractNotes || record.observations || "",
    relationshipType: normaliseRelationshipType(record.relationshipType),
    createdByUserId: record.createdByUserId || null,
    contacts,
    createdAt: record.createdAt || new Date().toISOString(),
    updatedAt: record.updatedAt || record.createdAt || new Date().toISOString(),
  };
}

const persisted = loadCollection(STORAGE_KEY, []);
persisted.forEach((record) => {
  if (record?.id) {
    const migrated = migrateLegacy(record);
    if (migrated) {
      persistClient(migrated, { skipSync: true });
    }
  }
});

export function listCrmClients({ clientId, user, createdByUserId, view } = {}) {
  const isAdmin = user?.role === "admin";
  const shouldFilterByOwner = !isAdmin || view === "mine" || createdByUserId;
  const ownerId = createdByUserId || (shouldFilterByOwner ? user?.id : undefined);

  return Array.from(crmClients.values())
    .filter((record) => (clientId ? String(record.clientId) === String(clientId) : true))
    .filter((record) => (ownerId ? record.createdByUserId === ownerId : true))
    .map((record) => hydrateRecord(record));
}

export function listCrmClientsWithUpcomingEvents({
  clientId,
  contractWithinDays = 30,
  trialWithinDays = 7,
  user,
  createdByUserId,
  view,
} = {}) {
  const contractDays = Number.isFinite(Number(contractWithinDays)) ? Number(contractWithinDays) : 30;
  const trialDays = Number.isFinite(Number(trialWithinDays)) ? Number(trialWithinDays) : 7;

  const clients = listCrmClients({ clientId, user, createdByUserId, view });

  const contractAlerts = contractDays
    ? clients.filter(
        (client) =>
          client.hasCompetitorContract &&
          client.competitorContractEnd &&
          isDateWithinDays(client.competitorContractEnd, contractDays) &&
          !isDatePastOrToday(client.competitorContractEnd),
      )
    : [];

  const contractExpired = clients.filter(
    (client) =>
      client.hasCompetitorContract && client.competitorContractEnd && isDatePastOrToday(client.competitorContractEnd),
  );

  const trialAlerts = trialDays
    ? clients.filter(
        (client) =>
          client.inTrial && client.trialEnd && isDateWithinDays(client.trialEnd, trialDays) && !isDatePastOrToday(client.trialEnd),
      )
    : [];

  const trialExpired = clients.filter((client) => client.inTrial && client.trialEnd && isDatePastOrToday(client.trialEnd));

  return { contractAlerts, contractExpired, trialAlerts, trialExpired };
}

export function getCrmClient(id, { clientId, user } = {}) {
  const record = crmClients.get(String(id));
  ensureClientAccessible(record, clientId, user);
  return hydrateRecord(record);
}

export function createCrmClient(payload, { user } = {}) {
  const name = normaliseString(payload?.name || payload?.companyName);
  if (!name) {
    throw createError(400, "Nome do cliente é obrigatório");
  }
  const clientId = payload?.clientId ? String(payload.clientId) : null;
  if (!clientId) {
    throw createError(400, "clientId é obrigatório");
  }
  const cnpjValue = normaliseCnpj(payload?.cnpj) || null;

  if (findDuplicateCnpj({ clientId, cnpj: cnpjValue })) {
    throw duplicateCnpjError();
  }

  const now = new Date().toISOString();
  const record = {
    id: randomUUID(),
    clientId,
    cnpj: cnpjValue,
    name,
    segment: normaliseString(payload?.segment),
    companySize: normaliseString(payload?.companySize || "media"),
    city: normaliseString(payload?.city),
    state: normaliseString(payload?.state),
    website: normaliseString(payload?.website),
    mainContactName: normaliseString(payload?.mainContactName),
    mainContactRole: normaliseString(payload?.mainContactRole),
    mainContactPhone: normaliseString(payload?.mainContactPhone),
    mainContactEmail: normaliseString(payload?.mainContactEmail),
    interestLevel: payload?.interestLevel || "medio",
    closeProbability: payload?.closeProbability || "media",
    tags: normaliseTags(payload?.tags, { clientId }),
    hasCompetitorContract: normaliseBoolean(payload?.hasCompetitorContract),
    competitorName: normaliseString(payload?.competitorName),
    competitorContractStart: normaliseDate(payload?.competitorContractStart),
    competitorContractEnd: normaliseDate(payload?.competitorContractEnd),
    inTrial: normaliseBoolean(payload?.inTrial),
    trialProduct: normaliseString(payload?.trialProduct),
    trialStart: normaliseDate(payload?.trialStart),
    trialDurationDays: Number(payload?.trialDurationDays) || null,
    trialEnd: computeTrialEnd(payload?.trialStart, payload?.trialDurationDays, payload?.trialEnd),
    notes: normaliseString(payload?.notes),
    relationshipType: normaliseRelationshipType(payload?.relationshipType),
    createdByUserId: user?.id || payload?.createdByUserId || null,
    contacts: [],
    createdAt: now,
    updatedAt: now,
  };
  return persistClient(record);
}

export function updateCrmClient(id, updates = {}, { clientId, user } = {}) {
  const record = crmClients.get(String(id));
  ensureClientAccessible(record, clientId, user);

  if (updates.cnpj !== undefined) {
    const nextCnpj = normaliseCnpj(updates.cnpj);
    const nextValue = nextCnpj || null;
    if (nextValue) {
      const duplicated = findDuplicateCnpj({ clientId: record.clientId, cnpj: nextValue, ignoreId: record.id });
      if (duplicated) {
        throw duplicateCnpjError();
      }
    }
    record.cnpj = nextValue;
  }

  if (updates.name !== undefined) record.name = normaliseString(updates.name);
  if (updates.segment !== undefined) record.segment = normaliseString(updates.segment);
  if (updates.companySize !== undefined) record.companySize = normaliseString(updates.companySize);
  if (updates.city !== undefined) record.city = normaliseString(updates.city);
  if (updates.state !== undefined) record.state = normaliseString(updates.state);
  if (updates.website !== undefined) record.website = normaliseString(updates.website);

  if (updates.mainContactName !== undefined) record.mainContactName = normaliseString(updates.mainContactName);
  if (updates.mainContactRole !== undefined) record.mainContactRole = normaliseString(updates.mainContactRole);
  if (updates.mainContactPhone !== undefined) record.mainContactPhone = normaliseString(updates.mainContactPhone);
  if (updates.mainContactEmail !== undefined) record.mainContactEmail = normaliseString(updates.mainContactEmail);

  if (updates.interestLevel !== undefined) record.interestLevel = updates.interestLevel;
  if (updates.closeProbability !== undefined) record.closeProbability = updates.closeProbability;
  if (updates.tags !== undefined) record.tags = normaliseTags(updates.tags, { clientId: record.clientId });

  if (updates.hasCompetitorContract !== undefined) record.hasCompetitorContract = normaliseBoolean(updates.hasCompetitorContract);
  if (updates.competitorName !== undefined) record.competitorName = normaliseString(updates.competitorName);
  if (updates.competitorContractStart !== undefined)
    record.competitorContractStart = normaliseDate(updates.competitorContractStart);
  if (updates.competitorContractEnd !== undefined) record.competitorContractEnd = normaliseDate(updates.competitorContractEnd);

  if (updates.inTrial !== undefined) record.inTrial = normaliseBoolean(updates.inTrial);
  if (updates.trialProduct !== undefined) record.trialProduct = normaliseString(updates.trialProduct);
  if (updates.trialStart !== undefined) record.trialStart = normaliseDate(updates.trialStart);
  if (updates.trialDurationDays !== undefined) record.trialDurationDays = Number(updates.trialDurationDays) || null;
  if (updates.trialEnd !== undefined)
    record.trialEnd = computeTrialEnd(
      updates.trialStart ?? record.trialStart,
      updates.trialDurationDays ?? record.trialDurationDays,
      updates.trialEnd,
    );

  if (updates.notes !== undefined) record.notes = normaliseString(updates.notes);
  if (updates.relationshipType !== undefined) record.relationshipType = normaliseRelationshipType(updates.relationshipType);

  record.updatedAt = new Date().toISOString();
  return persistClient(record);
}

export function listCrmContacts(id, { clientId, user, createdByUserId } = {}) {
  const record = crmClients.get(String(id));
  ensureClientAccessible(record, clientId, user);
  const contacts = Array.isArray(record.contacts) ? record.contacts.map(toContactSnapshot) : [];
  if (user?.role === "admin") {
    if (createdByUserId) {
      return contacts.filter((contact) => contact.createdByUserId === createdByUserId);
    }
    return contacts;
  }
  return contacts.filter((contact) => contact.createdByUserId === user?.id);
}

export function addCrmContact(id, payload = {}, { clientId, user } = {}) {
  const record = crmClients.get(String(id));
  ensureClientAccessible(record, clientId, user);

  const contact = {
    id: randomUUID(),
    clientId: record.clientId,
    date: normaliseDate(payload.date) || new Date().toISOString(),
    type: normaliseContactType(payload.type),
    internalUser: normaliseString(payload.internalUser),
    clientContactName: normaliseString(payload.clientContactName),
    clientContactRole: normaliseString(payload.clientContactRole),
    summary: normaliseString(payload.summary),
    nextStep: normaliseString(payload.nextStep),
    nextStepDate: normaliseDate(payload.nextStepDate),
    createdByUserId: user?.id || payload?.createdByUserId || null,
    createdAt: new Date().toISOString(),
  };

  record.contacts = [...(record.contacts || []), contact];
  record.updatedAt = new Date().toISOString();
  persistClient(record);
  return { ...contact };
}
