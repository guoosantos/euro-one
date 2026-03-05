import { randomUUID } from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import dgram from "node:dgram";
import path from "node:path";
import { fileURLToPath } from "node:url";

import prisma, { isPrismaAvailable } from "../prisma.js";
import { loadCollection, saveCollection } from "../storage.js";
import { listDevices, updateDevice } from "../../models/device.js";
import { createModel, listModels } from "../../models/model.js";
import { getVehicleById } from "../../models/vehicle.js";
import { upsertAlertFromEvent } from "../alerts.js";

import {
  JT808_MESSAGE_IDS,
  buildLiveStreamControl9102,
  buildLiveStreamRequest9101,
  buildPlatformGeneralResponse,
  buildTerminalRegisterResponse,
  classifyMessage,
  encodeJt808Frame,
  extractJt808Frames,
  hex,
  parseBatchPosition0704,
  parseJt808Frame,
  parseMultimediaData0801,
  parseMultimediaEvent0800,
  parsePassengerFlow1005,
  parsePosition0200,
  parseRegister0100,
  parseResourceList1205,
  parseStoredMultimediaResponse0802,
  parseVideoAttributes1003,
} from "./jt808-codec.js";
import { extractJt1078Packets } from "./jt1078-codec.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_ROOT = path.resolve(__dirname, "../../data/nt407");
const MEDIA_ROOT = path.join(DATA_ROOT, "media");
const LIVE_ROOT = path.join(DATA_ROOT, "live");

const POSITIONS_KEY = "nt407_positions";
const EVENTS_KEY = "nt407_events";
const MEDIA_KEY = "nt407_media";
const MAX_LOCAL_POSITIONS = Number(process.env.NT407_MAX_LOCAL_POSITIONS || 20_000);
const MAX_LOCAL_EVENTS = Number(process.env.NT407_MAX_LOCAL_EVENTS || 20_000);
const MAX_LOCAL_MEDIA = Number(process.env.NT407_MAX_LOCAL_MEDIA || 10_000);

const FATIGUE_POSITION_BITS = new Set([2, 14]);
const FALLBACK_AUTH_CODE = process.env.NT407_AUTH_CODE || "NT407-EURO-ONE";

const state = {
  started: false,
  config: null,
  tcpServer: null,
  udpServer: null,
  sessionsBySocket: new Map(),
  sessionsByTerminal: new Map(),
  liveSessions: new Map(),
  tcpBufferBySessionId: new Map(),
  rtpBufferBySessionId: new Map(),
  localPositions: loadCollection(POSITIONS_KEY, []),
  localEvents: loadCollection(EVENTS_KEY, []),
  localMedia: loadCollection(MEDIA_KEY, []),
  warningOnce: new Set(),
};

function log(level, message, payload = null) {
  const prefix = `[nt407][${new Date().toISOString()}]`;
  if (payload) {
    console[level](`${prefix} ${message}`, payload);
    return;
  }
  console[level](`${prefix} ${message}`);
}

function warnOnce(key, message, payload = null) {
  if (state.warningOnce.has(key)) return;
  state.warningOnce.add(key);
  log("warn", message, payload);
}

function parsePort(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : fallback;
}

function parseOptionalPort(value) {
  if (value === undefined || value === null || String(value).trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : null;
}

function resolveConfig() {
  const host = process.env.NT407_BIND_HOST || "0.0.0.0";
  const tcpPort = parsePort(process.env.NT407_TCP_PORT, 5001);
  const udpPort = parseOptionalPort(process.env.NT407_UDP_PORT);
  const liveServerIp = process.env.NT407_LIVE_SERVER_IP || null;
  const liveTcpPort = parsePort(process.env.NT407_LIVE_TCP_PORT, tcpPort);
  const liveUdpPort = parsePort(process.env.NT407_LIVE_UDP_PORT, udpPort || tcpPort);

  return {
    host,
    tcpPort,
    udpPort,
    liveServerIp,
    liveTcpPort,
    liveUdpPort,
  };
}

function hasPrismaModel(modelName, operation = "findMany") {
  if (!isPrismaAvailable()) return false;
  const model = prisma?.[modelName];
  return Boolean(model && typeof model[operation] === "function");
}

function sortByTimestampDesc(items, selector) {
  return [...items].sort((left, right) => {
    const l = new Date(selector(left) || 0).getTime();
    const r = new Date(selector(right) || 0).getTime();
    return r - l;
  });
}

function trimCollection(items, max) {
  if (items.length <= max) return items;
  return sortByTimestampDesc(items, (entry) => entry?.createdAt || entry?.timestamp).slice(0, max);
}

function saveLocalCollections() {
  saveCollection(POSITIONS_KEY, state.localPositions);
  saveCollection(EVENTS_KEY, state.localEvents);
  saveCollection(MEDIA_KEY, state.localMedia);
}

function asIso(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function normaliseTerminalId(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (!digits) return null;
  return digits.padStart(12, "0").slice(-12);
}

function normaliseDeviceId(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text || null;
}

function ensureDirectory(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function resolveMediaExtension(media) {
  const format = String(media?.mediaFormat || "").toLowerCase();
  if (format === "jpeg" || format === "jpg") return "jpg";
  if (format === "tif" || format === "tiff") return "tif";
  if (format === "mp3") return "mp3";
  if (format === "wav") return "wav";
  if (format === "wmv") return "wmv";
  if (media?.mediaType === "video") return "bin";
  if (media?.mediaType === "audio") return "bin";
  return "bin";
}

function resolveSessionByDevice(deviceId) {
  const target = normaliseDeviceId(deviceId);
  if (!target) return null;
  for (const session of state.sessionsBySocket.values()) {
    if (session.deviceId && String(session.deviceId) === target) {
      return session;
    }
  }
  return null;
}

function resolveTerminalSession(terminalId) {
  const key = normaliseTerminalId(terminalId);
  if (!key) return null;
  return state.sessionsByTerminal.get(key) || null;
}

function resolveDeviceByTerminalId(terminalId) {
  const normalized = normaliseTerminalId(terminalId);
  if (!normalized) return null;

  const devices = listDevices({});
  return (
    devices.find((device) => normaliseTerminalId(device?.uniqueId) === normalized) ||
    devices.find((device) => {
      const attrs = device?.attributes || {};
      return (
        normaliseTerminalId(attrs?.terminalId) === normalized ||
        normaliseTerminalId(attrs?.imei) === normalized ||
        normaliseTerminalId(attrs?.nt407TerminalId) === normalized
      );
    }) ||
    null
  );
}

function shouldRegisterNt407Model(device) {
  const attrs = device?.attributes || {};
  const protocol = String(device?.protocol || attrs?.protocol || "").toLowerCase();
  if (protocol === "nt407") return false;
  const modelName = String(device?.modelName || attrs?.modelName || attrs?.model || "").toLowerCase();
  if (modelName.includes("nt407")) return false;
  return true;
}

function ensureNt407ModelForDevice(device) {
  if (!device?.id || !device?.clientId) return null;
  if (!shouldRegisterNt407Model(device)) return null;

  const existing = listModels({ clientId: device.clientId, includeGlobal: true }).find(
    (model) =>
      String(model?.name || "").trim().toLowerCase() === "nt407-pro" &&
      String(model?.brand || "").trim().toLowerCase() === "x3tech",
  );

  const model =
    existing ||
    createModel({
      clientId: device.clientId,
      name: "NT407-PRO",
      brand: "X3Tech",
      protocol: "nt407",
      connectivity: "4G/LTE",
      notes: "Modelo homologado para ingestão direta JT/T 808 + JT/T 1078 no Euro One.",
    });

  const attrs = device?.attributes && typeof device.attributes === "object" ? device.attributes : {};
  updateDevice(device.id, {
    modelId: device.modelId || model.id,
    attributes: {
      ...attrs,
      protocol: "nt407",
      modelName: "NT407-PRO",
      nt407TerminalId: attrs.nt407TerminalId || normaliseTerminalId(device.uniqueId),
    },
  });

  return model;
}

async function persistPosition(record) {
  const payload = {
    id: randomUUID(),
    ...record,
    timestamp: asIso(record.timestamp) || new Date().toISOString(),
    createdAt: new Date().toISOString(),
  };

  state.localPositions = trimCollection([payload, ...state.localPositions], MAX_LOCAL_POSITIONS);
  saveCollection(POSITIONS_KEY, state.localPositions);

  if (hasPrismaModel("nt407Position", "create")) {
    try {
      await prisma.nt407Position.create({
        data: {
          id: payload.id,
          deviceId: payload.deviceId || null,
          terminalId: payload.terminalId,
          latitude: payload.latitude,
          longitude: payload.longitude,
          speedKmh: payload.speedKmh ?? null,
          altitude: payload.altitude ?? null,
          direction: payload.direction ?? null,
          alarmFlags: payload.alarmFlags ?? null,
          statusFlags: payload.statusFlags ?? null,
          extras: payload.extras || null,
          protocol: payload.protocol || "jt808",
          timestamp: new Date(payload.timestamp),
          createdAt: new Date(payload.createdAt),
        },
      });
    } catch (error) {
      warnOnce("prisma-nt407-position", "[nt407] falha ao persistir nt407Position no Prisma; usando fallback local", {
        message: error?.message || error,
      });
    }
  }

  return payload;
}

function resolveEventSeverity(eventType) {
  if (["fatigue", "drowsiness", "collision", "rollover", "danger"].includes(eventType)) {
    return "critical";
  }
  if (["phone-use", "smoking"].includes(eventType)) {
    return "high";
  }
  return "medium";
}

async function persistEvent(record) {
  const payload = {
    id: randomUUID(),
    ...record,
    timestamp: asIso(record.timestamp) || new Date().toISOString(),
    severity: record.severity || resolveEventSeverity(record.eventType),
    createdAt: new Date().toISOString(),
  };

  state.localEvents = trimCollection([payload, ...state.localEvents], MAX_LOCAL_EVENTS);
  saveCollection(EVENTS_KEY, state.localEvents);

  if (hasPrismaModel("nt407Event", "create")) {
    try {
      await prisma.nt407Event.create({
        data: {
          id: payload.id,
          deviceId: payload.deviceId || null,
          terminalId: payload.terminalId,
          msgId: payload.msgId || null,
          eventType: payload.eventType,
          severity: payload.severity,
          source: payload.source || null,
          cameraChannel: payload.cameraChannel ?? null,
          fatigueScore: payload.fatigueScore ?? null,
          durationSec: payload.durationSec ?? null,
          metadata: payload.metadata || null,
          timestamp: new Date(payload.timestamp),
          createdAt: new Date(payload.createdAt),
        },
      });
    } catch (error) {
      warnOnce("prisma-nt407-event", "[nt407] falha ao persistir nt407Event no Prisma; usando fallback local", {
        message: error?.message || error,
      });
    }
  }

  if (payload.deviceId) {
    const device = listDevices({}).find((entry) => String(entry.id) === String(payload.deviceId));
    const vehicle = device?.vehicleId ? getVehicleById(device.vehicleId) : null;
    const configuredEvent = {
      label: payload.eventLabel || payload.eventType,
      severity: payload.severity,
      active: true,
      requiresHandling: ["critical", "high"].includes(payload.severity),
      category: payload.eventType === "fatigue" ? "Segurança" : "Telemetria",
    };

    upsertAlertFromEvent({
      clientId: device?.clientId,
      event: {
        id: payload.id,
        eventTime: payload.timestamp,
        type: payload.eventType,
        severity: payload.severity,
      },
      configuredEvent,
      deviceId: payload.deviceId,
      vehicleId: device?.vehicleId || null,
      vehicleLabel: vehicle?.name || null,
      plate: vehicle?.plate || null,
      address: payload?.metadata?.address || null,
      protocol: "nt407",
    });
  }

  return payload;
}

async function persistMedia(record) {
  const payload = {
    id: randomUUID(),
    ...record,
    startTime: asIso(record.startTime) || new Date().toISOString(),
    endTime: asIso(record.endTime),
    createdAt: new Date().toISOString(),
  };

  state.localMedia = trimCollection([payload, ...state.localMedia], MAX_LOCAL_MEDIA);
  saveCollection(MEDIA_KEY, state.localMedia);

  if (hasPrismaModel("nt407Media", "create")) {
    try {
      await prisma.nt407Media.create({
        data: {
          id: payload.id,
          deviceId: payload.deviceId || null,
          terminalId: payload.terminalId,
          cameraChannel: payload.cameraChannel ?? null,
          mediaType: payload.mediaType,
          mediaFormat: payload.mediaFormat || null,
          eventType: payload.eventType || null,
          source: payload.source || null,
          filePath: payload.filePath || null,
          fileSize: payload.fileSize ?? null,
          metadata: payload.metadata || null,
          startTime: new Date(payload.startTime),
          endTime: payload.endTime ? new Date(payload.endTime) : null,
          createdAt: new Date(payload.createdAt),
        },
      });
    } catch (error) {
      warnOnce("prisma-nt407-media", "[nt407] falha ao persistir nt407Media no Prisma; usando fallback local", {
        message: error?.message || error,
      });
    }
  }

  return payload;
}

function updateSessionIdentity(session, terminalId) {
  const normalized = normaliseTerminalId(terminalId);
  if (!normalized) return;

  session.terminalId = normalized;
  state.sessionsByTerminal.set(normalized, session);

  const device = resolveDeviceByTerminalId(normalized);
  if (device) {
    session.deviceId = String(device.id);
    session.clientId = String(device.clientId);
    if (shouldRegisterNt407Model(device)) {
      try {
        ensureNt407ModelForDevice(device);
      } catch (error) {
        log("warn", "falha ao registrar modelo NT407-PRO automaticamente", {
          message: error?.message || error,
          deviceId: device.id,
        });
      }
    }
  }
}

function createSession(socket) {
  const session = {
    id: randomUUID(),
    socket,
    connectedAt: new Date().toISOString(),
    remoteAddress: socket.remoteAddress || null,
    remotePort: socket.remotePort || null,
    terminalId: null,
    deviceId: null,
    clientId: null,
    protocolDetected: null,
    lastSeenAt: null,
    seqOut: 1,
  };

  state.sessionsBySocket.set(socket, session);
  state.tcpBufferBySessionId.set(session.id, Buffer.alloc(0));
  state.rtpBufferBySessionId.set(session.id, Buffer.alloc(0));

  log("info", "conexão TCP recebida", {
    sessionId: session.id,
    remoteAddress: session.remoteAddress,
    remotePort: session.remotePort,
  });

  return session;
}

function destroySession(session, reason = "closed") {
  if (!session) return;
  state.sessionsBySocket.delete(session.socket);
  state.tcpBufferBySessionId.delete(session.id);
  state.rtpBufferBySessionId.delete(session.id);
  if (session.terminalId) {
    const current = state.sessionsByTerminal.get(session.terminalId);
    if (current?.id === session.id) {
      state.sessionsByTerminal.delete(session.terminalId);
    }
  }

  log("info", "conexão encerrada", {
    sessionId: session.id,
    terminalId: session.terminalId,
    deviceId: session.deviceId,
    reason,
  });
}

function nextOutgoingSeq(session) {
  const seq = session.seqOut & 0xffff;
  session.seqOut = (session.seqOut + 1) & 0xffff;
  if (session.seqOut === 0) session.seqOut = 1;
  return seq;
}

function sendFrame(session, frame, context = {}) {
  if (!session?.socket || session.socket.destroyed) {
    throw new Error("socket indisponível para envio");
  }

  session.socket.write(frame);
  log("info", "mensagem enviada para terminal", {
    sessionId: session.id,
    terminalId: session.terminalId,
    deviceId: session.deviceId,
    msgId: context.msgId ? hex(context.msgId) : null,
    reason: context.reason || null,
    timestamp: new Date().toISOString(),
  });
}

function sendCommonAck(session, parsed, result = 0) {
  if (!session?.terminalId && !parsed?.terminalId) return;
  const terminalId = session.terminalId || parsed.terminalId;
  const frame = buildPlatformGeneralResponse({
    terminalId,
    replySeq: parsed.seq,
    replyMsgId: parsed.msgId,
    result,
    seq: nextOutgoingSeq(session),
  });
  sendFrame(session, frame, { msgId: JT808_MESSAGE_IDS.PLATFORM_COMMON_RESPONSE, reason: "ack" });
}

function sendRegisterAck(session, parsed, result = 0) {
  const terminalId = session.terminalId || parsed.terminalId;
  const frame = buildTerminalRegisterResponse({
    terminalId,
    replySeq: parsed.seq,
    result,
    authCode: FALLBACK_AUTH_CODE,
  });
  sendFrame(session, frame, {
    msgId: JT808_MESSAGE_IDS.TERMINAL_REGISTER_RESPONSE,
    reason: "register-ack",
  });
}

function hasFlag(value, bit) {
  return ((Number(value) >>> 0) & (1 << bit)) !== 0;
}

function extractPositionEvents(position) {
  const events = [];

  for (const bit of FATIGUE_POSITION_BITS) {
    if (hasFlag(position.alarmFlags, bit)) {
      events.push({ eventType: "fatigue", severity: "critical", source: `alarm-bit-${bit}` });
    }
  }

  if (hasFlag(position.alarmFlags, 29)) {
    events.push({ eventType: "collision", severity: "critical", source: "alarm-bit-29" });
  }
  if (hasFlag(position.alarmFlags, 30)) {
    events.push({ eventType: "rollover", severity: "critical", source: "alarm-bit-30" });
  }
  if (hasFlag(position.alarmFlags, 3)) {
    events.push({ eventType: "danger", severity: "critical", source: "alarm-bit-3" });
  }

  const behaviorExtra = position.extras?.find((entry) => entry?.name === "abnormalDrivingBehavior");
  if (behaviorExtra) {
    const flags = Number(behaviorExtra.behaviorFlags || 0);
    const fatigueScore = Number(behaviorExtra.fatigueScore || 0);
    if ((flags & (1 << 0)) !== 0) {
      events.push({
        eventType: "fatigue",
        severity: fatigueScore > 70 ? "critical" : "high",
        fatigueScore,
        source: "extra-0x18-fatigue",
      });
    }
    if ((flags & (1 << 1)) !== 0) {
      events.push({ eventType: "phone-use", severity: "high", source: "extra-0x18-phone" });
    }
    if ((flags & (1 << 2)) !== 0) {
      events.push({ eventType: "smoking", severity: "high", source: "extra-0x18-smoking" });
    }
  }

  return events;
}

async function handlePosition(session, parsed, position) {
  const record = await persistPosition({
    deviceId: session.deviceId,
    terminalId: session.terminalId || parsed.terminalId,
    latitude: position.latitude,
    longitude: position.longitude,
    speedKmh: position.speedKmh,
    altitude: position.altitude,
    direction: position.direction,
    alarmFlags: position.alarmFlags,
    statusFlags: position.statusFlags,
    extras: position.extras,
    protocol: classifyMessage(parsed),
    timestamp: position.fixTime || parsed.receivedAt,
  });

  const events = extractPositionEvents(position);
  for (const event of events) {
    await persistEvent({
      deviceId: session.deviceId,
      terminalId: session.terminalId || parsed.terminalId,
      msgId: hex(parsed.msgId),
      eventType: event.eventType,
      severity: event.severity,
      source: event.source,
      cameraChannel: null,
      fatigueScore: Number.isFinite(event.fatigueScore) ? event.fatigueScore : null,
      metadata: {
        positionId: record.id,
        latitude: record.latitude,
        longitude: record.longitude,
      },
      timestamp: record.timestamp,
    });
  }
}

function saveMediaPayload(mediaInfo, payloadBuffer, { liveId = null } = {}) {
  if (!Buffer.isBuffer(payloadBuffer) || payloadBuffer.length === 0) {
    return { filePath: null, fileSize: 0 };
  }

  const now = new Date();
  const dayKey = `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, "0")}${String(
    now.getUTCDate(),
  ).padStart(2, "0")}`;
  const terminalDir = mediaInfo?.terminalId || "unknown";
  const baseDir = liveId ? path.join(LIVE_ROOT, liveId) : path.join(MEDIA_ROOT, terminalDir, dayKey);

  ensureDirectory(baseDir);

  const extension = resolveMediaExtension(mediaInfo);
  const fileName = `${now.getTime()}_${mediaInfo.mediaId || randomUUID()}.${extension}`;
  const absolutePath = path.join(baseDir, fileName);
  fs.writeFileSync(absolutePath, payloadBuffer);

  return {
    filePath: absolutePath,
    fileSize: payloadBuffer.length,
  };
}

async function handleMultimediaData(session, parsed, media) {
  const isFatigueMedia = ["collision-rollover-alarm"].includes(media.eventType);
  const mediaInfo = {
    deviceId: session.deviceId,
    terminalId: session.terminalId || parsed.terminalId,
    cameraChannel: media.channel,
    mediaType: media.mediaType,
    mediaFormat: media.mediaFormat,
    eventType: isFatigueMedia ? "fatigue" : media.eventType,
    source: "jt808:0x0801",
    startTime: media.location?.fixTime || parsed.receivedAt,
    endTime: null,
    metadata: {
      msgId: hex(parsed.msgId),
      mediaId: media.mediaId,
      rawEventCode: media.eventCode,
      location: media.location,
    },
  };

  const savedFile = saveMediaPayload(mediaInfo, media.payload);
  const mediaRecord = await persistMedia({
    ...mediaInfo,
    filePath: savedFile.filePath,
    fileSize: savedFile.fileSize,
  });

  if (isFatigueMedia) {
    await persistEvent({
      deviceId: session.deviceId,
      terminalId: session.terminalId || parsed.terminalId,
      msgId: hex(parsed.msgId),
      eventType: "fatigue",
      severity: "high",
      source: "media-event",
      cameraChannel: media.channel,
      metadata: {
        mediaId: mediaRecord.id,
      },
      timestamp: mediaInfo.startTime,
    });
  }

  return mediaRecord;
}

async function handleStoredMultimediaResponse(session, parsed, response) {
  if (!response?.items?.length) return;

  for (const item of response.items) {
    await persistMedia({
      deviceId: session.deviceId,
      terminalId: session.terminalId || parsed.terminalId,
      cameraChannel: item.channel,
      mediaType: item.mediaType,
      mediaFormat: item.mediaFormat,
      eventType: item.eventType,
      source: "jt808:0x0802",
      startTime: item.location?.fixTime || parsed.receivedAt,
      endTime: null,
      filePath: null,
      fileSize: null,
      metadata: {
        msgId: hex(parsed.msgId),
        responseSeq: response.responseSeq,
        mediaId: item.mediaId,
        location: item.location,
      },
    });
  }
}

async function handleJt808Message(session, parsed) {
  session.lastSeenAt = new Date().toISOString();
  updateSessionIdentity(session, parsed.terminalId);

  log("info", "mensagem recebida", {
    sessionId: session.id,
    terminalId: session.terminalId,
    deviceId: session.deviceId,
    protocolDetected: classifyMessage(parsed),
    msgId: hex(parsed.msgId),
    seq: parsed.seq,
    checksumOk: parsed.checksumOk,
    timestamp: parsed.receivedAt,
  });

  if (!parsed.checksumOk) {
    log("warn", "checksum inválido em mensagem JT/T 808", {
      sessionId: session.id,
      terminalId: session.terminalId,
      msgId: hex(parsed.msgId),
      expected: parsed.checkCodeExpected,
      got: parsed.checkCode,
      reason: "checksum-mismatch",
    });
    sendCommonAck(session, parsed, 1);
    return;
  }

  switch (parsed.msgId) {
    case JT808_MESSAGE_IDS.TERMINAL_REGISTER: {
      const info = parseRegister0100(parsed.body);
      if (info) {
        await persistEvent({
          deviceId: session.deviceId,
          terminalId: session.terminalId || parsed.terminalId,
          msgId: hex(parsed.msgId),
          eventType: "register",
          severity: "medium",
          source: "jt808-register",
          metadata: info,
          timestamp: parsed.receivedAt,
        });
      }
      sendRegisterAck(session, parsed, 0);
      break;
    }
    case JT808_MESSAGE_IDS.TERMINAL_AUTH:
      await persistEvent({
        deviceId: session.deviceId,
        terminalId: session.terminalId || parsed.terminalId,
        msgId: hex(parsed.msgId),
        eventType: "auth",
        severity: "medium",
        source: "jt808-auth",
        metadata: {
          authCode: parsed.body?.toString("utf8") || null,
        },
        timestamp: parsed.receivedAt,
      });
      sendCommonAck(session, parsed, 0);
      break;
    case JT808_MESSAGE_IDS.TERMINAL_HEARTBEAT:
      sendCommonAck(session, parsed, 0);
      break;
    case JT808_MESSAGE_IDS.POSITION_REPORT: {
      const position = parsePosition0200(parsed.body);
      if (position) {
        await handlePosition(session, parsed, position);
      }
      sendCommonAck(session, parsed, 0);
      break;
    }
    case JT808_MESSAGE_IDS.BATCH_POSITION_UPLOAD: {
      const items = parseBatchPosition0704(parsed.body);
      for (const position of items) {
        await handlePosition(session, parsed, position);
      }
      sendCommonAck(session, parsed, 0);
      break;
    }
    case JT808_MESSAGE_IDS.MULTIMEDIA_EVENT_UPLOAD: {
      const mediaEvent = parseMultimediaEvent0800(parsed.body);
      if (mediaEvent) {
        await persistEvent({
          deviceId: session.deviceId,
          terminalId: session.terminalId || parsed.terminalId,
          msgId: hex(parsed.msgId),
          eventType: mediaEvent.eventType,
          severity: mediaEvent.eventType.includes("alarm") ? "high" : "medium",
          source: "jt808:0x0800",
          cameraChannel: mediaEvent.channel,
          metadata: {
            mediaId: mediaEvent.mediaId,
            mediaType: mediaEvent.mediaType,
            mediaFormat: mediaEvent.mediaFormat,
            rawEventCode: mediaEvent.eventCode,
          },
          timestamp: parsed.receivedAt,
        });
      }
      sendCommonAck(session, parsed, 0);
      break;
    }
    case JT808_MESSAGE_IDS.MULTIMEDIA_DATA_UPLOAD: {
      const media = parseMultimediaData0801(parsed.body);
      if (media) {
        await handleMultimediaData(session, parsed, media);
      }
      sendCommonAck(session, parsed, 0);
      break;
    }
    case JT808_MESSAGE_IDS.STORED_MULTIMEDIA_RESPONSE: {
      const response = parseStoredMultimediaResponse0802(parsed.body);
      if (response) {
        await handleStoredMultimediaResponse(session, parsed, response);
      }
      sendCommonAck(session, parsed, 0);
      break;
    }
    case JT808_MESSAGE_IDS.VIDEO_ATTR_UPLOAD: {
      const attrs = parseVideoAttributes1003(parsed.body);
      await persistEvent({
        deviceId: session.deviceId,
        terminalId: session.terminalId || parsed.terminalId,
        msgId: hex(parsed.msgId),
        eventType: "video-attributes",
        severity: "medium",
        source: "jt1078",
        metadata: attrs,
        timestamp: parsed.receivedAt,
      });
      sendCommonAck(session, parsed, 0);
      break;
    }
    case JT808_MESSAGE_IDS.PASSENGER_FLOW_UPLOAD: {
      const flow = parsePassengerFlow1005(parsed.body);
      await persistEvent({
        deviceId: session.deviceId,
        terminalId: session.terminalId || parsed.terminalId,
        msgId: hex(parsed.msgId),
        eventType: "passenger-flow",
        severity: "medium",
        source: "jt1078",
        metadata: flow,
        timestamp: flow?.endTime || parsed.receivedAt,
      });
      sendCommonAck(session, parsed, 0);
      break;
    }
    case JT808_MESSAGE_IDS.RESOURCE_LIST_UPLOAD: {
      const summary = parseResourceList1205(parsed.body);
      await persistEvent({
        deviceId: session.deviceId,
        terminalId: session.terminalId || parsed.terminalId,
        msgId: hex(parsed.msgId),
        eventType: "resource-list",
        severity: "medium",
        source: "jt1078",
        metadata: summary,
        timestamp: parsed.receivedAt,
      });
      sendCommonAck(session, parsed, 0);
      break;
    }
    case JT808_MESSAGE_IDS.FILE_UPLOAD_COMPLETE:
      await persistEvent({
        deviceId: session.deviceId,
        terminalId: session.terminalId || parsed.terminalId,
        msgId: hex(parsed.msgId),
        eventType: "file-upload-complete",
        severity: "medium",
        source: "jt1078",
        timestamp: parsed.receivedAt,
      });
      sendCommonAck(session, parsed, 0);
      break;
    default:
      if (parsed.msgId >= 0x9000 && parsed.msgId <= 0x93ff) {
        await persistEvent({
          deviceId: session.deviceId,
          terminalId: session.terminalId || parsed.terminalId,
          msgId: hex(parsed.msgId),
          eventType: "jt1078-command",
          severity: "medium",
          source: "jt1078",
          metadata: {
            bodyLength: parsed.body?.length || 0,
          },
          timestamp: parsed.receivedAt,
        });
      }
      sendCommonAck(session, parsed, 0);
      break;
  }
}

async function handleJt1078Rtp(session, packet, source = "tcp") {
  session.lastSeenAt = new Date().toISOString();
  updateSessionIdentity(session, packet.terminalId);

  const liveTargets = [...state.liveSessions.values()].filter(
    (entry) =>
      entry.status === "active" &&
      entry.terminalId === normaliseTerminalId(packet.terminalId) &&
      Number(entry.channel) === Number(packet.channel),
  );

  for (const target of liveTargets) {
    const saved = saveMediaPayload(
      {
        terminalId: target.terminalId,
        mediaId: `${target.id}-${packet.packetSeq}`,
        mediaType: packet.dataType.startsWith("audio") ? "audio" : "video",
        mediaFormat: packet.dataType.startsWith("audio") ? "wav" : "bin",
      },
      packet.payload,
      { liveId: target.id },
    );

    target.lastPacketAt = new Date().toISOString();
    target.packetCount = (target.packetCount || 0) + 1;
    target.lastSegmentPath = saved.filePath;

    await persistMedia({
      deviceId: target.deviceId,
      terminalId: target.terminalId,
      cameraChannel: packet.channel,
      mediaType: packet.dataType.startsWith("audio") ? "audio" : "video",
      mediaFormat: packet.dataType,
      eventType: "live",
      source: `jt1078-rtp-${source}`,
      filePath: saved.filePath,
      fileSize: saved.fileSize,
      startTime: new Date().toISOString(),
      metadata: {
        liveId: target.id,
        packetSeq: packet.packetSeq,
        payloadType: packet.payloadType,
        marker: packet.marker,
        dataTypeCode: packet.dataTypeCode,
        subpackageFlag: packet.subpackageFlag,
      },
    });
  }

  log("info", "pacote JT/T 1078 recebido", {
    source,
    terminalId: packet.terminalId,
    channel: packet.channel,
    packetSeq: packet.packetSeq,
    dataType: packet.dataType,
    payloadLength: packet.payload?.length || 0,
    linkedLiveSessions: liveTargets.length,
  });
}

async function consumeTcpData(session, chunk) {
  const priorJt808Buffer = state.tcpBufferBySessionId.get(session.id) || Buffer.alloc(0);
  const merged = Buffer.concat([priorJt808Buffer, chunk]);

  const { frames, remaining } = extractJt808Frames(merged);
  state.tcpBufferBySessionId.set(session.id, remaining);

  for (const frame of frames) {
    const parsed = parseJt808Frame(frame);
    if (!parsed.ok) {
      log("warn", "falha ao parsear frame JT/T 808", {
        sessionId: session.id,
        error: parsed.error,
        reason: "jt808-parse-failure",
      });
      continue;
    }
    await handleJt808Message(session, parsed);
  }

  const priorRtpBuffer = state.rtpBufferBySessionId.get(session.id) || Buffer.alloc(0);
  const candidateRtpBuffer = Buffer.concat([priorRtpBuffer, chunk]);
  const { packets, remaining: remainingRtp } = extractJt1078Packets(candidateRtpBuffer);
  state.rtpBufferBySessionId.set(session.id, remainingRtp);

  for (const packet of packets) {
    await handleJt1078Rtp(session, packet, "tcp");
  }
}

function buildTcpServer() {
  const server = net.createServer((socket) => {
    const session = createSession(socket);

    socket.on("data", (chunk) => {
      consumeTcpData(session, chunk).catch((error) => {
        log("error", "erro ao processar dados NT407", {
          sessionId: session.id,
          terminalId: session.terminalId,
          reason: "consume-tcp-data-failed",
          message: error?.message || error,
        });
      });
    });

    socket.on("error", (error) => {
      log("warn", "erro de socket NT407", {
        sessionId: session.id,
        terminalId: session.terminalId,
        reason: "socket-error",
        message: error?.message || error,
      });
    });

    socket.on("close", () => {
      destroySession(session, "socket-close");
    });
  });

  server.on("error", (error) => {
    log("error", "falha no listener TCP NT407", {
      reason: "tcp-listener-error",
      message: error?.message || error,
    });
  });

  return server;
}

function buildUdpServer() {
  const server = dgram.createSocket("udp4");

  server.on("error", (error) => {
    log("warn", "erro no listener UDP NT407", {
      reason: "udp-listener-error",
      message: error?.message || error,
    });
  });

  server.on("message", (msg, rinfo) => {
    const { packets } = extractJt1078Packets(msg);
    if (!packets.length) return;

    packets.forEach((packet) => {
      handleJt1078Rtp(
        {
          id: `udp-${rinfo.address}:${rinfo.port}`,
          terminalId: packet.terminalId,
          deviceId: resolveDeviceByTerminalId(packet.terminalId)?.id || null,
          lastSeenAt: new Date().toISOString(),
        },
        packet,
        "udp",
      ).catch((error) => {
        log("warn", "falha ao processar pacote UDP JT/T 1078", {
          reason: "udp-rtp-handle-failed",
          terminalId: packet.terminalId,
          message: error?.message || error,
        });
      });
    });
  });

  return server;
}

export async function startNt407Server() {
  if (state.started) {
    return getNt407Health();
  }

  state.config = resolveConfig();
  ensureDirectory(DATA_ROOT);
  ensureDirectory(MEDIA_ROOT);
  ensureDirectory(LIVE_ROOT);

  log("info", "iniciando listener NT407", {
    host: state.config.host,
    tcpPort: state.config.tcpPort,
    udpPort: state.config.udpPort,
  });

  state.tcpServer = buildTcpServer();
  await new Promise((resolve, reject) => {
    state.tcpServer.once("error", reject);
    state.tcpServer.listen(state.config.tcpPort, state.config.host, () => {
      state.tcpServer.off("error", reject);
      resolve();
    });
  });

  if (state.config.udpPort) {
    state.udpServer = buildUdpServer();
    await new Promise((resolve, reject) => {
      state.udpServer.once("error", reject);
      state.udpServer.bind(state.config.udpPort, state.config.host, () => {
        state.udpServer.off("error", reject);
        resolve();
      });
    });
  }

  state.started = true;
  log("info", "listener NT407 ativo", {
    bindHost: state.config.host,
    tcpPort: state.config.tcpPort,
    udpPort: state.config.udpPort,
  });

  return getNt407Health();
}

export async function stopNt407Server() {
  if (!state.started) return;

  if (state.tcpServer) {
    await new Promise((resolve) => {
      state.tcpServer.close(() => resolve());
    });
  }

  if (state.udpServer) {
    await new Promise((resolve) => {
      state.udpServer.close(() => resolve());
    });
  }

  state.sessionsBySocket.clear();
  state.sessionsByTerminal.clear();
  state.tcpBufferBySessionId.clear();
  state.rtpBufferBySessionId.clear();
  state.started = false;
  state.tcpServer = null;
  state.udpServer = null;

  log("info", "listener NT407 parado");
}

export function getNt407Health() {
  return {
    ok: state.started,
    listener: {
      host: state.config?.host || null,
      tcpPort: state.config?.tcpPort || null,
      udpPort: state.config?.udpPort || null,
    },
    sessions: {
      tcpConnections: state.sessionsBySocket.size,
      terminalsOnline: state.sessionsByTerminal.size,
      liveSessions: [...state.liveSessions.values()].filter((entry) => entry.status === "active").length,
    },
    totals: {
      positions: state.localPositions.length,
      events: state.localEvents.length,
      media: state.localMedia.length,
    },
  };
}

function applyDateRange(items, from, to, selector) {
  const fromDate = from ? new Date(from) : null;
  const toDate = to ? new Date(to) : null;

  return items.filter((item) => {
    const value = selector(item);
    const date = value ? new Date(value) : null;
    if (!date || Number.isNaN(date.getTime())) return false;
    if (fromDate && date < fromDate) return false;
    if (toDate && date > toDate) return false;
    return true;
  });
}

function resolveMediaTypeTag(entry) {
  const type = String(entry?.eventType || "").toLowerCase();
  if (type.includes("fatigue")) return "fatigue";
  if (type.includes("face")) return "face";
  if (type.includes("live")) return "live";
  if (type.includes("collision") || type.includes("rollover")) return "event";
  return entry?.mediaType || "unknown";
}

async function queryMediaFromPrisma(filters = {}) {
  if (!hasPrismaModel("nt407Media", "findMany")) return null;

  try {
    const rows = await prisma.nt407Media.findMany({
      where: {
        ...(filters.deviceId ? { deviceId: String(filters.deviceId) } : {}),
        ...(filters.type ? { eventType: String(filters.type) } : {}),
        ...(filters.channel ? { cameraChannel: Number(filters.channel) } : {}),
        ...(filters.from || filters.to
          ? {
              startTime: {
                ...(filters.from ? { gte: new Date(filters.from) } : {}),
                ...(filters.to ? { lte: new Date(filters.to) } : {}),
              },
            }
          : {}),
      },
      orderBy: { startTime: "desc" },
      take: Math.min(1000, Number(filters.limit) || 200),
    });
    return rows;
  } catch (error) {
    warnOnce("prisma-nt407-media-query", "[nt407] falha ao consultar nt407Media no Prisma; usando fallback local", {
      message: error?.message || error,
    });
    return null;
  }
}

export async function listNt407Videos({ deviceId, from, to, type, channel, limit = 200 } = {}) {
  const prismaRows = await queryMediaFromPrisma({ deviceId, from, to, type, channel, limit });
  const source = Array.isArray(prismaRows)
    ? prismaRows.map((row) => ({
        id: row.id,
        deviceId: row.deviceId,
        terminalId: row.terminalId,
        cameraChannel: row.cameraChannel,
        mediaType: row.mediaType,
        mediaFormat: row.mediaFormat,
        eventType: row.eventType,
        source: row.source,
        filePath: row.filePath,
        fileSize: row.fileSize,
        metadata: row.metadata,
        startTime: asIso(row.startTime),
        endTime: asIso(row.endTime),
        createdAt: asIso(row.createdAt),
      }))
    : state.localMedia;

  let items = [...source];
  if (deviceId) {
    items = items.filter((entry) => String(entry.deviceId || "") === String(deviceId));
  }
  if (type) {
    items = items.filter((entry) => String(entry.eventType || "").toLowerCase() === String(type).toLowerCase());
  }
  if (channel !== undefined && channel !== null && String(channel).trim() !== "") {
    items = items.filter((entry) => Number(entry.cameraChannel) === Number(channel));
  }

  items = applyDateRange(items, from, to, (entry) => entry.startTime || entry.createdAt);
  items = sortByTimestampDesc(items, (entry) => entry.startTime || entry.createdAt).slice(0, Math.min(1000, Number(limit) || 200));

  return items.map((entry) => ({
    ...entry,
    typeTag: resolveMediaTypeTag(entry),
    downloadUrl: entry.filePath ? `/api/nt407/media/${entry.id}/download` : null,
  }));
}

async function queryEventsFromPrisma(filters = {}) {
  if (!hasPrismaModel("nt407Event", "findMany")) return null;

  try {
    return await prisma.nt407Event.findMany({
      where: {
        ...(filters.deviceId ? { deviceId: String(filters.deviceId) } : {}),
        ...(filters.eventType ? { eventType: String(filters.eventType) } : {}),
        ...(filters.onlyFatigue ? { eventType: { contains: "fatigue", mode: "insensitive" } } : {}),
        ...(filters.onlyFace ? { eventType: { contains: "face", mode: "insensitive" } } : {}),
        ...(filters.from || filters.to
          ? {
              timestamp: {
                ...(filters.from ? { gte: new Date(filters.from) } : {}),
                ...(filters.to ? { lte: new Date(filters.to) } : {}),
              },
            }
          : {}),
      },
      orderBy: { timestamp: "desc" },
      take: Math.min(1000, Number(filters.limit) || 200),
    });
  } catch (error) {
    warnOnce("prisma-nt407-event-query", "[nt407] falha ao consultar nt407Event no Prisma; usando fallback local", {
      message: error?.message || error,
    });
    return null;
  }
}

export async function listNt407Fatigue({ deviceId, from, to, severity, limit = 200 } = {}) {
  const prismaRows = await queryEventsFromPrisma({ deviceId, from, to, onlyFatigue: true, limit });
  const source = Array.isArray(prismaRows)
    ? prismaRows.map((row) => ({
        id: row.id,
        deviceId: row.deviceId,
        terminalId: row.terminalId,
        msgId: row.msgId,
        eventType: row.eventType,
        severity: row.severity,
        cameraChannel: row.cameraChannel,
        fatigueScore: row.fatigueScore,
        durationSec: row.durationSec,
        source: row.source,
        metadata: row.metadata,
        timestamp: asIso(row.timestamp),
        createdAt: asIso(row.createdAt),
      }))
    : state.localEvents;

  let items = source.filter((entry) => String(entry.eventType || "").toLowerCase().includes("fatigue"));

  if (deviceId) {
    items = items.filter((entry) => String(entry.deviceId || "") === String(deviceId));
  }
  if (severity) {
    items = items.filter((entry) => String(entry.severity || "").toLowerCase() === String(severity).toLowerCase());
  }

  items = applyDateRange(items, from, to, (entry) => entry.timestamp || entry.createdAt);
  items = sortByTimestampDesc(items, (entry) => entry.timestamp || entry.createdAt).slice(0, Math.min(1000, Number(limit) || 200));

  const videos = await listNt407Videos({ deviceId, from, to, limit: 1000 });

  return items.map((entry) => {
    const linkedVideo = videos.find(
      (video) =>
        String(video.deviceId || "") === String(entry.deviceId || "") &&
        String(video.typeTag || "").includes("fatigue") &&
        Math.abs(new Date(video.startTime || video.createdAt).getTime() - new Date(entry.timestamp || entry.createdAt).getTime()) <=
          10 * 60 * 1000,
    );

    return {
      ...entry,
      linkedVideoId: linkedVideo?.id || null,
      linkedVideoUrl: linkedVideo?.downloadUrl || null,
    };
  });
}

export async function listNt407Faces({ deviceId, from, to, limit = 200 } = {}) {
  const prismaRows = await queryEventsFromPrisma({ deviceId, from, to, onlyFace: true, limit });
  const source = Array.isArray(prismaRows)
    ? prismaRows.map((row) => ({
        id: row.id,
        deviceId: row.deviceId,
        terminalId: row.terminalId,
        eventType: row.eventType,
        severity: row.severity,
        cameraChannel: row.cameraChannel,
        metadata: row.metadata,
        timestamp: asIso(row.timestamp),
      }))
    : state.localEvents;

  let items = source.filter((entry) => String(entry.eventType || "").toLowerCase().includes("face"));
  if (deviceId) {
    items = items.filter((entry) => String(entry.deviceId || "") === String(deviceId));
  }
  items = applyDateRange(items, from, to, (entry) => entry.timestamp || entry.createdAt);

  return sortByTimestampDesc(items, (entry) => entry.timestamp || entry.createdAt).slice(0, Math.min(1000, Number(limit) || 200));
}

export async function listNt407Devices() {
  const devices = listDevices({});
  const mapped = devices.filter((device) => {
    const attrs = device?.attributes || {};
    const modelName = `${device?.modelName || ""} ${attrs?.modelName || ""} ${attrs?.model || ""}`.toLowerCase();
    const protocol = `${device?.protocol || ""} ${attrs?.protocol || ""}`.toLowerCase();
    return protocol.includes("nt407") || modelName.includes("nt407");
  });

  const byTerminal = new Map();
  state.sessionsByTerminal.forEach((session, terminalId) => {
    byTerminal.set(terminalId, session);
  });

  const latestPositionByDevice = new Map();
  state.localPositions.forEach((position) => {
    if (!position?.deviceId) return;
    const key = String(position.deviceId);
    if (!latestPositionByDevice.has(key)) {
      latestPositionByDevice.set(key, position);
      return;
    }
    const prev = latestPositionByDevice.get(key);
    const prevTs = new Date(prev.timestamp || prev.createdAt || 0).getTime();
    const nextTs = new Date(position.timestamp || position.createdAt || 0).getTime();
    if (nextTs > prevTs) {
      latestPositionByDevice.set(key, position);
    }
  });

  return mapped.map((device) => {
    const terminalId = normaliseTerminalId(device.uniqueId || device?.attributes?.nt407TerminalId);
    const session = terminalId ? byTerminal.get(terminalId) : null;
    const lastPosition = latestPositionByDevice.get(String(device.id));

    return {
      id: device.id,
      clientId: device.clientId,
      name: device.name,
      uniqueId: device.uniqueId,
      modelId: device.modelId,
      terminalId,
      online: Boolean(session),
      lastSeenAt: session?.lastSeenAt || null,
      lastPosition: lastPosition
        ? {
            latitude: lastPosition.latitude,
            longitude: lastPosition.longitude,
            speedKmh: lastPosition.speedKmh,
            timestamp: lastPosition.timestamp,
          }
        : null,
    };
  });
}

function resolveAdvertisedIp() {
  if (state.config?.liveServerIp) return state.config.liveServerIp;
  if (!state.config?.host || state.config.host === "0.0.0.0") {
    return process.env.HOST_PUBLIC_IP || "127.0.0.1";
  }
  return state.config.host;
}

export function startNt407Live({ deviceId, channel = 1, dataType = 0, streamType = 0, requestedBy = null } = {}) {
  const targetSession = resolveSessionByDevice(deviceId);
  if (!targetSession) {
    const error = new Error("Dispositivo NT407 não está conectado no listener JT/T 808");
    error.code = "NT407_DEVICE_OFFLINE";
    throw error;
  }

  const terminalId = targetSession.terminalId;
  if (!terminalId) {
    const error = new Error("Sessão ativa sem terminalId/IMEI identificado");
    error.code = "NT407_TERMINAL_UNKNOWN";
    throw error;
  }

  const body = buildLiveStreamRequest9101({
    serverIp: resolveAdvertisedIp(),
    tcpPort: state.config.liveTcpPort,
    udpPort: state.config.liveUdpPort,
    channel,
    dataType,
    streamType,
  });

  const frame = encodeJt808Frame({
    msgId: JT808_MESSAGE_IDS.REALTIME_STREAM_REQUEST,
    terminalId,
    seq: nextOutgoingSeq(targetSession),
    body,
  });

  sendFrame(targetSession, frame, {
    msgId: JT808_MESSAGE_IDS.REALTIME_STREAM_REQUEST,
    reason: "live-start",
  });

  const liveId = randomUUID();
  const liveSession = {
    id: liveId,
    status: "active",
    createdAt: new Date().toISOString(),
    startedAt: null,
    stoppedAt: null,
    requestedBy,
    deviceId: String(deviceId),
    terminalId,
    channel: Number(channel),
    dataType,
    streamType,
    playbackUrl: `/api/nt407/live/stream/${liveId}.m3u8`,
    segmentUrlPrefix: `/api/nt407/live/segments/${liveId}`,
    packetCount: 0,
    lastPacketAt: null,
    lastSegmentPath: null,
  };

  state.liveSessions.set(liveId, liveSession);
  return liveSession;
}

export function stopNt407Live({ liveId, deviceId, channel = 1 } = {}) {
  let session = null;
  if (liveId) {
    session = state.liveSessions.get(String(liveId)) || null;
  }
  if (!session && deviceId) {
    session = [...state.liveSessions.values()].find(
      (entry) => entry.status === "active" && String(entry.deviceId) === String(deviceId) && Number(entry.channel) === Number(channel),
    );
  }
  if (!session) {
    const error = new Error("Sessão live NT407 não encontrada");
    error.code = "NT407_LIVE_NOT_FOUND";
    throw error;
  }

  const terminalSession = resolveTerminalSession(session.terminalId);
  if (terminalSession) {
    const body = buildLiveStreamControl9102({
      channel: session.channel,
      command: 0,
      closeType: 0,
      switchStream: 0,
    });

    const frame = encodeJt808Frame({
      msgId: JT808_MESSAGE_IDS.REALTIME_STREAM_CONTROL,
      terminalId: session.terminalId,
      seq: nextOutgoingSeq(terminalSession),
      body,
    });

    sendFrame(terminalSession, frame, {
      msgId: JT808_MESSAGE_IDS.REALTIME_STREAM_CONTROL,
      reason: "live-stop",
    });
  }

  session.status = "stopped";
  session.stoppedAt = new Date().toISOString();
  return session;
}

export function getLiveSession(liveId) {
  if (!liveId) return null;
  return state.liveSessions.get(String(liveId)) || null;
}

export function buildLivePlaylist(liveId) {
  const liveSession = getLiveSession(liveId);
  if (!liveSession) return null;

  const liveDir = path.join(LIVE_ROOT, liveSession.id);
  if (!fs.existsSync(liveDir)) {
    return {
      contentType: "application/vnd.apple.mpegurl",
      body: "#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:2\n#EXT-X-MEDIA-SEQUENCE:0\n",
    };
  }

  const files = fs
    .readdirSync(liveDir)
    .filter((name) => name.endsWith(".bin") || name.endsWith(".ts") || name.endsWith(".mp4"))
    .sort();

  const lines = ["#EXTM3U", "#EXT-X-VERSION:3", "#EXT-X-TARGETDURATION:2", "#EXT-X-MEDIA-SEQUENCE:0"];
  files.slice(-50).forEach((name) => {
    lines.push("#EXTINF:1.0,");
    lines.push(`${liveSession.segmentUrlPrefix}/${name}`);
  });

  return {
    contentType: "application/vnd.apple.mpegurl",
    body: `${lines.join("\n")}\n`,
  };
}

export function getLiveSegmentPath(liveId, fileName) {
  const liveSession = getLiveSession(liveId);
  if (!liveSession) return null;
  const safeName = path.basename(fileName || "");
  if (!safeName) return null;
  const absolute = path.join(LIVE_ROOT, liveSession.id, safeName);
  if (!absolute.startsWith(path.join(LIVE_ROOT, liveSession.id))) {
    return null;
  }
  if (!fs.existsSync(absolute)) return null;
  return absolute;
}

export async function getNt407MediaById(mediaId) {
  const id = String(mediaId || "").trim();
  if (!id) return null;

  if (hasPrismaModel("nt407Media", "findUnique")) {
    try {
      const row = await prisma.nt407Media.findUnique({ where: { id } });
      if (row) {
        return {
          id: row.id,
          filePath: row.filePath,
          mediaType: row.mediaType,
          mediaFormat: row.mediaFormat,
        };
      }
    } catch (_error) {
      // fallback local
    }
  }

  return state.localMedia.find((entry) => String(entry.id) === id) || null;
}

export function getNt407RuntimeState() {
  return state;
}

export function __resetNt407StateForTests() {
  state.sessionsBySocket.clear();
  state.sessionsByTerminal.clear();
  state.liveSessions.clear();
  state.tcpBufferBySessionId.clear();
  state.rtpBufferBySessionId.clear();
  state.localPositions = [];
  state.localEvents = [];
  state.localMedia = [];
  saveLocalCollections();
}
