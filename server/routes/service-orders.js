import express from "express";
import createError from "http-errors";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

import { authenticate, requireRole } from "../middleware/auth.js";
import { resolveClientId } from "../middleware/client.js";
import { getDeviceById, updateDevice } from "../models/device.js";
import { getVehicleById } from "../models/vehicle.js";
import prisma, { isPrismaAvailable } from "../services/prisma.js";

const router = express.Router();

router.use(authenticate);

const STATUS_FALLBACK = "SOLICITADA";
const CHECKLIST_STATUS_VALUES = new Set(["OK", "NOK"]);
const FINAL_STATUS_VALUES = new Set(["CONCLUIDA", "FINALIZADA", "FINALIZADO"]);

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

function formatYearMonth(date) {
  const year = date.getFullYear() % 100;
  const month = date.getMonth() + 1;
  return `${String(year).padStart(2, "0")}${String(month).padStart(2, "0")}`;
}

function parseSequence(value) {
  if (!value) return null;
  const parsed = Number.parseInt(String(value).replace(/\D/g, ""), 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function buildSequence(value) {
  const numeric = Number.isFinite(Number(value)) ? Number(value) : 1;
  const raw = String(numeric);
  return raw.length >= 4 ? raw : raw.padStart(4, "0");
}

async function generateOsInternalId(tx, { clientId, referenceDate }) {
  const prefix = formatYearMonth(referenceDate);
  const lastOrder = await tx.serviceOrder.findFirst({
    where: {
      clientId,
      osInternalId: { startsWith: prefix },
    },
    orderBy: { createdAt: "desc" },
    select: { osInternalId: true },
  });

  const lastSequence = lastOrder?.osInternalId?.slice(prefix.length) || null;
  const lastNumber = parseSequence(lastSequence);
  const nextNumber = lastNumber ? lastNumber + 1 : 1;
  return `${prefix}${buildSequence(nextNumber)}`;
}

function isFinalStatus(status) {
  if (!status) return false;
  return FINAL_STATUS_VALUES.has(String(status).toUpperCase());
}

function autoLinkEquipmentsToVehicle({ clientId, vehicleId, equipmentsData }) {
  if (!vehicleId || !Array.isArray(equipmentsData) || equipmentsData.length === 0) {
    return { linked: 0 };
  }

  const vehicle = getVehicleById(vehicleId);
  if (!vehicle || String(vehicle.clientId) !== String(clientId)) {
    return { linked: 0 };
  }

  let linked = 0;
  equipmentsData.forEach((equipment) => {
    const equipmentId = equipment?.equipmentId || equipment?.id;
    if (!equipmentId) return;
    const device = getDeviceById(equipmentId);
    if (!device || String(device.clientId) !== String(clientId)) return;
    if (String(device.vehicleId || "") === String(vehicleId)) return;
    updateDevice(device.id, { vehicleId });
    linked += 1;
  });

  return { linked };
}

function normalizeEquipmentsData(value) {
  if (!value) return null;
  let list = value;
  if (typeof value === "string") {
    try {
      list = JSON.parse(value);
    } catch (_error) {
      return null;
    }
  }
  if (!Array.isArray(list)) return null;

  const normalized = list
    .map((item) => ({
      equipmentId: item?.equipmentId || item?.id || null,
      model: item?.model || item?.name || item?.label || null,
      installLocation: item?.installLocation || item?.location || null,
    }))
    .filter((item) => item.equipmentId || item.model || item.installLocation);

  return normalized.length ? normalized : null;
}

function buildEquipmentsText(list) {
  if (!Array.isArray(list) || !list.length) return null;
  return list
    .map((item) => {
      const label = item.model || item.equipmentId || "Equipamento";
      if (item.installLocation) {
        return `${label} • ${item.installLocation}`;
      }
      return label;
    })
    .join("\n");
}

function normalizeChecklistItems(value) {
  if (!value) return null;
  let list = value;
  if (typeof value === "string") {
    try {
      list = JSON.parse(value);
    } catch (_error) {
      return null;
    }
  }
  if (!Array.isArray(list)) return null;
  const normalized = list
    .map((item) => {
      const before = item?.before ? String(item.before).toUpperCase() : null;
      const after = item?.after ? String(item.after).toUpperCase() : null;
      return {
        item: item?.item ? String(item.item) : null,
        before: CHECKLIST_STATUS_VALUES.has(before) ? before : before ? String(item.before) : null,
        after: CHECKLIST_STATUS_VALUES.has(after) ? after : after ? String(item.after) : null,
      };
    })
    .filter((entry) => entry.item);

  return normalized.length ? normalized : null;
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
              { clientName: { contains: search, mode: "insensitive" } },
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
      });
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
    const lineGap = 18;
    const equipmentList =
      item.equipmentsData || (item.equipmentsText ? [{ model: item.equipmentsText }] : null);
    const checklistItems = item.checklistItems || null;

    const fields = [
      ["Cliente", item.clientName || "—"],
      [
        "Veículo",
        item.vehicle
          ? `${item.vehicle.plate || "—"} • ${item.vehicle.model || item.vehicle.name || "—"}`
          : "—",
      ],
      ["Marca/Modelo", item.vehicle?.brand || item.vehicle?.model || "—"],
      ["Chassi", item.vehicle?.chassis || "—"],
      ["Renavam", item.vehicle?.renavam || "—"],
      ["Cor", item.vehicle?.color || "—"],
      ["Ano modelo/fabricação", [item.vehicle?.modelYear, item.vehicle?.manufactureYear].filter(Boolean).join(" / ") || "—"],
      ["Técnico", item.technicianName || "—"],
      ["Status", item.status || "—"],
      ["Tipo", item.type || "—"],
      ["Data/Hora", item.startAt ? new Date(item.startAt).toLocaleString("pt-BR") : "—"],
      ["Endereço partida", item.addressStart || "—"],
      ["Endereço serviço", item.address || "—"],
      ["Endereço volta", item.addressReturn || "—"],
      ["KM total", item.km ? `${item.km} km` : "—"],
      [
        "Equipamentos",
        equipmentList
          ? equipmentList
              .map((equipment) => {
                const label = equipment.model || equipment.equipmentId || "Equipamento";
                if (equipment.installLocation) {
                  return `${label} (${equipment.installLocation})`;
                }
                return label;
              })
              .join(" | ")
          : "—",
      ],
      [
        "Checklist",
        checklistItems
          ? checklistItems
              .map((entry) => `${entry.item}: ${entry.before || "—"} → ${entry.after || "—"}`)
              .join(" | ")
          : "—",
      ],
      ["Assinaturas", "—"],
      ["Observações", item.notes || "—"],
    ];

    fields.forEach(([label, value]) => {
      drawText(`${label}:`, 32, cursorY, { bold: true, size: 11, color: rgb(0.2, 0.8, 0.95) });
      drawText(String(value), 140, cursorY, { size: 11 });
      cursorY -= lineGap;
      if (cursorY < 80) {
        page = pdfDoc.addPage([595, 842]);
        cursorY = 780;
      }
    });

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

    const referenceDate = parseNullableDate(body.startAt) || new Date();
    const normalizedEquipments = normalizeEquipmentsData(body.equipmentsData || body.equipments);
    const normalizedChecklist = normalizeChecklistItems(body.checklistItems || body.checklist);
    const equipmentsText = body.equipmentsText
      ? String(body.equipmentsText)
      : buildEquipmentsText(normalizedEquipments);

    const resolvedVehicleId = body.vehiclePlate
      ? await resolveVehicleIdByPlate({ clientId, vehiclePlate: body.vehiclePlate })
      : null;

    let created = null;
    let lastError = null;

    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        created = await prisma.$transaction(async (tx) => {
          const osInternalId = await generateOsInternalId(tx, { clientId, referenceDate });

          return tx.serviceOrder.create({
            data: {
              clientId,
              osInternalId,
              clientName: body.clientName ? String(body.clientName) : null,
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
              equipmentsText,
              equipmentsData: normalizedEquipments,
              checklistItems: normalizedChecklist,
              vehicleId: resolvedVehicleId || (body.vehicleId ? String(body.vehicleId) : null),
            },
            include: {
              vehicle: { select: { id: true, plate: true, name: true } },
            },
          });
        }, { isolationLevel: "Serializable" });
        lastError = null;
        break;
      } catch (error) {
        lastError = error;
        if (error?.code === "P2002" && attempt < 2) {
          continue;
        }
        throw error;
      }
    }

    if (!created && lastError) {
      throw lastError;
    }

    const autoLinked = isFinalStatus(created?.status)
      ? autoLinkEquipmentsToVehicle({
          clientId,
          vehicleId: created.vehicleId,
          equipmentsData: created.equipmentsData,
        })
      : { linked: 0 };

    return res.status(201).json({ ok: true, item: created, equipmentsLinked: autoLinked.linked });
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
      select: { id: true, status: true },
    });

    if (!existing) {
      throw createError(404, "OS não encontrada");
    }

    const resolvedVehicleId = body.vehiclePlate
      ? await resolveVehicleIdByPlate({ clientId, vehiclePlate: body.vehiclePlate })
      : null;
    const normalizedEquipments = normalizeEquipmentsData(body.equipmentsData || body.equipments);
    const normalizedChecklist = normalizeChecklistItems(body.checklistItems || body.checklist);
    const equipmentsText =
      body.equipmentsText !== undefined
        ? body.equipmentsText
          ? String(body.equipmentsText)
          : null
        : normalizedEquipments
          ? buildEquipmentsText(normalizedEquipments)
          : undefined;

    const updated = await prisma.serviceOrder.update({
      where: { id },
      data: {
        osInternalId: body.osInternalId ? String(body.osInternalId) : undefined,
        clientName: body.clientName !== undefined ? (body.clientName ? String(body.clientName) : null) : undefined,
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
        equipmentsText,
        equipmentsData:
          body.equipmentsData !== undefined || body.equipments !== undefined ? normalizedEquipments : undefined,
        checklistItems:
          body.checklistItems !== undefined || body.checklist !== undefined ? normalizedChecklist : undefined,
        vehicleId:
          body.vehicleId !== undefined || resolvedVehicleId
            ? resolvedVehicleId || (body.vehicleId ? String(body.vehicleId) : null)
            : undefined,
      },
      include: {
        vehicle: { select: { id: true, plate: true, name: true } },
      },
    });

    const wasFinal = isFinalStatus(existing?.status);
    const isNowFinal = isFinalStatus(updated?.status);
    const autoLinked = isNowFinal && !wasFinal
      ? autoLinkEquipmentsToVehicle({
          clientId,
          vehicleId: updated.vehicleId,
          equipmentsData: updated.equipmentsData,
        })
      : { linked: 0 };

    return res.json({ ok: true, item: updated, equipmentsLinked: autoLinked.linked });
  } catch (error) {
    return next(error);
  }
});

export default router;
