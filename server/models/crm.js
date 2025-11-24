import { randomUUID } from "crypto";
import createError from "http-errors";

import { loadCollection, saveCollection } from "../services/storage.js";

const CLIENTS_KEY = "crmClients";
const CONTACTS_KEY = "crmContacts";

const clients = new Map();
const contacts = new Map();

function clone(value) {
  return value ? JSON.parse(JSON.stringify(value)) : value;
}

function persistClients() {
  saveCollection(CLIENTS_KEY, Array.from(clients.values()));
}

function persistContacts() {
  saveCollection(CONTACTS_KEY, Array.from(contacts.values()));
}

function ensureLoaded() {
  if (clients.size === 0) {
    const stored = loadCollection(CLIENTS_KEY, []);
    stored.forEach((client) => {
      if (!client?.id) return;
      clients.set(String(client.id), { ...client });
    });
  }
  if (contacts.size === 0) {
    const storedContacts = loadCollection(CONTACTS_KEY, []);
    storedContacts.forEach((contact) => {
      if (!contact?.id) return;
      contacts.set(String(contact.id), { ...contact });
    });
  }
}

function normaliseContactFields(record) {
  const mainContactName = record.mainContactName || record.primaryContact?.name || null;
  const mainContactRole = record.mainContactRole || record.primaryContact?.role || null;
  const mainContactEmail = record.mainContactEmail || record.primaryContact?.email || null;
  const mainContactPhone = record.mainContactPhone || record.primaryContact?.phone || null;

  return {
    ...record,
    mainContactName,
    mainContactRole,
    mainContactEmail,
    mainContactPhone,
  };
}

export function listCrmClients({ clientId, id } = {}) {
  ensureLoaded();
  const list = Array.from(clients.values());
  const filtered = list.filter((item) => {
    if (id && String(item.id) !== String(id)) return false;
    if (clientId && String(item.clientId) !== String(clientId)) return false;
    return true;
  });
  return filtered.map((item) => clone(normaliseContactFields(item)));
}

export function getCrmClientById(id) {
  ensureLoaded();
  const record = clients.get(String(id));
  return clone(normaliseContactFields(record));
}

export function createCrmClient(payload) {
  ensureLoaded();
  const { clientId, name } = payload || {};
  if (!clientId) throw createError(400, "clientId é obrigatório");
  if (!name) throw createError(400, "Nome do cliente é obrigatório");

  const now = new Date().toISOString();
  const record = normaliseContactFields({
    id: randomUUID(),
    clientId: String(clientId),
    name,
    tags: Array.isArray(payload?.tags) ? payload.tags : [],
    interestLevel: payload?.interestLevel || null,
    closeProbability: payload?.closeProbability || null,
    mainContactName: payload?.mainContactName || null,
    mainContactRole: payload?.mainContactRole || null,
    mainContactEmail: payload?.mainContactEmail || null,
    mainContactPhone: payload?.mainContactPhone || null,
    primaryContact: payload?.primaryContact || null,
    hasCompetitorContract: Boolean(payload?.hasCompetitorContract),
    competitorName: payload?.competitorName || null,
    competitorContractEnd: payload?.competitorContractEnd || null,
    inTrial: Boolean(payload?.inTrial),
    trialEnd: payload?.trialEnd || null,
    interactions: Array.isArray(payload?.interactions) ? payload.interactions : [],
    createdAt: now,
    updatedAt: now,
  });

  clients.set(String(record.id), record);
  persistClients();
  return clone(record);
}

export function updateCrmClient(id, updates = {}) {
  ensureLoaded();
  const record = clients.get(String(id));
  if (!record) throw createError(404, "Cliente de CRM não encontrado");
  if (updates.clientId && String(updates.clientId) !== String(record.clientId)) {
    throw createError(403, "Não é possível mover cliente entre tenants");
  }
  const merged = normaliseContactFields({
    ...record,
    ...updates,
    tags: Array.isArray(updates.tags) ? updates.tags : record.tags,
    updatedAt: new Date().toISOString(),
  });
  clients.set(String(id), merged);
  persistClients();
  return clone(merged);
}

export function listCrmContacts({ clientId, crmClientId } = {}) {
  ensureLoaded();
  const list = Array.from(contacts.values());
  const filtered = list.filter((contact) => {
    if (crmClientId && String(contact.crmClientId) !== String(crmClientId)) return false;
    if (clientId && String(contact.clientId) !== String(clientId)) return false;
    return true;
  });
  return filtered.map(clone);
}

export function createCrmContact(payload) {
  ensureLoaded();
  const { clientId, crmClientId, name } = payload || {};
  if (!clientId) throw createError(400, "clientId é obrigatório");
  if (!crmClientId) throw createError(400, "crmClientId é obrigatório");
  if (!name) throw createError(400, "Nome do contato é obrigatório");

  const client = getCrmClientById(crmClientId);
  if (!client) throw createError(404, "Cliente não encontrado");
  if (clientId && String(client.clientId) !== String(clientId)) {
    throw createError(403, "Contato não pertence a este cliente");
  }

  const now = new Date().toISOString();
  const record = {
    id: randomUUID(),
    clientId: String(clientId),
    crmClientId: String(crmClientId),
    name,
    role: payload?.role || null,
    phone: payload?.phone || null,
    email: payload?.email || null,
    notes: payload?.notes || null,
    createdAt: now,
    updatedAt: now,
  };
  contacts.set(String(record.id), record);
  persistContacts();
  return clone(record);
}

function isDateWithin(value, withinDays) {
  if (!value || !withinDays) return false;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  const today = new Date();
  const limit = new Date();
  limit.setDate(today.getDate() + Number(withinDays));
  return date >= today && date <= limit;
}

export function listCrmClientsWithUpcomingEvents({ clientId, contractWithinDays, trialWithinDays } = {}) {
  const list = listCrmClients({ clientId });
  const contractAlerts = contractWithinDays
    ? list.filter(
        (client) =>
          Boolean(client.hasCompetitorContract) &&
          !!client.competitorContractEnd &&
          isDateWithin(client.competitorContractEnd, contractWithinDays),
      )
    : [];

  const trialAlerts = trialWithinDays
    ? list.filter(
        (client) => Boolean(client.inTrial) && !!client.trialEnd && isDateWithin(client.trialEnd, trialWithinDays),
      )
    : [];

  return { contractAlerts, trialAlerts };
}

