import createError from "http-errors";

import { resolveExplicitClientIds } from "../middleware/tenant.js";
import { getClientById, listClients } from "../models/client.js";

export async function resolveTenantScope(user) {
  if (!user) {
    return { isAdmin: false, clientIds: new Set() };
  }
  if (user.role === "admin") {
    return { isAdmin: true, clientIds: new Set() };
  }

  const clientIds = new Set();
  if (user.clientId) {
    clientIds.add(String(user.clientId));
  }

  resolveExplicitClientIds(user).forEach((id) => clientIds.add(String(id)));

  const parentClientId = user.clientId ? String(user.clientId) : null;
  if (parentClientId) {
    const parentClient = await getClientById(parentClientId);
    if (parentClient?.attributes?.canCreateSubclients) {
      const clients = await listClients();
      clients.forEach((client) => {
        const parentId = client?.attributes?.parentClientId;
        if (parentId && String(parentId) === parentClientId) {
          clientIds.add(String(client.id));
        }
      });
    }
  }

  return { isAdmin: false, clientIds };
}

export async function ensureClientInScope(user, clientId) {
  if (!clientId) {
    throw createError(400, "clientId é obrigatório");
  }
  const scope = await resolveTenantScope(user);
  if (scope.isAdmin) {
    return;
  }
  if (!scope.clientIds.has(String(clientId))) {
    throw createError(403, "Permissão insuficiente para acessar este cliente");
  }
}

export default {
  resolveTenantScope,
  ensureClientInScope,
};
