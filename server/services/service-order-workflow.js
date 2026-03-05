import createError from "http-errors";

import prisma, { isPrismaAvailable } from "./prisma.js";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function toTrimmedString(value) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function parseOperationTokens(operation) {
  return String(operation || "")
    .split(/[|;,]/)
    .map((entry) => String(entry || "").trim())
    .filter(Boolean);
}

function upsertToken(tokens, token, startsWithPrefix = null) {
  const normalizedToken = toTrimmedString(token);
  if (!normalizedToken) return tokens;
  const lowerToken = normalizedToken.toLowerCase();
  const next = Array.isArray(tokens) ? [...tokens] : [];
  const exists = next.some((entry) => String(entry || "").trim().toLowerCase() === lowerToken);
  if (exists) return next;
  if (startsWithPrefix) {
    const prefix = String(startsWithPrefix).toLowerCase();
    if (next.some((entry) => String(entry || "").toLowerCase().startsWith(prefix))) return next;
  }
  next.push(normalizedToken);
  return next;
}

function buildOperation({
  previousOperation,
  requestToken = null,
  appointmentId = null,
  serviceOrderId = null,
} = {}) {
  let tokens = parseOperationTokens(previousOperation);
  const normalizedRequestToken = toTrimmedString(requestToken);
  if (normalizedRequestToken) {
    tokens = upsertToken(tokens, normalizedRequestToken, "request:");
  }
  const normalizedAppointmentId = toTrimmedString(appointmentId);
  if (normalizedAppointmentId) {
    tokens = upsertToken(tokens, `appointment:${normalizedAppointmentId}`, "appointment:");
  }
  const normalizedServiceOrderId = toTrimmedString(serviceOrderId);
  if (normalizedServiceOrderId) {
    tokens = upsertToken(tokens, `os:${normalizedServiceOrderId}`, "os:");
  }
  return tokens.join(";");
}

function extractRequestToken(operation) {
  const token = parseOperationTokens(operation).find((entry) => String(entry).toLowerCase().startsWith("request:"));
  return token ? String(token).toLowerCase() : "";
}

function extractRequestId(task) {
  if (!task || typeof task !== "object") return "";
  const byField = toTrimmedString(task.serviceItem);
  if (UUID_REGEX.test(byField)) return byField;
  const token = extractRequestToken(task.operation);
  const fromToken = token.replace("request:", "").trim();
  return UUID_REGEX.test(fromToken) ? fromToken : "";
}

function isMediaLike(value) {
  const text = toTrimmedString(value);
  if (!text) return false;
  const lower = text.toLowerCase();
  if (lower.startsWith("data:image/") || lower.startsWith("data:video/")) return true;
  if (lower.startsWith("http://") || lower.startsWith("https://") || lower.startsWith("/")) return true;
  if (/\.(jpg|jpeg|png|gif|webp|bmp|svg|mp4|mov|avi|mkv|webm)(\?|#|$)/i.test(lower)) return true;
  return false;
}

function normalizeMediaSource(value) {
  if (!value) return null;
  if (typeof value === "string") {
    const text = toTrimmedString(value);
    return isMediaLike(text) ? text : null;
  }
  if (typeof value === "object" && !Array.isArray(value)) {
    return (
      normalizeMediaSource(value.url) ||
      normalizeMediaSource(value.src) ||
      normalizeMediaSource(value.href) ||
      normalizeMediaSource(value.path) ||
      normalizeMediaSource(value.value) ||
      normalizeMediaSource(value.mediaUrl)
    );
  }
  return null;
}

function normalizeMediaList(value) {
  const queue = Array.isArray(value) ? [...value] : [value];
  const list = [];
  while (queue.length) {
    const current = queue.shift();
    if (!current) continue;
    if (Array.isArray(current)) {
      queue.unshift(...current);
      continue;
    }
    if (typeof current === "object") {
      const direct = normalizeMediaSource(current);
      if (direct) {
        list.push(direct);
        continue;
      }
      const nestedKeys = ["items", "files", "list", "urls", "sources", "images", "videos"];
      nestedKeys.forEach((key) => {
        if (Array.isArray(current[key])) {
          queue.unshift(...current[key]);
        }
      });
      continue;
    }
    const direct = normalizeMediaSource(current);
    if (direct) list.push(direct);
  }

  return Array.from(new Set(list));
}

function detectMediaType(src, fallbackType = null) {
  const lower = String(src || "").toLowerCase();
  if (lower.startsWith("data:video/")) return "video";
  if (lower.startsWith("data:image/")) return "image";
  if (/\.(mp4|mov|avi|mkv|webm)(\?|#|$)/i.test(lower)) return "video";
  if (/\.(jpg|jpeg|png|gif|webp|bmp|svg)(\?|#|$)/i.test(lower)) return "image";
  return fallbackType || "image";
}

function normalizeOsStatus(value) {
  return toTrimmedString(value).toUpperCase();
}

function resolveTaskStatusTargetsByServiceOrder(serviceOrder) {
  const normalized = normalizeOsStatus(serviceOrder?.status);
  if (normalized === "CONCLUIDA" || normalized === "APROVADA") {
    return { appointmentStatus: "concluido", requestStatus: "concluido" };
  }
  if (normalized === "CANCELADA" || normalized === "CANCELADO") {
    return { appointmentStatus: "cancelado", requestStatus: "cancelado" };
  }
  if (normalized === "EM_RETRABALHO") {
    return { appointmentStatus: "reprovado", requestStatus: "reprovado" };
  }
  if (
    normalized === "AGUARDANDO_APROVACAO" ||
    normalized === "PENDENTE_APROVACAO_ADMIN" ||
    normalized === "REENVIADA_PARA_APROVACAO"
  ) {
    return { appointmentStatus: "aguardando_validacao", requestStatus: null };
  }
  return { appointmentStatus: null, requestStatus: null };
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

export function collectServiceOrderMedia(serviceOrder) {
  const item = serviceOrder && typeof serviceOrder === "object" ? serviceOrder : {};
  const medias = [];
  const dedupe = new Set();
  const pushMedia = ({
    src,
    origin,
    phase = null,
    targetType = "OS",
    targetId = null,
    title = null,
    type = null,
    status = "READY",
    capturedAt = null,
  } = {}) => {
    const source = normalizeMediaSource(src);
    if (!source) return;
    const mediaType = detectMediaType(source, type);
    const normalizedOrigin = toTrimmedString(origin) || "OTHER";
    const normalizedPhase = toTrimmedString(phase) || "GENERAL";
    const normalizedTargetType = toTrimmedString(targetType) || "OS";
    const normalizedTargetId = toTrimmedString(targetId) || "";
    const key = `${normalizedOrigin}|${normalizedPhase}|${normalizedTargetType}|${normalizedTargetId}|${source}`;
    if (dedupe.has(key)) return;
    dedupe.add(key);
    medias.push({
      id: `midia-${medias.length + 1}`,
      src: source,
      type: mediaType,
      title:
        toTrimmedString(title) ||
        `${normalizedOrigin.replaceAll("_", " ")}${normalizedTargetId ? ` • ${normalizedTargetId}` : ""}`,
      origin: normalizedOrigin,
      phase: normalizedPhase,
      targetType: normalizedTargetType,
      targetId: normalizedTargetId || null,
      status: toTrimmedString(status) || "READY",
      capturedAt: toTrimmedString(capturedAt) || null,
    });
  };

  const equipments = Array.isArray(item.equipmentsData) ? item.equipmentsData : [];
  equipments.forEach((equipment, index) => {
    const label =
      toTrimmedString(
        equipment?.displayId || equipment?.uniqueId || equipment?.equipmentId || equipment?.id || equipment?.model,
      ) || `Equipamento ${index + 1}`;
    const equipmentId = toTrimmedString(equipment?.equipmentId || equipment?.id || equipment?.displayId) || label;
    normalizeMediaList([
      equipment?.startPhotos,
      equipment?.photosBefore,
      equipment?.photos?.before,
      equipment?.startPhoto,
      equipment?.beforePhoto,
      equipment?.photo,
      equipment?.initialPhoto,
    ]).forEach((src) =>
      pushMedia({
        src,
        origin: "EQUIPMENT_INITIAL",
        phase: "BEFORE",
        targetType: "EQUIPMENT",
        targetId: equipmentId,
        title: `${label} • Foto inicial`,
      }),
    );

    normalizeMediaList([
      equipment?.installationPhotos,
      equipment?.photosAfter,
      equipment?.photos?.after,
      equipment?.installationPhoto,
      equipment?.installedPhoto,
      equipment?.afterPhoto,
    ]).forEach((src) =>
      pushMedia({
        src,
        origin: "EQUIPMENT_INSTALLED",
        phase: "AFTER",
        targetType: "EQUIPMENT",
        targetId: equipmentId,
        title: `${label} • Instalado`,
      }),
    );

    normalizeMediaList([
      equipment?.installationVideos,
      equipment?.videos?.installation,
      equipment?.videos,
      equipment?.installationVideo,
      equipment?.installedVideo,
      equipment?.video,
    ]).forEach((src) =>
      pushMedia({
        src,
        origin: "EQUIPMENT_VIDEO",
        phase: "AFTER",
        targetType: "EQUIPMENT",
        targetId: equipmentId,
        title: `${label} • Vídeo`,
        type: "video",
        status: equipment?.installationVideoStatus || equipment?.videoStatus || "READY",
      }),
    );
  });

  const checklistItems = Array.isArray(item.checklistItems) ? item.checklistItems : [];
  checklistItems.forEach((checkItem, index) => {
    const label = toTrimmedString(checkItem?.item) || `Checklist ${index + 1}`;
    normalizeMediaList([
      checkItem?.beforePhotos,
      checkItem?.photosBefore,
      checkItem?.beforePhoto,
      checkItem?.beforeEvidence,
      checkItem?.photoBefore,
    ]).forEach((src) =>
      pushMedia({
        src,
        origin: "CHECKLIST_BEFORE",
        phase: "BEFORE",
        targetType: "CHECKLIST_ITEM",
        targetId: label,
        title: `${label} • Antes`,
      }),
    );
    normalizeMediaList([
      checkItem?.afterPhotos,
      checkItem?.photosAfter,
      checkItem?.afterPhoto,
      checkItem?.afterEvidence,
      checkItem?.photoAfter,
    ]).forEach((src) =>
      pushMedia({
        src,
        origin: "CHECKLIST_AFTER",
        phase: "AFTER",
        targetType: "CHECKLIST_ITEM",
        targetId: label,
        title: `${label} • Depois`,
      }),
    );
  });

  const signatures = item.signatures && typeof item.signatures === "object" ? item.signatures : {};
  normalizeMediaList(signatures.technician).forEach((src) =>
    pushMedia({
      src,
      origin: "SIGNATURE_TECHNICIAN",
      phase: "GENERAL",
      targetType: "SIGNATURE",
      targetId: "technician",
      title: "Assinatura técnico",
      type: "image",
    }),
  );
  normalizeMediaList(signatures.client).forEach((src) =>
    pushMedia({
      src,
      origin: "SIGNATURE_CLIENT",
      phase: "GENERAL",
      targetType: "SIGNATURE",
      targetId: "client",
      title: "Assinatura cliente",
      type: "image",
    }),
  );

  const workflow = signatures?.workflow && typeof signatures.workflow === "object" ? signatures.workflow : {};
  normalizeMediaList([
    workflow.installationVideo,
    workflow.videos,
    workflow.generalVideo,
    workflow.serviceVideo,
  ]).forEach((src) =>
    pushMedia({
      src,
      origin: "GENERAL_VIDEO",
      phase: "GENERAL",
      targetType: "OS",
      targetId: item.id ? String(item.id) : null,
      title: "Vídeo geral da OS",
      type: "video",
    }),
  );

  normalizeMediaList([item.attachments, workflow.attachments]).forEach((src) =>
    pushMedia({
      src,
      origin: "OTHER",
      phase: "GENERAL",
      targetType: "OS",
      targetId: item.id ? String(item.id) : null,
      title: "Mídia complementar",
    }),
  );

  return medias;
}

export function paginateMedia(items, { page = 1, pageSize = 60, cursor = null } = {}) {
  const list = Array.isArray(items) ? items : [];
  const safePageSize = Math.max(1, Math.min(500, Number.parseInt(pageSize, 10) || 60));
  const safePage = Math.max(1, Number.parseInt(page, 10) || 1);
  let offset = (safePage - 1) * safePageSize;

  const cursorToken = toTrimmedString(cursor);
  if (cursorToken) {
    const cursorIndex = list.findIndex((entry) => String(entry.id) === cursorToken);
    offset = cursorIndex >= 0 ? cursorIndex + 1 : offset;
  }

  const paged = list.slice(offset, offset + safePageSize);
  const nextCursor = paged.length ? paged[paged.length - 1].id : null;

  return {
    items: paged,
    page: safePage,
    pageSize: safePageSize,
    totalItems: list.length,
    totalPages: Math.max(1, Math.ceil(list.length / safePageSize)),
    hasMore: offset + safePageSize < list.length,
    nextCursor,
  };
}

async function findLinkedAppointmentsByServiceOrder(serviceOrder, tx) {
  const serviceOrderId = toTrimmedString(serviceOrder?.id);
  if (!serviceOrderId) return [];
  const clientId = toTrimmedString(serviceOrder?.clientId);
  const externalRef = toTrimmedString(serviceOrder?.externalRef);
  const requestToken = externalRef.toLowerCase().startsWith("request:") ? externalRef.toLowerCase() : "";
  const requestId = requestToken ? requestToken.replace("request:", "").trim() : "";
  const where = {
    ...(clientId ? { clientId } : {}),
    category: "appointment",
    OR: [
      { workOrderId: serviceOrderId },
      { operation: { contains: `os:${serviceOrderId}`, mode: "insensitive" } },
      ...(requestToken ? [{ operation: { contains: requestToken, mode: "insensitive" } }] : []),
      ...(requestId ? [{ serviceItem: requestId }] : []),
    ],
  };
  return tx.task.findMany({ where, orderBy: { updatedAt: "desc" } });
}

export async function syncTaskStatusesFromServiceOrder(
  serviceOrder,
  { tx: injectedTx = null, actorId = null, actorName = null } = {},
) {
  if (!serviceOrder?.id || !isPrismaAvailable()) {
    return {
      appointmentUpdated: 0,
      requestUpdated: 0,
      linkedAppointmentIds: [],
      linkedRequestIds: [],
    };
  }

  const run = async (tx) => {
    const { appointmentStatus, requestStatus } = resolveTaskStatusTargetsByServiceOrder(serviceOrder);
    const linkedAppointments = await findLinkedAppointmentsByServiceOrder(serviceOrder, tx);
    const appointmentIds = linkedAppointments.map((entry) => String(entry.id));
    let appointmentUpdated = 0;

    for (const appointment of linkedAppointments) {
      const requestToken = extractRequestToken(appointment.operation);
      const nextOperation = buildOperation({
        previousOperation: appointment.operation,
        requestToken,
        appointmentId: appointment.id,
        serviceOrderId: serviceOrder.id,
      });
      const nextData = {};
      if (String(appointment.workOrderId || "") !== String(serviceOrder.id)) {
        nextData.workOrderId = String(serviceOrder.id);
      }
      if (!appointment.schedulingId) {
        nextData.schedulingId = String(appointment.id);
      }
      if (nextOperation && String(nextOperation) !== String(appointment.operation || "")) {
        nextData.operation = nextOperation;
      }
      if (appointmentStatus && String(appointment.status || "").toLowerCase() !== appointmentStatus) {
        nextData.status = appointmentStatus;
      }
      if (appointmentStatus === "concluido" && !appointment.serviceEndTime) {
        nextData.serviceEndTime = new Date();
      }
      if (Object.keys(nextData).length) {
        await tx.task.update({ where: { id: String(appointment.id) }, data: nextData });
        appointmentUpdated += 1;
      }
    }

    const requestIds = new Set();
    const requestByServiceItem = linkedAppointments
      .map((entry) => toTrimmedString(entry.serviceItem))
      .filter((value) => UUID_REGEX.test(value));
    requestByServiceItem.forEach((requestId) => requestIds.add(requestId));
    const externalRef = toTrimmedString(serviceOrder.externalRef);
    if (externalRef.toLowerCase().startsWith("request:")) {
      const requestId = externalRef.replace(/request:/i, "").trim();
      if (UUID_REGEX.test(requestId)) {
        requestIds.add(requestId);
      }
    }

    const requestWhere = {
      ...(toTrimmedString(serviceOrder.clientId) ? { clientId: String(serviceOrder.clientId) } : {}),
      category: "request",
      OR: [
        ...(requestIds.size ? [{ id: { in: Array.from(requestIds) } }] : []),
        ...(appointmentIds.length ? [{ schedulingId: { in: appointmentIds } }, { serviceItem: { in: appointmentIds } }] : []),
        { workOrderId: String(serviceOrder.id) },
      ],
    };

    const linkedRequests = await tx.task.findMany({ where: requestWhere, orderBy: { updatedAt: "desc" } });
    const fallbackAppointmentId = appointmentIds[0] || null;
    let requestUpdated = 0;

    for (const requestTask of linkedRequests) {
      const nextOperation = buildOperation({
        previousOperation: requestTask.operation,
        requestToken: `request:${requestTask.id}`,
        appointmentId: requestTask.schedulingId || fallbackAppointmentId,
        serviceOrderId: serviceOrder.id,
      });
      const nextData = {};
      if (String(requestTask.workOrderId || "") !== String(serviceOrder.id)) {
        nextData.workOrderId = String(serviceOrder.id);
      }
      if (!requestTask.schedulingId && fallbackAppointmentId) {
        nextData.schedulingId = String(fallbackAppointmentId);
      }
      if (!requestTask.serviceItem && fallbackAppointmentId) {
        nextData.serviceItem = String(fallbackAppointmentId);
      }
      if (nextOperation && String(nextOperation) !== String(requestTask.operation || "")) {
        nextData.operation = nextOperation;
      }
      if (requestStatus && String(requestTask.status || "").toLowerCase() !== requestStatus) {
        nextData.status = requestStatus;
      }
      if (requestStatus === "concluido") {
        nextData.authorizationStatus = "concluido";
        nextData.authorizationBy =
          toTrimmedString(actorName) || toTrimmedString(actorId) || toTrimmedString(serviceOrder.technicianName) || "system";
      }
      if (Object.keys(nextData).length) {
        await tx.task.update({ where: { id: String(requestTask.id) }, data: nextData });
        requestUpdated += 1;
      }
    }

    return {
      appointmentUpdated,
      requestUpdated,
      linkedAppointmentIds: appointmentIds,
      linkedRequestIds: linkedRequests.map((entry) => String(entry.id)),
    };
  };

  if (injectedTx) {
    return run(injectedTx);
  }
  return prisma.$transaction((tx) => run(tx));
}

function normalizeTaskEquipmentsForServiceOrder(selectedEquipments) {
  const list = Array.isArray(selectedEquipments) ? selectedEquipments : [];
  const normalized = list
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const equipmentId = toTrimmedString(entry.equipmentId || entry.id);
      const displayId = toTrimmedString(entry.displayId || entry.uniqueId || entry.serial || equipmentId);
      const model = toTrimmedString(entry.equipmentName || entry.name || entry.model || entry.label);
      const installLocation = toTrimmedString(entry.installLocation || entry.location);
      if (!equipmentId && !displayId && !model && !installLocation) return null;
      return {
        equipmentId: equipmentId || null,
        displayId: displayId || null,
        model: model || null,
        installLocation: installLocation || null,
      };
    })
    .filter(Boolean);
  return normalized.length ? normalized : null;
}

export async function ensureServiceOrderForCompletedAppointment(
  appointmentTask,
  { tx: injectedTx = null, actorId = null, actorName = null } = {},
) {
  if (!appointmentTask?.id || !isPrismaAvailable()) {
    return { created: false, skipped: true, reason: "PRISMA_UNAVAILABLE_OR_TASK_MISSING" };
  }

  const run = async (tx) => {
    const task = await tx.task.findUnique({ where: { id: String(appointmentTask.id) } });
    if (!task) return { created: false, skipped: true, reason: "TASK_NOT_FOUND" };

    const category = toTrimmedString(task.category).toLowerCase();
    const status = toTrimmedString(task.status).toLowerCase();
    if (category !== "appointment" || status !== "concluido") {
      return { created: false, skipped: true, reason: "NOT_COMPLETED_APPOINTMENT", task };
    }

    const requestId = extractRequestId(task);
    const requestToken = requestId ? `request:${requestId}` : "";
    const appointmentToken = `appointment:${task.id}`;
    const refCandidates = Array.from(new Set([requestToken, appointmentToken].filter(Boolean)));

    let serviceOrder = null;
    if (task.workOrderId) {
      serviceOrder = await tx.serviceOrder.findUnique({ where: { id: String(task.workOrderId) } });
    }
    if (!serviceOrder && refCandidates.length) {
      serviceOrder = await tx.serviceOrder.findFirst({
        where: {
          clientId: String(task.clientId),
          externalRef: { in: refCandidates },
        },
        orderBy: { createdAt: "desc" },
      });
    }

    let created = false;
    if (!serviceOrder) {
      const vehicleId = toTrimmedString(task.vehicleId);
      const technicianName = toTrimmedString(task.technicianName || task.ownerName);
      if (!vehicleId) {
        throw createError(409, "Agendamento concluído sem veículo. Não foi possível gerar OS.");
      }
      if (!technicianName) {
        throw createError(409, "Agendamento concluído sem técnico. Não foi possível gerar OS.");
      }

      const referenceDate = task.serviceEndTime || task.endTimeExpected || task.updatedAt || new Date();
      const parsedReference = new Date(referenceDate);
      const osInternalId = await generateOsInternalId(tx, {
        clientId: String(task.clientId),
        referenceDate: Number.isNaN(parsedReference.getTime()) ? new Date() : parsedReference,
      });
      const selectedEquipments = normalizeTaskEquipmentsForServiceOrder(task.selectedEquipments);
      serviceOrder = await tx.serviceOrder.create({
        data: {
          clientId: String(task.clientId),
          clientName: toTrimmedString(task.clientName) || null,
          vehicleId,
          osInternalId,
          type: toTrimmedString(task.type) || null,
          status: "CONCLUIDA",
          startAt: task.serviceStartTime || task.startTimeExpected || task.createdAt || new Date(),
          endAt: task.serviceEndTime || task.endTimeExpected || new Date(),
          technicianName,
          address: toTrimmedString(task.address) || null,
          reason: toTrimmedString(task.serviceReason) || null,
          notes: toTrimmedString(task.serviceReason || task.slaExceptionReason || task.cancelReason) || null,
          responsibleName: toTrimmedString(task.contactName) || null,
          responsiblePhone: toTrimmedString(task.contactChannel) || null,
          externalRef: requestToken || appointmentToken,
          equipmentsData: selectedEquipments,
          equipmentsText: selectedEquipments
            ? selectedEquipments
                .map((entry) => entry.displayId || entry.model || entry.equipmentId)
                .filter(Boolean)
                .join("\n")
            : null,
        },
      });
      created = true;
    }

    const nextOperation = buildOperation({
      previousOperation: task.operation,
      requestToken,
      appointmentId: task.id,
      serviceOrderId: serviceOrder.id,
    });
    const patchTask = {};
    if (String(task.workOrderId || "") !== String(serviceOrder.id)) {
      patchTask.workOrderId = String(serviceOrder.id);
    }
    if (!task.schedulingId) {
      patchTask.schedulingId = String(task.id);
    }
    if (requestId && String(task.serviceItem || "") !== String(requestId)) {
      patchTask.serviceItem = String(requestId);
    }
    if (nextOperation && String(nextOperation) !== String(task.operation || "")) {
      patchTask.operation = nextOperation;
    }
    if (Object.keys(patchTask).length) {
      await tx.task.update({ where: { id: String(task.id) }, data: patchTask });
    }

    const syncResult = await syncTaskStatusesFromServiceOrder(serviceOrder, {
      tx,
      actorId,
      actorName,
    });

    return {
      created,
      skipped: false,
      reason: null,
      taskId: String(task.id),
      serviceOrderId: String(serviceOrder.id),
      serviceOrder,
      syncResult,
    };
  };

  if (injectedTx) {
    return run(injectedTx);
  }
  return prisma.$transaction((tx) => run(tx), { isolationLevel: "Serializable" });
}
