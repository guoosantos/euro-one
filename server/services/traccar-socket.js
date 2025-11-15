import crypto from "crypto";
import { URL } from "url";
import jwt from "jsonwebtoken";

import { config } from "../config.js";
import { getTraccarAdminHeaders, initializeTraccarAdminSession } from "./traccar.js";
import { findDeviceByTraccarId, findDeviceByUniqueId } from "../models/device.js";

const WS_MAGIC_STRING = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const CLIENTS = new Set();
let traccarSocket = null;
let reconnectTimer = null;
let isConnecting = false;

function buildTraccarSocketUrl() {
  const base = config.traccar.baseUrl.replace(/\/$/, "");
  if (base.startsWith("https://")) {
    return `wss://${base.slice("https://".length)}/api/socket`;
  }
  if (base.startsWith("http://")) {
    return `ws://${base.slice("http://".length)}/api/socket`;
  }
  return `${base}/api/socket`;
}

function decodeClientToken(request) {
  try {
    const origin = request.headers.host || "localhost";
    const url = new URL(request.url || "", `http://${origin}`);
    const token = url.searchParams.get("token");
    if (!token) return null;
    return jwt.verify(token, config.jwt.secret);
  } catch (error) {
    return null;
  }
}

function createAcceptKey(key) {
  return crypto.createHash("sha1").update(`${key}${WS_MAGIC_STRING}`).digest("base64");
}

function sendFrame(socket, payload, opcode = 0x1) {
  if (!socket || socket.destroyed) return;
  const message = typeof payload === "string" ? Buffer.from(payload) : Buffer.from(JSON.stringify(payload));
  const length = message.length;
  let header;
  if (length < 126) {
    header = Buffer.alloc(2);
    header[1] = length;
  } else if (length < 65536) {
    header = Buffer.alloc(4);
    header[1] = 126;
    header.writeUInt16BE(length, 2);
  } else {
    header = Buffer.alloc(10);
    header[1] = 127;
    const high = Math.floor(length / 2 ** 32);
    const low = length >>> 0;
    header.writeUInt32BE(high, 2);
    header.writeUInt32BE(low, 6);
  }
  header[0] = 0x80 | (opcode & 0x0f);
  socket.write(Buffer.concat([header, message]));
}

function sendPong(socket, payload) {
  if (!socket || socket.destroyed) return;
  const buffer = Buffer.isBuffer(payload) ? payload : Buffer.from(payload || []);
  const header = Buffer.alloc(buffer.length < 126 ? 2 : 4);
  header[0] = 0x80 | 0x0a;
  if (buffer.length < 126) {
    header[1] = buffer.length;
    socket.write(Buffer.concat([header, buffer]));
  } else {
    header[1] = 126;
    header.writeUInt16BE(buffer.length, 2);
    socket.write(Buffer.concat([header, buffer]));
  }
}

function handleClientFrame(client, buffer) {
  let offset = 0;
  while (offset < buffer.length) {
    if (buffer.length - offset < 2) {
      return;
    }
    const byte1 = buffer[offset++];
    const byte2 = buffer[offset++];
    const opcode = byte1 & 0x0f;
    let payloadLength = byte2 & 0x7f;

    if (payloadLength === 126) {
      if (buffer.length - offset < 2) return;
      payloadLength = buffer.readUInt16BE(offset);
      offset += 2;
    } else if (payloadLength === 127) {
      if (buffer.length - offset < 8) return;
      const high = buffer.readUInt32BE(offset);
      const low = buffer.readUInt32BE(offset + 4);
      payloadLength = high * 2 ** 32 + low;
      offset += 8;
    }

    const masked = (byte2 & 0x80) === 0x80;
    let maskingKey = null;
    if (masked) {
      if (buffer.length - offset < 4) return;
      maskingKey = buffer.slice(offset, offset + 4);
      offset += 4;
    }

    const payload = buffer.slice(offset, offset + payloadLength);
    offset += payloadLength;

    if (masked && maskingKey) {
      for (let index = 0; index < payload.length; index += 1) {
        payload[index] ^= maskingKey[index % 4];
      }
    }

    if (opcode === 0x8) {
      client.socket.end();
      return;
    }

    if (opcode === 0x9) {
      sendPong(client.socket, payload);
    }
  }
}

function safeParse(data) {
  if (typeof data !== "string") return null;
  try {
    return JSON.parse(data);
  } catch (_error) {
    return null;
  }
}

function extractDeviceCandidates(value) {
  const candidates = [];
  if (value === null || value === undefined) {
    return candidates;
  }
  if (typeof value === "object") {
    const refs = [
      value.deviceId,
      value.device_id,
      value.deviceID,
      value.id,
      value.uniqueId,
      value.device?.id,
      value.device?.deviceId,
      value.device?.uniqueId,
      value.position?.deviceId,
    ];
    refs.forEach((ref) => {
      if (ref !== undefined && ref !== null) {
        candidates.push(ref);
      }
    });
  } else {
    candidates.push(value);
  }
  return candidates;
}

function deviceBelongsToClient(candidate, clientId) {
  const values = extractDeviceCandidates(candidate);
  for (const value of values) {
    const direct = findDeviceByTraccarId(value) || findDeviceByTraccarId(String(value));
    if (direct && String(direct.clientId) === String(clientId)) {
      return true;
    }
    const unique = findDeviceByUniqueId(String(value));
    if (unique && String(unique.clientId) === String(clientId)) {
      return true;
    }
  }
  return false;
}

function filterPayloadForClient(data, clientId) {
  if (!data || typeof data !== "object") {
    return null;
  }
  let hasData = false;
  const filtered = {};

  if (Array.isArray(data.positions)) {
    const list = data.positions.filter((item) => deviceBelongsToClient(item, clientId));
    if (list.length) {
      filtered.positions = list;
      hasData = true;
    }
  }

  if (Array.isArray(data.events)) {
    const list = data.events.filter((item) => deviceBelongsToClient(item, clientId));
    if (list.length) {
      filtered.events = list;
      hasData = true;
    }
  }

  if (Array.isArray(data.devices)) {
    const list = data.devices.filter((item) => deviceBelongsToClient(item, clientId));
    if (list.length) {
      filtered.devices = list;
      hasData = true;
    }
  }

  if (Array.isArray(data.statistics)) {
    const list = data.statistics.filter((item) => deviceBelongsToClient(item, clientId));
    if (list.length) {
      filtered.statistics = list;
      hasData = true;
    }
  }

  if (!hasData) {
    return null;
  }

  Object.entries(data).forEach(([key, value]) => {
    if (!Array.isArray(value) && filtered[key] === undefined) {
      filtered[key] = value;
    }
  });

  return filtered;
}

function broadcast(message) {
  const stringPayload = typeof message === "string" ? message : JSON.stringify(message);
  let parsedPayload = null;
  for (const client of CLIENTS) {
    if (client.socket.destroyed) continue;
    try {
      const { user } = client;
      if (!user || !user.clientId || user.role === "admin") {
        sendFrame(client.socket, stringPayload);
        continue;
      }
      if (!parsedPayload) {
        parsedPayload = typeof message === "string" ? safeParse(message) : message;
      }
      if (!parsedPayload || typeof parsedPayload !== "object") {
        continue;
      }
      const filtered = filterPayloadForClient(parsedPayload, user.clientId);
      if (filtered) {
        sendFrame(client.socket, filtered);
      }
    } catch (error) {
      client.socket.destroy();
    }
  }
}

function scheduleReconnect(connectFn) {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(async () => {
    reconnectTimer = null;
    await initializeTraccarAdminSession().catch(() => undefined);
    connectFn();
  }, 5_000);
}

function connectToTraccar(connectFn) {
  if (isConnecting) return;
  isConnecting = true;
  try {
    const url = buildTraccarSocketUrl();
    const headers = getTraccarAdminHeaders();
    const socket = new WebSocket(url, undefined, { headers });
    traccarSocket = socket;

    socket.onopen = () => {
      isConnecting = false;
    };

    socket.onmessage = (event) => {
      broadcast(event.data);
    };

    socket.onerror = () => {
      socket.close();
    };

    socket.onclose = () => {
      traccarSocket = null;
      isConnecting = false;
      scheduleReconnect(connectFn);
    };
  } catch (error) {
    isConnecting = false;
    scheduleReconnect(connectFn);
  }
}

export function startTraccarSocketService(server) {
  function ensureConnection() {
    if (traccarSocket || isConnecting) return;
    connectToTraccar(ensureConnection);
  }

  server.on("upgrade", (request, socket) => {
    if (!request.url || !request.url.startsWith("/ws/live")) {
      return;
    }

    const user = decodeClientToken(request);
    if (!user) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }

    const clientKey = request.headers["sec-websocket-key"];
    if (!clientKey) {
      socket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
      socket.destroy();
      return;
    }

    const acceptKey = createAcceptKey(clientKey);
    const responseHeaders = [
      "HTTP/1.1 101 Switching Protocols",
      "Upgrade: websocket",
      "Connection: Upgrade",
      `Sec-WebSocket-Accept: ${acceptKey}`,
    ];

    socket.write(`${responseHeaders.join("\r\n")}\r\n\r\n`);

    const client = { socket, user };
    CLIENTS.add(client);
    sendFrame(socket, { type: "connection", status: "ready" });

    socket.on("data", (chunk) => handleClientFrame(client, chunk));
    socket.on("close", () => CLIENTS.delete(client));
    socket.on("error", () => CLIENTS.delete(client));
  });

  ensureConnection();

  return {
    broadcast,
  };
}

export function stopTraccarSocketService() {
  if (traccarSocket) {
    try {
      traccarSocket.close();
    } catch (error) {
      // ignore
    }
    traccarSocket = null;
  }
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  for (const client of CLIENTS) {
    try {
      client.socket.end();
    } catch (error) {
      // ignore
    }
  }
  CLIENTS.clear();
}

export default startTraccarSocketService;
