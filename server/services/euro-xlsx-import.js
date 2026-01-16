import ExcelJS from "exceljs";
import createError from "http-errors";

import prisma, { isPrismaAvailable } from "./prisma.js";

const REQUIRED_SHEETS = ["VEICULOS_FINAL", "EQUIPAMENTOS", "OS_DETALHADA"];

const VEHICLE_COLUMNS = [
  "Placa",
  "Cliente",
  "Marca",
  "Modelo",
  "Ano",
  "Tipo",
  "Situação",
  "Chassi",
  "Renavam",
  "Cor",
  "Veículo (unique id)",
  "Equipamentos (ID | Produto | Status | Local)",
  "OS (ID interno | Data | Status | Tipo)",
  "Qtd equipamentos",
  "Qtd OS",
];

const EQUIPMENT_COLUMNS = [
  "Placa",
  "Cliente",
  "ID interno",
  "Produto",
  "Status",
  "Condição",
  "Local",
  "Garantia (em dias)",
  "Valor",
  "Creation Date",
  "Modified Date",
  "Equipamento (unique id)",
];

const SERVICE_ORDER_COLUMNS = [
  "Placa",
  "Cliente",
  "OS (ID interno)",
  "Tipo",
  "Status",
  "Data início",
  "Data fim",
  "Técnico",
  "Endereço",
  "Endereço de saída",
  "Endereço retorno",
  "KM",
  "Motivo",
  "Observação",
  "Responsável - nome",
  "Responsável - telefone",
  "Valor (cliente)",
  "Valor (técnico)",
  "Serial",
  "OS (unique id)",
  "Creation Date",
  "Modified Date",
  "Equipamentos do veículo",
];

const MAX_PREVIEW_ITEMS = 120;

function normalizeText(value) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function normalizeKey(value) {
  return normalizeText(value).toLowerCase();
}

function normalizePlate(value) {
  return normalizeText(value).replace(/[\s-]/g, "").toUpperCase();
}

function parseCellValue(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (value instanceof Date) return value;
  if (typeof value === "object") {
    if (value.text) return value.text;
    if (value.richText) return value.richText.map((item) => item.text).join("");
    if (value.result) return value.result;
    if (value.hyperlink) return value.text || value.hyperlink;
    if (value.formula) return value.result || null;
  }
  return value;
}

function parseExcelDate(value) {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value === "number") {
    const excelEpoch = new Date(Date.UTC(1899, 11, 30));
    const date = new Date(excelEpoch.getTime() + value * 86400 * 1000);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const text = normalizeText(value);
  if (!text) return null;
  const parsed = new Date(text);
  if (!Number.isNaN(parsed.getTime())) return parsed;
  const [datePart] = text.split(" ");
  const [day, month, year] = datePart.split("/");
  if (day && month && year) {
    const fallback = new Date(Number(year), Number(month) - 1, Number(day));
    return Number.isNaN(fallback.getTime()) ? null : fallback;
  }
  return null;
}

function parseInteger(value) {
  const text = normalizeText(value);
  if (!text) return null;
  const parsed = Number(text.replace(/[^0-9-]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function parseDecimal(value) {
  const text = normalizeText(value);
  if (!text) return null;
  const normalized = text.replace(/\./g, "").replace(/,/g, ".");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function buildHeaderMap(worksheet, requiredColumns) {
  const headerRow = worksheet.getRow(1);
  const headerMap = {};
  headerRow.eachCell((cell, colNumber) => {
    const header = normalizeText(parseCellValue(cell.value));
    if (!header) return;
    headerMap[header] = colNumber;
  });

  const missing = requiredColumns.filter((column) => !headerMap[column]);
  if (missing.length) {
    const error = createError(400, `Colunas ausentes na planilha ${worksheet.name}`);
    error.details = { missingColumns: missing, sheet: worksheet.name };
    throw error;
  }

  return headerMap;
}

function readSheetRows(worksheet, requiredColumns) {
  const headerMap = buildHeaderMap(worksheet, requiredColumns);
  const rows = [];

  worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return;
    const data = { __rowNumber: rowNumber };
    let hasValue = false;
    requiredColumns.forEach((column) => {
      const cell = row.getCell(headerMap[column]);
      const value = parseCellValue(cell.value);
      if (value !== null && value !== undefined && value !== "") {
        hasValue = true;
      }
      data[column] = value;
    });
    if (hasValue) {
      rows.push(data);
    }
  });

  return rows;
}

function toSummaryEntry(value) {
  return value && typeof value === "object" ? value : { count: value || 0 };
}

export async function importEuroXlsx({
  buffer,
  mode,
  importMode,
  targetClientId,
  fileName,
  user,
}) {
  if (!isPrismaAvailable()) {
    throw createError(503, "Banco de dados indisponível para importação");
  }

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);

  const missingSheets = REQUIRED_SHEETS.filter((name) => !workbook.getWorksheet(name));
  if (missingSheets.length) {
    const error = createError(400, "Planilhas obrigatórias não encontradas no XLSX");
    error.details = { missingSheets };
    throw error;
  }

  const vehiclesSheet = workbook.getWorksheet("VEICULOS_FINAL");
  const equipmentSheet = workbook.getWorksheet("EQUIPAMENTOS");
  const serviceOrderSheet = workbook.getWorksheet("OS_DETALHADA");

  const vehiclesRows = readSheetRows(vehiclesSheet, VEHICLE_COLUMNS);
  const equipmentRows = readSheetRows(equipmentSheet, EQUIPMENT_COLUMNS);
  const serviceOrderRows = readSheetRows(serviceOrderSheet, SERVICE_ORDER_COLUMNS);

  const warnings = [];
  const errors = [];
  const preview = [];
  const now = new Date();

  const isApply = mode === "apply";

  const clientNameSet = new Map();
  if (importMode === "byClientName") {
    [vehiclesRows, equipmentRows, serviceOrderRows].forEach((rows) => {
      rows.forEach((row) => {
        const name = normalizeText(row.Cliente);
        if (!name) return;
        clientNameSet.set(normalizeKey(name), name);
      });
    });
  }

  const clientMapByName = new Map();
  const clientSummary = { created: 0, matched: 0 };

  if (importMode === "singleClient") {
    if (!targetClientId) {
      throw createError(400, "targetClientId é obrigatório no modo singleClient");
    }
    const client = await prisma.client.findUnique({ where: { id: String(targetClientId) } });
    if (!client) {
      throw createError(404, "Cliente não encontrado para importação");
    }
    clientMapByName.set("__single__", client);
    clientSummary.matched = 1;
  } else if (importMode === "byClientName") {
    for (const [normalized, name] of clientNameSet.entries()) {
      const existing = await prisma.client.findFirst({
        where: { name: { equals: name, mode: "insensitive" } },
      });
      if (existing) {
        clientMapByName.set(normalized, existing);
        clientSummary.matched += 1;
      } else if (isApply) {
        const created = await prisma.client.create({
          data: { name },
        });
        clientMapByName.set(normalized, created);
        clientSummary.created += 1;
      } else {
        clientMapByName.set(normalized, {
          id: `dry-run:${normalized}`,
          name,
        });
        clientSummary.created += 1;
      }
    }
  }

  const vehiclesByClient = new Map();
  const productsByClient = new Map();
  const equipmentsByClient = new Map();
  const serviceOrdersByClient = new Map();
  const equipmentCountByVehicle = new Map();
  const serviceOrderCountByVehicle = new Map();
  const vehicleCountExpectations = new Map();

  function resolveClientIdFromRow(row, sheetName) {
    if (importMode === "singleClient") {
      const client = clientMapByName.get("__single__");
      const rawName = normalizeText(row.Cliente);
      if (rawName && client && rawName !== client.name) {
        warnings.push({
          type: "cliente-diferente",
          sheet: sheetName,
          row: row.__rowNumber,
          message: `Cliente da linha difere do alvo (${rawName} != ${client.name}).`,
        });
      }
      return client?.id || null;
    }
    const name = normalizeText(row.Cliente);
    if (!name) {
      warnings.push({
        type: "cliente-ausente",
        sheet: sheetName,
        row: row.__rowNumber,
        message: "Cliente não informado para esta linha.",
      });
      return null;
    }
    const client = clientMapByName.get(normalizeKey(name));
    if (!client) {
      warnings.push({
        type: "cliente-nao-encontrado",
        sheet: sheetName,
        row: row.__rowNumber,
        message: `Cliente não encontrado para '${name}'.`,
      });
      return null;
    }
    return client.id;
  }

  vehiclesRows.forEach((row) => {
    const clientId = resolveClientIdFromRow(row, "VEICULOS_FINAL");
    if (!clientId) return;
    const plate = normalizeText(row.Placa);
    if (!plate) {
      warnings.push({
        type: "placa-ausente",
        sheet: "VEICULOS_FINAL",
        row: row.__rowNumber,
        message: "Placa não informada para veículo.",
      });
      return;
    }
    const plateNormalized = normalizePlate(plate);
    const vehicleKey = `${clientId}:${plateNormalized}`;
    const vehicleMap = vehiclesByClient.get(clientId) || new Map();
    vehicleMap.set(vehicleKey, {
      clientId,
      plate: plateNormalized,
      rawPlate: plate,
      brand: normalizeText(row.Marca) || null,
      model: normalizeText(row.Modelo) || null,
      modelYear: parseInteger(row.Ano),
      type: normalizeText(row.Tipo) || null,
      status: normalizeText(row["Situação"]) || null,
      chassis: normalizeText(row.Chassi) || null,
      renavam: normalizeText(row.Renavam) || null,
      color: normalizeText(row.Cor) || null,
      externalRef: normalizeText(row["Veículo (unique id)"]) || null,
    });
    vehiclesByClient.set(clientId, vehicleMap);

    const expectedEquipments = parseInteger(row["Qtd equipamentos"]);
    const expectedOrders = parseInteger(row["Qtd OS"]);
    vehicleCountExpectations.set(vehicleKey, {
      equipments: Number.isFinite(expectedEquipments) ? expectedEquipments : null,
      orders: Number.isFinite(expectedOrders) ? expectedOrders : null,
    });
  });

  function registerProduct(clientId, productName) {
    if (!productName) return;
    const normalizedName = normalizeKey(productName);
    const map = productsByClient.get(clientId) || new Map();
    if (!map.has(normalizedName)) {
      map.set(normalizedName, {
        clientId,
        name: productName,
        nameNormalized: normalizedName,
      });
    }
    productsByClient.set(clientId, map);
  }

  function countByVehicle(map, key) {
    const current = map.get(key) || 0;
    map.set(key, current + 1);
  }

  equipmentRows.forEach((row) => {
    const clientId = resolveClientIdFromRow(row, "EQUIPAMENTOS");
    if (!clientId) return;
    const plate = normalizeText(row.Placa);
    const plateNormalized = normalizePlate(plate);
    const vehicleKey = plateNormalized ? `${clientId}:${plateNormalized}` : null;
    if (!plateNormalized) {
      warnings.push({
        type: "placa-ausente",
        sheet: "EQUIPAMENTOS",
        row: row.__rowNumber,
        message: "Placa não informada para equipamento.",
      });
    } else if (!vehiclesByClient.get(clientId)?.has(vehicleKey)) {
      warnings.push({
        type: "veiculo-nao-encontrado",
        sheet: "EQUIPAMENTOS",
        row: row.__rowNumber,
        message: `Placa ${plate} não encontrada na aba VEICULOS_FINAL.`,
      });
    }

    const internalId = normalizeText(row["ID interno"]);
    if (!internalId) {
      warnings.push({
        type: "equipamento-id-ausente",
        sheet: "EQUIPAMENTOS",
        row: row.__rowNumber,
        message: "ID interno do equipamento não informado.",
      });
      return;
    }

    const productName = normalizeText(row.Produto) || null;
    registerProduct(clientId, productName);

    const equipment = {
      clientId,
      vehicleKey,
      internalId,
      productName,
      status: normalizeText(row.Status) || null,
      condition: normalizeText(row["Condição"]) || null,
      location: normalizeText(row.Local) || null,
      warrantyDays: parseInteger(row["Garantia (em dias)"]),
      priceValue: parseDecimal(row.Valor),
      externalRef: normalizeText(row["Equipamento (unique id)"]) || null,
      createdAt: parseExcelDate(row["Creation Date"]),
      updatedAt: parseExcelDate(row["Modified Date"]),
    };

    const list = equipmentsByClient.get(clientId) || [];
    list.push(equipment);
    equipmentsByClient.set(clientId, list);

    if (vehicleKey) {
      countByVehicle(equipmentCountByVehicle, vehicleKey);
    }
  });

  serviceOrderRows.forEach((row) => {
    const clientId = resolveClientIdFromRow(row, "OS_DETALHADA");
    if (!clientId) return;
    const plate = normalizeText(row.Placa);
    const plateNormalized = normalizePlate(plate);
    const vehicleKey = plateNormalized ? `${clientId}:${plateNormalized}` : null;
    if (!plateNormalized) {
      warnings.push({
        type: "placa-ausente",
        sheet: "OS_DETALHADA",
        row: row.__rowNumber,
        message: "Placa não informada para OS.",
      });
    } else if (!vehiclesByClient.get(clientId)?.has(vehicleKey)) {
      warnings.push({
        type: "veiculo-nao-encontrado",
        sheet: "OS_DETALHADA",
        row: row.__rowNumber,
        message: `Placa ${plate} não encontrada na aba VEICULOS_FINAL.`,
      });
    }

    const osInternalId = normalizeText(row["OS (ID interno)"]);
    if (!osInternalId) {
      warnings.push({
        type: "os-id-ausente",
        sheet: "OS_DETALHADA",
        row: row.__rowNumber,
        message: "ID interno da OS não informado.",
      });
      return;
    }

    const serviceOrder = {
      clientId,
      vehicleKey,
      osInternalId,
      type: normalizeText(row.Tipo) || null,
      status: normalizeText(row.Status) || null,
      startAt: parseExcelDate(row["Data início"]),
      endAt: parseExcelDate(row["Data fim"]),
      technicianName: normalizeText(row["Técnico"]) || null,
      address: normalizeText(row.Endereço) || null,
      addressStart: normalizeText(row["Endereço de saída"]) || null,
      addressReturn: normalizeText(row["Endereço retorno"]) || null,
      km: parseDecimal(row.KM),
      reason: normalizeText(row.Motivo) || null,
      notes: normalizeText(row["Observação"]) || null,
      responsibleName: normalizeText(row["Responsável - nome"]) || null,
      responsiblePhone: normalizeText(row["Responsável - telefone"]) || null,
      clientValue: parseDecimal(row["Valor (cliente)"]),
      technicianValue: parseDecimal(row["Valor (técnico)"]),
      serial: normalizeText(row.Serial) || null,
      externalRef: normalizeText(row["OS (unique id)"]) || null,
      equipmentsText: normalizeText(row["Equipamentos do veículo"]) || null,
      createdAt: parseExcelDate(row["Creation Date"]),
      updatedAt: parseExcelDate(row["Modified Date"]),
    };

    const list = serviceOrdersByClient.get(clientId) || [];
    list.push(serviceOrder);
    serviceOrdersByClient.set(clientId, list);

    if (vehicleKey) {
      countByVehicle(serviceOrderCountByVehicle, vehicleKey);
    }
  });

  vehicleCountExpectations.forEach((expected, key) => {
    const actualEquipments = equipmentCountByVehicle.get(key) || 0;
    const actualOrders = serviceOrderCountByVehicle.get(key) || 0;
    if (Number.isFinite(expected.equipments) && expected.equipments !== actualEquipments) {
      warnings.push({
        type: "qtd-equipamentos-divergente",
        message: `Qtd equipamentos divergente para ${key}: esperado ${expected.equipments}, encontrado ${actualEquipments}.`,
      });
    }
    if (Number.isFinite(expected.orders) && expected.orders !== actualOrders) {
      warnings.push({
        type: "qtd-os-divergente",
        message: `Qtd OS divergente para ${key}: esperado ${expected.orders}, encontrado ${actualOrders}.`,
      });
    }
  });

  const summary = {
    clients: { created: clientSummary.created, matched: clientSummary.matched },
    vehicles: { created: 0, updated: 0, skipped: 0 },
    products: { created: 0, updated: 0 },
    equipments: { created: 0, updated: 0, skipped: 0 },
    serviceOrders: { created: 0, updated: 0, skipped: 0 },
    links: { vehicles: vehiclesRows.length, equipments: equipmentRows.length, serviceOrders: serviceOrderRows.length },
    warnings: warnings.length,
    errors: errors.length,
  };

  const vehicleIdMap = new Map();
  const productIdMap = new Map();

  for (const [clientId, vehicleMap] of vehiclesByClient.entries()) {
    const existingVehicles = await prisma.vehicle.findMany({
      where: { clientId: String(clientId) },
      select: { id: true, plate: true },
    });
    const existingByPlate = new Map();
    existingVehicles.forEach((vehicle) => {
      existingByPlate.set(normalizePlate(vehicle.plate), vehicle);
    });

    for (const [vehicleKey, vehicle] of vehicleMap.entries()) {
      const existing = existingByPlate.get(vehicle.plate);
      const payload = {
        clientId: String(clientId),
        plate: vehicle.plate,
        name: vehicle.model || vehicle.brand || vehicle.plate,
        model: vehicle.model || null,
        brand: vehicle.brand || null,
        modelYear: Number.isFinite(vehicle.modelYear) ? vehicle.modelYear : null,
        type: vehicle.type || null,
        status: vehicle.status || null,
        chassis: vehicle.chassis || null,
        renavam: vehicle.renavam || null,
        color: vehicle.color || null,
        externalRef: vehicle.externalRef || null,
        updatedAt: vehicle.updatedAt || now,
      };

      if (existing) {
        summary.vehicles.updated += 1;
        vehicleIdMap.set(vehicleKey, existing.id);
        if (isApply) {
          await prisma.vehicle.update({
            where: { id: existing.id },
            data: payload,
          });
        }
        if (preview.length < MAX_PREVIEW_ITEMS) {
          preview.push({ type: "vehicle-update", plate: vehicle.plate, clientId });
        }
      } else {
        summary.vehicles.created += 1;
        if (isApply) {
          const created = await prisma.vehicle.create({
            data: {
              id: undefined,
              createdAt: vehicle.createdAt || now,
              ...payload,
            },
          });
          vehicleIdMap.set(vehicleKey, created.id);
        } else {
          vehicleIdMap.set(vehicleKey, `dry-run-vehicle:${vehicleKey}`);
        }
        if (preview.length < MAX_PREVIEW_ITEMS) {
          preview.push({ type: "vehicle-create", plate: vehicle.plate, clientId });
        }
      }
    }
  }

  for (const [clientId, productMap] of productsByClient.entries()) {
    const existingProducts = await prisma.equipmentProduct.findMany({
      where: { clientId: String(clientId) },
      select: { id: true, nameNormalized: true },
    });
    const existingByName = new Map();
    existingProducts.forEach((product) => {
      existingByName.set(product.nameNormalized, product);
    });

    for (const [nameNormalized, product] of productMap.entries()) {
      const existing = existingByName.get(nameNormalized);
      if (existing) {
        summary.products.updated += 1;
        productIdMap.set(`${clientId}:${nameNormalized}`, existing.id);
        if (preview.length < MAX_PREVIEW_ITEMS) {
          preview.push({ type: "product-update", name: product.name, clientId });
        }
      } else {
        summary.products.created += 1;
        if (isApply) {
          const created = await prisma.equipmentProduct.create({
            data: {
              clientId: String(clientId),
              name: product.name,
              nameNormalized,
              isNonTracked: false,
            },
          });
          productIdMap.set(`${clientId}:${nameNormalized}`, created.id);
        } else {
          productIdMap.set(`${clientId}:${nameNormalized}`, `dry-run-product:${clientId}:${nameNormalized}`);
        }
        if (preview.length < MAX_PREVIEW_ITEMS) {
          preview.push({ type: "product-create", name: product.name, clientId });
        }
      }
    }
  }

  for (const [clientId, equipments] of equipmentsByClient.entries()) {
    const internalIds = Array.from(new Set(equipments.map((item) => item.internalId)));
    const existingEquipments = internalIds.length
      ? await prisma.equipment.findMany({
          where: { clientId: String(clientId), internalId: { in: internalIds } },
          select: { id: true, internalId: true },
        })
      : [];
    const existingByInternalId = new Map();
    existingEquipments.forEach((equipment) => {
      existingByInternalId.set(equipment.internalId, equipment);
    });

    for (const equipment of equipments) {
      const vehicleId = equipment.vehicleKey ? vehicleIdMap.get(equipment.vehicleKey) : null;
      if (!vehicleId && equipment.vehicleKey) {
        summary.equipments.skipped += 1;
        warnings.push({
          type: "equipamento-sem-veiculo",
          message: `Equipamento ${equipment.internalId} ignorado: veículo não encontrado para ${equipment.vehicleKey}.`,
        });
        continue;
      }
      const productKey = equipment.productName ? normalizeKey(equipment.productName) : null;
      const productId = productKey ? productIdMap.get(`${clientId}:${productKey}`) : null;
      const payload = {
        clientId: String(clientId),
        vehicleId: vehicleId ? String(vehicleId) : null,
        productId: productId ? String(productId) : null,
        internalId: equipment.internalId,
        status: equipment.status,
        condition: equipment.condition,
        location: equipment.location,
        warrantyDays: Number.isFinite(equipment.warrantyDays) ? equipment.warrantyDays : null,
        priceValue: Number.isFinite(equipment.priceValue) ? equipment.priceValue : null,
        externalRef: equipment.externalRef,
        updatedAt: equipment.updatedAt || now,
      };

      const existing = existingByInternalId.get(equipment.internalId);
      if (existing) {
        summary.equipments.updated += 1;
        if (isApply) {
          await prisma.equipment.update({ where: { id: existing.id }, data: payload });
        }
        if (preview.length < MAX_PREVIEW_ITEMS) {
          preview.push({ type: "equipment-update", internalId: equipment.internalId, clientId });
        }
      } else {
        summary.equipments.created += 1;
        if (isApply) {
          await prisma.equipment.create({
            data: {
              createdAt: equipment.createdAt || now,
              ...payload,
            },
          });
        }
        if (preview.length < MAX_PREVIEW_ITEMS) {
          preview.push({ type: "equipment-create", internalId: equipment.internalId, clientId });
        }
      }
    }
  }

  for (const [clientId, orders] of serviceOrdersByClient.entries()) {
    const osIds = Array.from(new Set(orders.map((item) => item.osInternalId)));
    const existingOrders = osIds.length
      ? await prisma.serviceOrder.findMany({
          where: { clientId: String(clientId), osInternalId: { in: osIds } },
          select: { id: true, osInternalId: true },
        })
      : [];
    const existingByOs = new Map();
    existingOrders.forEach((order) => {
      existingByOs.set(order.osInternalId, order);
    });

    for (const order of orders) {
      const vehicleId = order.vehicleKey ? vehicleIdMap.get(order.vehicleKey) : null;
      if (!vehicleId && order.vehicleKey) {
        summary.serviceOrders.skipped += 1;
        warnings.push({
          type: "os-sem-veiculo",
          message: `OS ${order.osInternalId} ignorada: veículo não encontrado para ${order.vehicleKey}.`,
        });
        continue;
      }
      const payload = {
        clientId: String(clientId),
        vehicleId: vehicleId ? String(vehicleId) : null,
        osInternalId: order.osInternalId,
        type: order.type,
        status: order.status,
        startAt: order.startAt,
        endAt: order.endAt,
        technicianName: order.technicianName,
        address: order.address,
        addressStart: order.addressStart,
        addressReturn: order.addressReturn,
        km: Number.isFinite(order.km) ? order.km : null,
        reason: order.reason,
        notes: order.notes,
        responsibleName: order.responsibleName,
        responsiblePhone: order.responsiblePhone,
        clientValue: Number.isFinite(order.clientValue) ? order.clientValue : null,
        technicianValue: Number.isFinite(order.technicianValue) ? order.technicianValue : null,
        serial: order.serial,
        externalRef: order.externalRef,
        equipmentsText: order.equipmentsText,
        updatedAt: order.updatedAt || now,
      };
      const existing = existingByOs.get(order.osInternalId);
      if (existing) {
        summary.serviceOrders.updated += 1;
        if (isApply) {
          await prisma.serviceOrder.update({ where: { id: existing.id }, data: payload });
        }
        if (preview.length < MAX_PREVIEW_ITEMS) {
          preview.push({ type: "service-order-update", osInternalId: order.osInternalId, clientId });
        }
      } else {
        summary.serviceOrders.created += 1;
        if (isApply) {
          await prisma.serviceOrder.create({
            data: {
              createdAt: order.createdAt || now,
              ...payload,
            },
          });
        }
        if (preview.length < MAX_PREVIEW_ITEMS) {
          preview.push({ type: "service-order-create", osInternalId: order.osInternalId, clientId });
        }
      }
    }
  }

  if (isApply) {
    const logPayload = {
      fileName: fileName || "import.xlsx",
      mode,
      importMode,
      summary,
      warnings,
      errors,
      userId: user?.id ? String(user.id) : null,
      clientId: importMode === "singleClient" ? String(targetClientId) : null,
    };
    await prisma.euroImportLog.create({ data: logPayload });
  }

  return {
    ok: errors.length === 0,
    summary: {
      ...summary,
      clients: toSummaryEntry(summary.clients),
    },
    preview: preview.length ? preview : undefined,
    warnings,
    errors,
  };
}

export default {
  importEuroXlsx,
};
