import createError from "http-errors";

import { getClientById } from "../models/client.js";
import { isAdminGeneralClient } from "../utils/admin-general.js";

export async function requireAdminGeneral(req, _res, next) {
  try {
    if (!req.user) {
      throw createError(401, "Sessão não autenticada");
    }
    if (req.user.role !== "admin") {
      throw createError(403, "Apenas administradores podem excluir registros");
    }
    const clientId = req.user.clientId;
    if (!clientId) {
      throw createError(403, "Cliente administrador não identificado");
    }
    const client = await getClientById(clientId);
    if (!client || !isAdminGeneralClient(client)) {
      throw createError(403, "Exclusões permitidas apenas para o ADMIN GERAL");
    }
    return next();
  } catch (error) {
    return next(error);
  }
}

export async function requireAdminGeneralAccess(req, _res, next) {
  try {
    if (!req.user) {
      throw createError(401, "Sessão não autenticada");
    }
    if (req.user.role !== "admin") {
      throw createError(403, "Acesso permitido apenas para o ADMIN GERAL");
    }
    const clientId = req.user.clientId;
    if (!clientId) {
      throw createError(403, "Cliente administrador não identificado");
    }
    const client = await getClientById(clientId);
    if (!client || !isAdminGeneralClient(client)) {
      throw createError(403, "Acesso permitido apenas para o ADMIN GERAL");
    }
    return next();
  } catch (error) {
    return next(error);
  }
}

export default {
  requireAdminGeneral,
  requireAdminGeneralAccess,
};
