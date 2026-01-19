import express from "express";
import createError from "http-errors";

import { authenticate, requireRole } from "../middleware/auth.js";
import { createClient, deleteClient, getClientById, listClients, updateClient } from "../models/client.js";
import { listDevices } from "../models/device.js";
import { listModels } from "../models/model.js";
import { listMirrors } from "../models/mirror.js";
import { listVehicles } from "../models/vehicle.js";
import { deleteUsersByClientId, listUsers } from "../models/user.js";
import { deleteGroupsByClientId } from "../models/group.js";

const router = express.Router();

router.use(authenticate);

router.get("/clients", requireRole("manager", "admin"), async (req, res, next) => {
  try {
    const allClients = await listClients();
    const vehicles = listVehicles();
    const devices = listDevices();
    const mirrors = listMirrors();
    const vehiclesCountByClient = new Map();
    const equipmentCountsByClient = new Map();
    const mirroredVehiclesByClient = new Map();

    vehicles.forEach((vehicle) => {
      const clientId = String(vehicle.clientId);
      vehiclesCountByClient.set(clientId, (vehiclesCountByClient.get(clientId) || 0) + 1);
    });

    devices.forEach((device) => {
      const clientId = String(device.clientId);
      const current = equipmentCountsByClient.get(clientId) || { linked: 0, available: 0 };
      if (device.vehicleId) {
        current.linked += 1;
      } else {
        current.available += 1;
      }
      equipmentCountsByClient.set(clientId, current);
    });

    mirrors.forEach((mirror) => {
      const ownerId = mirror.ownerClientId ? String(mirror.ownerClientId) : null;
      if (!ownerId) return;
      const vehicleIds = Array.isArray(mirror.vehicleIds) ? mirror.vehicleIds : [];
      const bucket = mirroredVehiclesByClient.get(ownerId) || new Set();
      vehicleIds.filter(Boolean).forEach((vehicleId) => bucket.add(String(vehicleId)));
      mirroredVehiclesByClient.set(ownerId, bucket);
    });

    const clientsWithCounts = allClients.map((client) => {
      const clientId = String(client.id);
      const equipmentCounts = equipmentCountsByClient.get(clientId) || { linked: 0, available: 0 };
      const mirroredVehicles = mirroredVehiclesByClient.get(clientId);
      return {
        ...client,
        documentNumber: client?.attributes?.clientProfile?.documentNumber || client?.attributes?.documentNumber || null,
        vehiclesCount: vehiclesCountByClient.get(clientId) || 0,
        equipmentsLinkedCount: equipmentCounts.linked,
        equipmentsAvailableCount: equipmentCounts.available,
        mirroredVehiclesCount: mirroredVehicles ? mirroredVehicles.size : 0,
      };
    });

    if (req.user.role === "admin") {
      return res.json({ clients: clientsWithCounts });
    }
    const clientId = req.user.clientId;
    if (!clientId) {
      return res.json({ clients: [] });
    }
    const client = clientsWithCounts.find((item) => String(item.id) === String(clientId)) || null;
    return res.json({ clients: client ? [client] : [] });
  } catch (error) {
    return next(error);
  }
});

router.get("/clients/:id", requireRole("manager", "admin"), async (req, res, next) => {
  try {
    const { id } = req.params;
    if (req.user.role !== "admin" && String(req.user.clientId) !== String(id)) {
      throw createError(403, "Permissão insuficiente para visualizar este cliente");
    }
    const client = await getClientById(id);
    if (!client) {
      throw createError(404, "Cliente não encontrado");
    }
    return res.json({ client });
  } catch (error) {
    return next(error);
  }
});

router.get("/clients/:id/details", requireRole("manager", "admin"), async (req, res, next) => {
  try {
    const { id } = req.params;
    if (req.user.role !== "admin" && String(req.user.clientId) !== String(id)) {
      throw createError(403, "Permissão insuficiente para visualizar este cliente");
    }
    const client = await getClientById(id);
    if (!client) {
      throw createError(404, "Cliente não encontrado");
    }

    const vehicles = listVehicles({ clientId: id });
    const devices = listDevices({ clientId: id });
    const users = listUsers({ clientId: id });
    const mirrors = listMirrors({ ownerClientId: id });
    const models = listModels({ clientId: id, includeGlobal: true });
    const clientDirectory = await listClients();
    const clientNameMap = new Map(clientDirectory.map((entry) => [String(entry.id), entry.name]));
    const modelNameMap = new Map(models.map((model) => [String(model.id), model.name]));
    const vehicleMap = new Map(vehicles.map((vehicle) => [String(vehicle.id), vehicle]));

    const equipmentModelCounts = new Map();
    const equipments = devices.map((device) => {
      const modelName = device.modelId ? modelNameMap.get(String(device.modelId)) : null;
      const label = modelName || "Sem modelo";
      equipmentModelCounts.set(label, (equipmentModelCounts.get(label) || 0) + 1);
      const linkedVehicle = device.vehicleId ? vehicleMap.get(String(device.vehicleId)) : null;
      return {
        id: device.id,
        name: device.name || device.uniqueId || "Equipamento",
        uniqueId: device.uniqueId || null,
        model: modelName || null,
        vehicleId: device.vehicleId || null,
        vehicleLabel: linkedVehicle ? linkedVehicle.name || linkedVehicle.plate || "" : null,
      };
    });

    const equipmentModelsSummary = Array.from(equipmentModelCounts.entries())
      .map(([model, count]) => ({ model, count }))
      .sort((a, b) => b.count - a.count || a.model.localeCompare(b.model));

    const mirrorPayload = mirrors.map((mirror) => ({
      id: mirror.id,
      ownerClientId: mirror.ownerClientId,
      targetClientId: mirror.targetClientId,
      targetClientName: mirror.targetClientId ? clientNameMap.get(String(mirror.targetClientId)) : null,
      vehicleIds: mirror.vehicleIds || [],
      startAt: mirror.startAt || null,
      endAt: mirror.endAt || null,
    }));

    return res.json({
      summary: {
        vehiclesCount: vehicles.length,
        usersCount: users.length,
        equipmentModelsSummary,
      },
      vehicles,
      equipments,
      users,
      mirrors: mirrorPayload,
    });
  } catch (error) {
    return next(error);
  }
});

router.post("/clients", requireRole("admin"), async (req, res, next) => {
  try {
    const { name, deviceLimit, userLimit, attributes = {} } = req.body || {};
    if (!name) {
      throw createError(400, "Nome é obrigatório");
    }
    const client = await createClient({
      name,
      deviceLimit,
      userLimit,
      attributes: { companyName: attributes.companyName || name, ...attributes },
    });
    return res.status(201).json({ client });
  } catch (error) {
    return next(error);
  }
});

router.put("/clients/:id", requireRole("manager", "admin"), async (req, res, next) => {
  try {
    const { id } = req.params;
    if (req.user.role !== "admin" && String(req.user.clientId) !== String(id)) {
      throw createError(403, "Permissão insuficiente para atualizar este cliente");
    }
    const client = await updateClient(id, req.body || {});
    return res.json({ client });
  } catch (error) {
    return next(error);
  }
});

router.delete("/clients/:id", requireRole("admin"), (req, res, next) => {
  try {
    const { id } = req.params;
    deleteClient(id);
    deleteUsersByClientId(id);
    deleteGroupsByClientId(id);
    return res.status(204).send();
  } catch (error) {
    return next(error);
  }
});

router.get("/clients/:id/users", requireRole("admin"), (req, res, next) => {
  try {
    const { id } = req.params;
    const users = listUsers({ clientId: id });
    return res.json({ users });
  } catch (error) {
    return next(error);
  }
});

export default router;
