import express from "express";
import createError from "http-errors";
import { randomUUID } from "crypto";

import { authenticate, requireRole } from "../middleware/auth.js";
import { resolveClientId } from "../middleware/client.js";
import prisma, { isPrismaAvailable } from "../services/prisma.js";

const router = express.Router();

router.use(authenticate);

const STATUS_FALLBACK = "SOLICITADA";

function ensurePrisma() {
  if (!isPrismaAvailable()) {
    throw createError(503, "Banco de dados indisponível");
  }
}

function parseNullableDate(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function parseNullableNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

async function resolveVehicleIdByPlate({ clientId, vehiclePlate }) {
  if (!vehiclePlate) return null;
  const plate = String(vehiclePlate).trim();
  if (!plate) return null;
  const vehicle = await prisma.vehicle.findFirst({
    where: {
      clientId,
      plate: { equals: plate, mode: "insensitive" },
    },
    select: { id: true },
  });
  return vehicle?.id || null;
}

router.get("/service-orders", async (req, res, next) => {
  try {
    ensurePrisma();
    const clientId = resolveClientId(req, req.query?.clientId, { required: true });
    const { status, vehicleId, q } = req.query || {};
    const search = String(q || "").trim();

    const where = {
      clientId,
      ...(status ? { status: String(status) } : {}),
      ...(vehicleId ? { vehicleId: String(vehicleId) } : {}),
      ...(search
        ? {
            OR: [
              { osInternalId: { contains: search, mode: "insensitive" } },
              { technicianName: { contains: search, mode: "insensitive" } },
              { responsibleName: { contains: search, mode: "insensitive" } },
              { responsiblePhone: { contains: search, mode: "insensitive" } },
              { address: { contains: search, mode: "insensitive" } },
              { reason: { contains: search, mode: "insensitive" } },
              { notes: { contains: search, mode: "insensitive" } },
              { serial: { contains: search, mode: "insensitive" } },
              { externalRef: { contains: search, mode: "insensitive" } },
              { equipmentsText: { contains: search, mode: "insensitive" } },
              { vehicle: { plate: { contains: search, mode: "insensitive" } } },
              { vehicle: { name: { contains: search, mode: "insensitive" } } },
            ],
          }
        : {}),
    };

    const items = await prisma.serviceOrder.findMany({
      where,
      include: {
        vehicle: { select: { id: true, plate: true, name: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 500,
    });

    return res.json({ ok: true, items });
  } catch (error) {
    return next(error);
  }
});

router.get("/service-orders/:id", async (req, res, next) => {
  try {
    ensurePrisma();
    const clientId = resolveClientId(req, req.query?.clientId, { required: true });
    const item = await prisma.serviceOrder.findFirst({
      where: {
        id: String(req.params.id),
        clientId,
      },
      include: {
        vehicle: { select: { id: true, plate: true, name: true } },
      },
    });

    if (!item) {
      throw createError(404, "OS não encontrada");
    }

    return res.json({ ok: true, item });
  } catch (error) {
    return next(error);
  }
});

router.post("/service-orders", requireRole("manager", "admin"), async (req, res, next) => {
  try {
    ensurePrisma();
    const clientId = resolveClientId(req, req.body?.clientId, { required: true });
    const body = req.body || {};

    const osInternalId = String(body.osInternalId || "").trim() || `OS-${randomUUID().slice(0, 8)}`;

    const resolvedVehicleId = body.vehiclePlate
      ? await resolveVehicleIdByPlate({ clientId, vehiclePlate: body.vehiclePlate })
      : null;

    const created = await prisma.serviceOrder.create({
      data: {
        clientId,
        osInternalId,
        type: body.type ? String(body.type) : null,
        status: body.status ? String(body.status) : STATUS_FALLBACK,
        startAt: parseNullableDate(body.startAt),
        endAt: parseNullableDate(body.endAt),
        technicianName: body.technicianName ? String(body.technicianName) : null,
        address: body.address ? String(body.address) : null,
        addressStart: body.addressStart ? String(body.addressStart) : null,
        addressReturn: body.addressReturn ? String(body.addressReturn) : null,
        km: parseNullableNumber(body.km),
        reason: body.reason ? String(body.reason) : null,
        notes: body.notes ? String(body.notes) : null,
        responsibleName: body.responsibleName ? String(body.responsibleName) : null,
        responsiblePhone: body.responsiblePhone ? String(body.responsiblePhone) : null,
        clientValue: parseNullableNumber(body.clientValue),
        technicianValue: parseNullableNumber(body.technicianValue),
        serial: body.serial ? String(body.serial) : null,
        externalRef: body.externalRef ? String(body.externalRef) : null,
        equipmentsText: body.equipmentsText ? String(body.equipmentsText) : null,
        vehicleId: resolvedVehicleId || (body.vehicleId ? String(body.vehicleId) : null),
      },
      include: {
        vehicle: { select: { id: true, plate: true, name: true } },
      },
    });

    return res.status(201).json({ ok: true, item: created });
  } catch (error) {
    return next(error);
  }
});

router.patch("/service-orders/:id", async (req, res, next) => {
  try {
    ensurePrisma();
    const clientId = resolveClientId(req, req.body?.clientId, { required: true });
    const body = req.body || {};
    const id = String(req.params.id);

    const existing = await prisma.serviceOrder.findFirst({
      where: { id, clientId },
      select: { id: true },
    });

    if (!existing) {
      throw createError(404, "OS não encontrada");
    }

    const resolvedVehicleId = body.vehiclePlate
      ? await resolveVehicleIdByPlate({ clientId, vehiclePlate: body.vehiclePlate })
      : null;

    const updated = await prisma.serviceOrder.update({
      where: { id },
      data: {
        osInternalId: body.osInternalId ? String(body.osInternalId) : undefined,
        type: body.type !== undefined ? (body.type ? String(body.type) : null) : undefined,
        status: body.status !== undefined ? String(body.status) : undefined,
        startAt: body.startAt !== undefined ? parseNullableDate(body.startAt) : undefined,
        endAt: body.endAt !== undefined ? parseNullableDate(body.endAt) : undefined,
        technicianName:
          body.technicianName !== undefined ? (body.technicianName ? String(body.technicianName) : null) : undefined,
        address: body.address !== undefined ? (body.address ? String(body.address) : null) : undefined,
        addressStart: body.addressStart !== undefined ? (body.addressStart ? String(body.addressStart) : null) : undefined,
        addressReturn:
          body.addressReturn !== undefined ? (body.addressReturn ? String(body.addressReturn) : null) : undefined,
        km: body.km !== undefined ? parseNullableNumber(body.km) : undefined,
        reason: body.reason !== undefined ? (body.reason ? String(body.reason) : null) : undefined,
        notes: body.notes !== undefined ? (body.notes ? String(body.notes) : null) : undefined,
        responsibleName:
          body.responsibleName !== undefined ? (body.responsibleName ? String(body.responsibleName) : null) : undefined,
        responsiblePhone:
          body.responsiblePhone !== undefined ? (body.responsiblePhone ? String(body.responsiblePhone) : null) : undefined,
        clientValue: body.clientValue !== undefined ? parseNullableNumber(body.clientValue) : undefined,
        technicianValue: body.technicianValue !== undefined ? parseNullableNumber(body.technicianValue) : undefined,
        serial: body.serial !== undefined ? (body.serial ? String(body.serial) : null) : undefined,
        externalRef: body.externalRef !== undefined ? (body.externalRef ? String(body.externalRef) : null) : undefined,
        equipmentsText:
          body.equipmentsText !== undefined ? (body.equipmentsText ? String(body.equipmentsText) : null) : undefined,
        vehicleId:
          body.vehicleId !== undefined || resolvedVehicleId
            ? resolvedVehicleId || (body.vehicleId ? String(body.vehicleId) : null)
            : undefined,
      },
      include: {
        vehicle: { select: { id: true, plate: true, name: true } },
      },
    });

    return res.json({ ok: true, item: updated });
  } catch (error) {
    return next(error);
  }
});

export default router;
