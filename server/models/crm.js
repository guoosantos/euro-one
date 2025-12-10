import createError from "http-errors";
import { randomUUID } from "crypto";

import {
  ensureDealForCrmClient,
  mapDealsWithStage,
  markDealAsWon,
  scheduleRenewalReminders,
  scheduleRenewalTasks,
} from "./crm-pipeline.js";
import { createClient, updateClient } from "./client.js";
import { listDevices, updateDevice } from "./device.js";
import { normaliseClientTags, resolveTagNames } from "./crm-tags.js";
import prisma from "../services/prisma.js";
import { traccarAdminRequest } from "../services/traccar.js";

function normaliseBoolean(value) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const lower = value.trim().toLowerCase();
    return ["true", "1", "yes", "sim", "y"].includes(lower);
  }
  return Boolean(value);
}

function normaliseString(value) {
  return typeof value === "string" ? value.trim() : value ?? "";
}

function normaliseTraccarGroupName(value, fallback) {
  const name = normaliseString(value);
  return name || fallback || null;
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

function normaliseDeviceIds(list) {
  if (!list) return [];
  if (Array.isArray(list)) return list.map((item) => String(item)).filter(Boolean);
  if (typeof list === "string") {
    return list
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)
      .map((item) => String(item));
  }
  return [];
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

async function findDuplicateCnpj({ clientId, cnpj, ignoreId } = {}) {
  if (!clientId || !cnpj) return null;
  return prisma.crmClient.findFirst({
    where: {
      clientId: String(clientId),
      cnpj,
      NOT: ignoreId ? { id: ignoreId } : undefined,
    },
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

function computeContractEnd(startDate, durationDays) {
  const start = normaliseDate(startDate);
  const duration = Number(durationDays);
  if (!start || !Number.isFinite(duration) || duration <= 0) return null;
  const date = new Date(start);
  date.setDate(date.getDate() + duration);
  return date.toISOString();
}

  function normaliseContactType(value) {
    const normalisedValue = typeof value === "string" ? value.toLowerCase().trim() : "";
    const map = {
      "ligação": "ligacao",
      ligacao: "ligacao",
      whatsapp: "whatsapp",
      "e-mail": "email",
      email: "email",
      reuniao: "reuniao",
      reunião: "reuniao",
    };
    return map[normalisedValue] || "ligacao";
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

function toDomain(record) {
  if (!record) return null;
  return {
    ...record,
    tags: Array.isArray(record.tags) ? record.tags : record.tags ? record.tags : [],
    reservedDeviceIds: Array.isArray(record.reservedDeviceIds)
      ? record.reservedDeviceIds
      : record.reservedDeviceIds
        ? record.reservedDeviceIds
        : [],
    soldDeviceIds: Array.isArray(record.soldDeviceIds)
      ? record.soldDeviceIds
      : record.soldDeviceIds
        ? record.soldDeviceIds
        : [],
    contacts: Array.isArray(record.contacts) ? record.contacts : record.contacts ? record.contacts : [],
  };
}

function ensureClientAccessible(record, clientId, user) {
  if (!record) {
    throw createError(404, "Cliente CRM não encontrado");
  }
  if (clientId && String(record.clientId) !== String(clientId)) {
    throw createError(403, "Registro não pertence ao cliente informado");
  }
  if (user && user.role !== "admin" && record.createdByUserId && record.createdByUserId !== user.id) {
    throw createError(403, "Você não tem permissão para acessar este cliente");
  }
}

function toContactSnapshot(contact = {}) {
  return {
    ...contact,
    clientId: contact.clientId,
  };
}

async function convertLeadToCustomer(record, { user } = {}) {
  if (!record || record.relationshipType !== "customer") return record;
  if (record.convertedClientId) return record;

  const duplicate = await prisma.crmClient.findFirst({
    where: { id: { not: record.id }, cnpj: record.cnpj, convertedClientId: { not: null } },
  });
  if (duplicate) {
    throw duplicateCnpjError();
  }

  const newClient = await createClient({
    name: record.name,
    attributes: {
      crmId: record.id,
      cnpj: record.cnpj,
    },
  });

  let traccarGroupId = record.traccarGroupId;
  let traccarGroupName = record.traccarGroupName || record.name;
  let traccarUserId = record.traccarUserId;
  let conversionError = record.conversionError;

  try {
    const group = await ensureCrmTraccarGroup({
      desiredName: record.name,
      crmClientId: record.id,
      tenantClientId: newClient.id,
    });
    traccarGroupId = group?.id || traccarGroupId || null;
    traccarGroupName = group?.name || traccarGroupName;
    if (group?.id) {
      await updateClient(newClient.id, {
        attributes: { ...newClient.attributes, traccarGroupId: group.id, traccarGroupName },
      });
    }
  } catch (error) {
    conversionError = conversionError || error?.message || "Falha ao criar grupo no Traccar";
  }

  try {
    const generatedPassword = `c${Math.random().toString(36).slice(-10)}`;
    const traccarUser = await traccarAdminRequest({
      method: "POST",
      url: "/users",
      data: {
        name: record.name,
        email: record.mainContactEmail || `${record.name.replace(/\s+/g, ".").toLowerCase()}@cliente.euro.one`,
        phone: record.mainContactPhone || undefined,
        password: generatedPassword,
        readonly: false,
        administrator: false,
        attributes: { crmId: record.id },
      },
    });
    traccarUserId = traccarUser?.data?.id || traccarUser?.id || traccarUserId || null;
  } catch (error) {
    conversionError = conversionError || error?.message || "Falha ao criar usuário no Traccar";
  }

  const deviceIds = normaliseDeviceIds(record.reservedDeviceIds);
  if (deviceIds.length) {
    const tenantDevices = listDevices({ clientId: record.clientId });
    deviceIds.forEach((deviceId) => {
      const device = tenantDevices.find((item) => item.id === deviceId);
      if (!device) return;
      updateDevice(device.id, { clientId: newClient.id });
      if (traccarGroupId && device.traccarId) {
        const payload = { id: Number(device.traccarId), groupId: Number(traccarGroupId) };
        try {
          void traccarAdminRequest({ method: "PUT", url: `/devices/${device.traccarId}`, data: payload });
        } catch (error) {
          console.warn("[crm] falha ao mover device no Traccar", error?.message || error);
        }
      }
    });
  }

  if (record.dealId) {
    await markDealAsWon(record.dealId, {
      clientId: record.clientId,
      onWon: (deal) => handleDealWon(deal, { user }),
    });
  }

  const contractEnd = computeContractEnd(record.contractStart, record.contractDurationDays);
  const updated = await prisma.crmClient.update({
    where: { id: record.id },
    data: {
      convertedClientId: newClient.id,
      traccarGroupId,
      traccarGroupName,
      traccarUserId,
      conversionError,
      contractEnd,
    },
  });

  await scheduleRenewalReminders({
    clientId: record.clientId,
    crmClientId: record.id,
    dealId: record.dealId,
    contractEnd,
    user,
  });
  await scheduleRenewalTasks({
    clientId: record.clientId,
    crmClientId: record.id,
    dealId: record.dealId,
    contractEnd,
  });

  return toDomain(updated);
}

function hydrateContacts(record) {
  return Array.isArray(record.contacts) ? record.contacts : [];
}

function mapDealsByClient(deals) {
  const map = new Map();
  deals.forEach((deal) => {
    if (deal.crmClientId) {
      map.set(deal.crmClientId, deal);
    }
  });
  return map;
}

export async function listCrmClients({ clientId, user, createdByUserId, view } = {}) {
  const isAdmin = user?.role === "admin";
  const shouldFilterByOwner = !isAdmin || view === "mine" || createdByUserId;
  const ownerId = createdByUserId || (shouldFilterByOwner ? user?.id : undefined);

  const clients = await prisma.crmClient.findMany({
    where: {
      clientId: clientId ? String(clientId) : undefined,
      createdByUserId: ownerId || undefined,
    },
    orderBy: { createdAt: "desc" },
  });

  const deals = await prisma.deal.findMany({
    where: { crmClientId: { in: clients.map((item) => item.id) } },
    include: { stage: true },
  });
  const dealsByClient = mapDealsByClient(deals);

  return Promise.all(
    clients.map(async (record) => {
      const deal = dealsByClient.get(record.id);
      const domain = toDomain(record);
      return { ...domain, deal: deal ? mapDealsWithStage([deal])[0] : null };
    }),
  );
}

export async function listCrmClientsWithUpcomingEvents({
  clientId,
  contractWithinDays = 30,
  trialWithinDays = 7,
  user,
  createdByUserId,
  view,
} = {}) {
  const contractDays = Number.isFinite(Number(contractWithinDays)) ? Number(contractWithinDays) : 30;
  const trialDays = Number.isFinite(Number(trialWithinDays)) ? Number(trialWithinDays) : 7;

  const clients = await listCrmClients({ clientId, user, createdByUserId, view });

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

export async function getCrmClient(id, { clientId, user } = {}) {
  const record = await prisma.crmClient.findUnique({ where: { id: String(id) } });
  ensureClientAccessible(record, clientId, user);
  const deal = await prisma.deal.findFirst({ where: { crmClientId: record.id }, include: { stage: true } });
  return { ...toDomain(record), deal: deal ? mapDealsWithStage([deal])[0] : null };
}

export async function createCrmClient(payload, { user } = {}) {
  const name = normaliseString(payload?.name || payload?.companyName);
  if (!name) {
    throw createError(400, "Nome do cliente é obrigatório");
  }
  const clientId = payload?.clientId ? String(payload.clientId) : null;
  if (!clientId) {
    throw createError(400, "clientId é obrigatório");
  }
  const cnpjValue = normaliseCnpj(payload?.cnpj) || null;

  if (await findDuplicateCnpj({ clientId, cnpj: cnpjValue })) {
    throw duplicateCnpjError();
  }

  const tags = await normaliseClientTags(payload?.tags, { clientId });
  const now = new Date();
  const record = await prisma.crmClient.create({
    data: {
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
      tags,
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
      reservedDeviceIds: normaliseDeviceIds(payload?.reservedDeviceIds),
      contractStart: normaliseDate(payload?.contractStart),
      contractDurationDays: Number(payload?.contractDurationDays) || null,
      contractEnd: computeContractEnd(payload?.contractStart, payload?.contractDurationDays),
      convertedClientId: null,
      traccarGroupId: null,
      traccarGroupName: null,
      traccarUserId: null,
      conversionError: null,
      dealId: null,
      contacts: [],
      soldDeviceIds: [],
      createdAt: now,
      updatedAt: now,
    },
  });

  let dealId = null;
  try {
    const deal = await ensureDealForCrmClient(record, { clientId, user });
    dealId = deal?.id || null;
  } catch (error) {
    console.warn("[crm] falha ao sincronizar lead com pipeline", error?.message || error);
  }

  const updated = await prisma.crmClient.update({ where: { id: record.id }, data: { dealId } });
  return toDomain(updated);
}

export async function updateCrmClient(id, updates = {}, { clientId, user } = {}) {
  const record = await prisma.crmClient.findUnique({ where: { id: String(id) } });
  ensureClientAccessible(record, clientId, user);
  const previousRelationship = record.relationshipType;
  const previousContractEnd = record.contractEnd ? record.contractEnd.toISOString() : null;

  const data = {};

  if (updates.cnpj !== undefined) {
    const nextCnpj = normaliseCnpj(updates.cnpj);
    const nextValue = nextCnpj || null;
    if (nextValue) {
      const duplicated = await findDuplicateCnpj({ clientId: record.clientId, cnpj: nextValue, ignoreId: record.id });
      if (duplicated) {
        throw duplicateCnpjError();
      }
    }
    data.cnpj = nextValue;
  }

  if (updates.name !== undefined) data.name = normaliseString(updates.name);
  if (updates.segment !== undefined) data.segment = normaliseString(updates.segment);
  if (updates.companySize !== undefined) data.companySize = normaliseString(updates.companySize);
  if (updates.city !== undefined) data.city = normaliseString(updates.city);
  if (updates.state !== undefined) data.state = normaliseString(updates.state);
  if (updates.website !== undefined) data.website = normaliseString(updates.website);

  if (updates.mainContactName !== undefined) data.mainContactName = normaliseString(updates.mainContactName);
  if (updates.mainContactRole !== undefined) data.mainContactRole = normaliseString(updates.mainContactRole);
  if (updates.mainContactPhone !== undefined) data.mainContactPhone = normaliseString(updates.mainContactPhone);
  if (updates.mainContactEmail !== undefined) data.mainContactEmail = normaliseString(updates.mainContactEmail);

  if (updates.interestLevel !== undefined) data.interestLevel = updates.interestLevel;
  if (updates.closeProbability !== undefined) data.closeProbability = updates.closeProbability;
  if (updates.tags !== undefined) data.tags = await normaliseClientTags(updates.tags, { clientId: record.clientId });

  if (updates.hasCompetitorContract !== undefined) data.hasCompetitorContract = normaliseBoolean(updates.hasCompetitorContract);
  if (updates.competitorName !== undefined) data.competitorName = normaliseString(updates.competitorName);
  if (updates.competitorContractStart !== undefined)
    data.competitorContractStart = normaliseDate(updates.competitorContractStart);
  if (updates.competitorContractEnd !== undefined) data.competitorContractEnd = normaliseDate(updates.competitorContractEnd);

  if (updates.inTrial !== undefined) data.inTrial = normaliseBoolean(updates.inTrial);
  if (updates.trialProduct !== undefined) data.trialProduct = normaliseString(updates.trialProduct);
  if (updates.trialStart !== undefined) data.trialStart = normaliseDate(updates.trialStart);
  if (updates.trialDurationDays !== undefined) data.trialDurationDays = Number(updates.trialDurationDays) || null;
  if (updates.trialEnd !== undefined)
    data.trialEnd = computeTrialEnd(updates.trialStart ?? record.trialStart, updates.trialDurationDays ?? record.trialDurationDays, updates.trialEnd);

  if (updates.notes !== undefined) data.notes = normaliseString(updates.notes);
  if (updates.relationshipType !== undefined) data.relationshipType = normaliseRelationshipType(updates.relationshipType);
  if (updates.soldDeviceIds !== undefined) data.soldDeviceIds = normaliseDeviceIds(updates.soldDeviceIds);

  if (updates.reservedDeviceIds !== undefined) data.reservedDeviceIds = normaliseDeviceIds(updates.reservedDeviceIds);
  if (updates.contractStart !== undefined) data.contractStart = normaliseDate(updates.contractStart);
  if (updates.contractDurationDays !== undefined) data.contractDurationDays = Number(updates.contractDurationDays) || null;
  data.contractEnd = computeContractEnd(data.contractStart ?? record.contractStart, data.contractDurationDays ?? record.contractDurationDays);

  data.updatedAt = new Date();

  const updated = await prisma.crmClient.update({ where: { id: record.id }, data });

  const currentContractEnd = updated.contractEnd ? updated.contractEnd.toISOString() : null;
  if (currentContractEnd !== previousContractEnd) {
    await scheduleRenewalReminders({
      clientId: updated.clientId,
      crmClientId: updated.id,
      dealId: updated.dealId,
      contractEnd: updated.contractEnd,
      user,
    });
    await scheduleRenewalTasks({
      clientId: updated.clientId,
      crmClientId: updated.id,
      dealId: updated.dealId,
      contractEnd: updated.contractEnd,
    });
  }

  if (previousRelationship !== "customer" && updated.relationshipType === "customer") {
    try {
      return await convertLeadToCustomer(toDomain(updated), { user });
    } catch (error) {
      await prisma.crmClient.update({ where: { id: record.id }, data: { conversionError: error?.message || String(error) } });
      throw error;
    }
  }

  return toDomain(updated);
}

export async function listCrmContacts(id, { clientId, user, createdByUserId } = {}) {
  const record = await prisma.crmClient.findUnique({ where: { id: String(id) } });
  ensureClientAccessible(record, clientId, user);
  const contacts = hydrateContacts(record).map(toContactSnapshot);

  if (user?.role === "admin") {
    if (createdByUserId) {
      return contacts.filter((contact) => contact.createdByUserId === createdByUserId);
    }
    return contacts;
  }
  return contacts.filter((contact) => contact.createdByUserId === user?.id);
}

export async function addCrmContact(id, payload = {}, { clientId, user } = {}) {
  const record = await prisma.crmClient.findUnique({ where: { id: String(id) } });
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

  const contacts = [...hydrateContacts(record), contact];
  await prisma.crmClient.update({ where: { id: record.id }, data: { contacts, updatedAt: new Date() } });
  return { ...contact };
}

export async function decorateWithTags(crmClient, { clientId } = {}) {
  if (!crmClient) return null;
  const tags = await resolveTagNames(crmClient.tags, { clientId: clientId || crmClient.clientId });
  return { ...crmClient, tagDetails: tags };
}

async function ensureCrmTraccarGroup({ desiredName, crmClientId, tenantClientId }) {
  const name = normaliseTraccarGroupName(desiredName, `Cliente ${crmClientId}`);
  try {
    const groupResponse = await traccarAdminRequest({
      method: "POST",
      url: "/groups",
      data: {
        name,
        attributes: { crmId: crmClientId, tenantClientId },
      },
    });
    return { id: groupResponse?.data?.id || groupResponse?.id || null, name };
  } catch (error) {
    if (error?.status === 409) {
      try {
        const groups = await traccarAdminRequest({ method: "GET", url: "/groups", params: { all: true } });
        const list = Array.isArray(groups?.data) ? groups.data : groups;
        const match = Array.isArray(list) ? list.find((item) => item?.name === name) : null;
        if (match?.id) {
          return { id: match.id, name };
        }
      } catch (searchError) {
        console.warn("[crm] falha ao localizar grupo existente no Traccar", searchError?.message || searchError);
      }
    }
    throw error;
  }
}

export async function handleDealWon(deal, { user } = {}) {
  if (!deal?.crmClientId) return deal;
  const crmClient = await prisma.crmClient.findUnique({ where: { id: deal.crmClientId } });
  if (!crmClient) return deal;

  const deviceIds = normaliseDeviceIds(crmClient.reservedDeviceIds);
  const clientDevices = listDevices({ clientId: crmClient.clientId });
  const linkedDevices = [];

  for (const deviceId of deviceIds) {
    const device = clientDevices.find((item) => item.id === deviceId);
    if (!device) continue;
    updateDevice(device.id, { clientId: crmClient.convertedClientId || crmClient.clientId });
    linkedDevices.push(device.id);

    if (crmClient.traccarGroupId && device.traccarId) {
      try {
        await traccarAdminRequest({
          method: "PUT",
          url: `/devices/${device.traccarId}`,
          data: { id: Number(device.traccarId), groupId: Number(crmClient.traccarGroupId) },
        });
      } catch (error) {
        console.warn("[crm] falha ao vincular device ao grupo Traccar", error?.message || error);
      }
    }
  }

  if (linkedDevices.length) {
    await prisma.crmClient.update({ where: { id: crmClient.id }, data: { soldDeviceIds: linkedDevices } });
    await prisma.deal.update({ where: { id: deal.id }, data: { soldDeviceIds: linkedDevices } });
  }

  const contractEnd = crmClient.contractEnd || computeContractEnd(crmClient.contractStart, crmClient.contractDurationDays);
  if (contractEnd) {
    await scheduleRenewalReminders({
      clientId: crmClient.clientId,
      crmClientId: crmClient.id,
      dealId: deal.id,
      contractEnd,
      user,
    });
    await scheduleRenewalTasks({
      clientId: crmClient.clientId,
      crmClientId: crmClient.id,
      dealId: deal.id,
      contractEnd,
    });
  }

  return deal;
}

export default {
  listCrmClients,
  listCrmClientsWithUpcomingEvents,
  getCrmClient,
  createCrmClient,
  updateCrmClient,
  listCrmContacts,
  addCrmContact,
  decorateWithTags,
  handleDealWon,
};
