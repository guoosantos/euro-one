import express from "express";
import createError from "http-errors";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

import { authenticate, requireRole } from "../middleware/auth.js";
import { resolveClientId } from "../middleware/client.js";
import prisma, { isPrismaAvailable } from "../services/prisma.js";

const router = express.Router();

router.use(authenticate);

const STATUS_FALLBACK = "SOLICITADA";
const MAX_OS_SEQUENCE_RETRIES = 3;

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

function isPrismaUniqueError(error) {
  return error?.code === "P2002";
}

function buildOsPrefix(date) {
  const safeDate = date instanceof Date && !Number.isNaN(date.getTime()) ? date : new Date();
  const year = String(safeDate.getFullYear()).slice(-2);
  const month = String(safeDate.getMonth() + 1).padStart(2, "0");
  return `${year}${month}`;
}

function formatSequence(sequence) {
  const raw = String(sequence);
  const length = Math.max(4, raw.length);
  return raw.padStart(length, "0");
}

async function generateOsInternalId(tx, { clientId, startAt }) {
  const prefix = buildOsPrefix(startAt);
  const searchPrefix = `${prefix}%`;
  const result = await tx.$queryRaw`
    SELECT MAX(CAST(SUBSTRING("osInternalId", 5) AS INTEGER)) AS "maxSequence"
    FROM "ServiceOrder"
    WHERE "clientId" = ${clientId}
      AND "osInternalId" LIKE ${searchPrefix}
  `;
  const maxSequence = Array.isArray(result) && result.length ? Number(result[0]?.maxSequence) : null;
  const nextSequence = Number.isFinite(maxSequence) ? maxSequence + 1 : 1;
  return `${prefix}${formatSequence(nextSequence)}`;
}

function normalizeChecklist(value) {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value) || typeof value === "object") return value;
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch (error) {
      return value;
    }
  }
  return null;
}

function normalizeEquipmentsText(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch (error) {
    return null;
  }
}

function parseEquipmentsText(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (typeof value === "object") return Array.isArray(value.items) ? value.items : [];
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed;
      if (parsed && typeof parsed === "object") return Array.isArray(parsed.items) ? parsed.items : [];
      return [];
    } catch (error) {
      return [];
    }
  }
  return [];
}

function parseChecklist(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (typeof value === "object") {
    if (Array.isArray(value.items)) return value.items;
    if (Array.isArray(value.checklist)) return value.checklist;
    return Object.values(value);
  }
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed;
      if (parsed && typeof parsed === "object") {
        if (Array.isArray(parsed.items)) return parsed.items;
        if (Array.isArray(parsed.checklist)) return parsed.checklist;
        return Object.values(parsed);
      }
      return [];
    } catch (error) {
      return [];
    }
  }
  return [];
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

router.get("/service-orders/vehicles/:vehicleId/equipments", async (req, res, next) => {
  try {
    ensurePrisma();
    const clientId = resolveClientId(req, req.query?.clientId, { required: true });
    const vehicleId = String(req.params.vehicleId);

    const items = await prisma.equipment.findMany({
      where: {
        clientId,
        vehicleId,
      },
      include: {
        product: { select: { name: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    const payload = items.map((item) => ({
      id: item.id,
      internalId: item.internalId,
      status: item.status,
      condition: item.condition,
      location: item.location,
      productName: item.product?.name || null,
      vehicleId: item.vehicleId,
    }));

    return res.json({ ok: true, items: payload });
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
        vehicle: {
          select: {
            id: true,
            plate: true,
            name: true,
            model: true,
            brand: true,
            chassis: true,
            renavam: true,
            color: true,
            modelYear: true,
            manufactureYear: true,
          },
        },
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

router.get("/service-orders/:id/pdf", async (req, res, next) => {
  try {
    ensurePrisma();
    const clientId = resolveClientId(req, req.query?.clientId, { required: true });
    const item = await prisma.serviceOrder.findFirst({
      where: {
        id: String(req.params.id),
        clientId,
      },
      include: {
        vehicle: {
          select: {
            id: true,
            plate: true,
            name: true,
            model: true,
            brand: true,
            chassis: true,
            renavam: true,
            color: true,
            modelYear: true,
            manufactureYear: true,
          },
        },
      },
    });

    if (!item) {
      throw createError(404, "OS não encontrada");
    }

    const pdfDoc = await PDFDocument.create();
    let page = pdfDoc.addPage([595, 842]);
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    const drawText = (text, x, y, options = {}) => {
      page.drawText(text, {
        x,
        y,
        size: options.size || 12,
        font: options.bold ? boldFont : font,
        color: options.color || rgb(0.9, 0.9, 0.9),
        maxWidth: options.maxWidth,
      });
    };

    const drawSectionTitle = (title, y) => {
      drawText(title, 32, y, { size: 12, bold: true, color: rgb(0.2, 0.8, 0.95) });
      return y - 16;
    };

    const drawKeyValue = (label, value, y) => {
      drawText(`${label}:`, 32, y, { bold: true, size: 10, color: rgb(0.2, 0.8, 0.95) });
      drawText(String(value ?? "—"), 140, y, { size: 10, maxWidth: 420 });
      return y - 14;
    };

    const ensureSpace = (y, needed = 60) => {
      if (y < needed) {
        page = pdfDoc.addPage([595, 842]);
        return 780;
      }
      return y;
    };

    page.drawRectangle({
      x: 0,
      y: 760,
      width: 595,
      height: 82,
      color: rgb(0.08, 0.13, 0.2),
    });

    drawText("EuroOne • Ordem de Serviço", 32, 800, { size: 18, bold: true });
    drawText(`OS ${item.osInternalId || item.id.slice(0, 8)}`, 32, 776, { size: 12 });

    let cursorY = 730;
    cursorY = drawSectionTitle("Dados gerais", cursorY);
    cursorY = drawKeyValue("Cliente", item.clientName || "—", cursorY);
    cursorY = drawKeyValue("Status", item.status || "—", cursorY);
    cursorY = drawKeyValue("Tipo", item.type || "—", cursorY);
    cursorY = drawKeyValue(
      "Data/Hora",
      item.startAt ? new Date(item.startAt).toLocaleString("pt-BR") : "—",
      cursorY,
    );
    cursorY = drawKeyValue("Técnico", item.technicianName || "—", cursorY);
    cursorY = drawKeyValue("Responsável", item.responsibleName || "—", cursorY);
    cursorY = drawKeyValue("Telefone", item.responsiblePhone || "—", cursorY);

    cursorY = ensureSpace(cursorY);
    cursorY = drawSectionTitle("Endereços", cursorY);
    cursorY = drawKeyValue("Partida", item.addressStart || "—", cursorY);
    cursorY = drawKeyValue("Serviço", item.address || "—", cursorY);
    cursorY = drawKeyValue("Volta", item.addressReturn || "—", cursorY);
    cursorY = drawKeyValue("KM Total", item.km ? `${item.km} km` : "—", cursorY);

    cursorY = ensureSpace(cursorY);
    cursorY = drawSectionTitle("Veículo", cursorY);
    cursorY = drawKeyValue("Placa", item.vehicle?.plate || item.vehicle?.name || "—", cursorY);
    cursorY = drawKeyValue("Modelo", item.vehicle?.model || item.vehicle?.name || "—", cursorY);
    cursorY = drawKeyValue("Marca", item.vehicle?.brand || "—", cursorY);
    cursorY = drawKeyValue("Chassi", item.vehicle?.chassis || "—", cursorY);
    cursorY = drawKeyValue("Renavam", item.vehicle?.renavam || "—", cursorY);
    cursorY = drawKeyValue("Cor", item.vehicle?.color || "—", cursorY);
    cursorY = drawKeyValue("Ano Modelo", item.vehicle?.modelYear || "—", cursorY);
    cursorY = drawKeyValue("Ano Fabricação", item.vehicle?.manufactureYear || "—", cursorY);

    cursorY = ensureSpace(cursorY);
    cursorY = drawSectionTitle("Equipamentos", cursorY);
    const equipments = parseEquipmentsText(item.equipmentsText);
    if (equipments.length) {
      equipments.forEach((equipment) => {
        cursorY = ensureSpace(cursorY, 80);
        const label = equipment.model || equipment.internalId || equipment.equipmentId || "Equipamento";
        const location = equipment.installLocation || "—";
        cursorY = drawKeyValue(label, `Local: ${location}`, cursorY);
      });
    } else {
      cursorY = drawKeyValue("Equipamentos", "—", cursorY);
    }

    cursorY = ensureSpace(cursorY);
    cursorY = drawSectionTitle("Checklist", cursorY);
    const checklist = parseChecklist(item.checklist);
    if (checklist.length) {
      checklist.forEach((entry) => {
        cursorY = ensureSpace(cursorY, 80);
        const before = entry.before || \"—\";
        const after = entry.after || \"—\";
        cursorY = drawKeyValue(entry.label || entry.key || \"Item\", `Antes: ${before} • Depois: ${after}`, cursorY);
      });
    } else {
      cursorY = drawKeyValue(\"Checklist\", \"—\", cursorY);
    }

    cursorY = ensureSpace(cursorY);
    cursorY = drawSectionTitle(\"Observações\", cursorY);
    drawText(String(item.notes || \"—\"), 32, cursorY, { size: 10, maxWidth: 520 });

    const buffer = await pdfDoc.save();
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="os-${item.osInternalId || item.id.slice(0, 8)}.pdf"`,
    );
    res.send(Buffer.from(buffer));
  } catch (error) {
    return next(error);
  }
});

router.post("/service-orders", requireRole("manager", "admin"), async (req, res, next) => {
  try {
    ensurePrisma();
    const clientId = resolveClientId(req, req.body?.clientId, { required: true });
    const body = req.body || {};

    const resolvedVehicleId = body.vehiclePlate
      ? await resolveVehicleIdByPlate({ clientId, vehiclePlate: body.vehiclePlate })
      : null;
    const startAt = parseNullableDate(body.startAt) || new Date();

    let created = null;
    for (let attempt = 0; attempt < MAX_OS_SEQUENCE_RETRIES; attempt += 1) {
      try {
        created = await prisma.$transaction(async (tx) => {
          const osInternalId = await generateOsInternalId(tx, { clientId, startAt });
          return tx.serviceOrder.create({
            data: {
              clientId,
              osInternalId,
              type: body.type ? String(body.type) : null,
              status: body.status ? String(body.status) : STATUS_FALLBACK,
              startAt,
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
              equipmentsText: normalizeEquipmentsText(body.equipmentsText),
              checklist: normalizeChecklist(body.checklist),
              clientName: body.clientName ? String(body.clientName) : null,
              crmClientId: body.crmClientId ? String(body.crmClientId) : null,
              vehicleId: resolvedVehicleId || (body.vehicleId ? String(body.vehicleId) : null),
            },
            include: {
              vehicle: { select: { id: true, plate: true, name: true } },
            },
          });
        });
        break;
      } catch (error) {
        if (isPrismaUniqueError(error) && attempt < MAX_OS_SEQUENCE_RETRIES - 1) {
          continue;
        }
        throw error;
      }
    }

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
          body.equipmentsText !== undefined ? normalizeEquipmentsText(body.equipmentsText) : undefined,
        checklist: body.checklist !== undefined ? normalizeChecklist(body.checklist) : undefined,
        clientName: body.clientName !== undefined ? (body.clientName ? String(body.clientName) : null) : undefined,
        crmClientId: body.crmClientId !== undefined ? (body.crmClientId ? String(body.crmClientId) : null) : undefined,
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
