import { randomUUID } from "node:crypto";

const FRAME_FLAG = 0x7e;
const ESCAPE_FLAG = 0x7d;
const ESCAPE_7D = 0x01;
const ESCAPE_7E = 0x02;

export const JT808_MESSAGE_IDS = {
  TERMINAL_COMMON_RESPONSE: 0x0001,
  TERMINAL_HEARTBEAT: 0x0002,
  TERMINAL_REGISTER: 0x0100,
  TERMINAL_AUTH: 0x0102,
  POSITION_REPORT: 0x0200,
  BATCH_POSITION_UPLOAD: 0x0704,
  MULTIMEDIA_EVENT_UPLOAD: 0x0800,
  MULTIMEDIA_DATA_UPLOAD: 0x0801,
  STORED_MULTIMEDIA_RESPONSE: 0x0802,
  PLATFORM_COMMON_RESPONSE: 0x8001,
  TERMINAL_REGISTER_RESPONSE: 0x8100,
  REALTIME_STREAM_REQUEST: 0x9101,
  REALTIME_STREAM_CONTROL: 0x9102,
  REALTIME_STREAM_STATUS: 0x9105,
  QUERY_RESOURCE_LIST: 0x9205,
  PLAYBACK_REQUEST: 0x9201,
  PLAYBACK_CONTROL: 0x9202,
  FILE_UPLOAD_COMMAND: 0x9206,
  FILE_UPLOAD_CONTROL: 0x9207,
  VIDEO_ATTR_UPLOAD: 0x1003,
  PASSENGER_FLOW_UPLOAD: 0x1005,
  RESOURCE_LIST_UPLOAD: 0x1205,
  FILE_UPLOAD_COMPLETE: 0x1206,
};

const MEDIA_TYPE_MAP = {
  0: "image",
  1: "audio",
  2: "video",
};

const MEDIA_FORMAT_MAP = {
  0: "jpeg",
  1: "tif",
  2: "mp3",
  3: "wav",
  4: "wmv",
};

const MEDIA_EVENT_MAP = {
  0: "platform-command",
  1: "timed-action",
  2: "robbery-alarm",
  3: "collision-rollover-alarm",
  4: "door-open-photo",
  5: "door-close-photo",
  6: "door-state-speed-trigger",
  7: "distance-photo",
};

export function hex(value) {
  return `0x${Number(value).toString(16).padStart(4, "0")}`;
}

export function bcdToString(buffer) {
  if (!buffer?.length) return "";
  let out = "";
  for (const byte of buffer) {
    out += `${(byte >> 4) & 0x0f}${byte & 0x0f}`;
  }
  return out.replace(/^0+/, "") || "0";
}

export function bcdFromString(text, byteLength) {
  const digits = String(text || "")
    .replace(/\D/g, "")
    .slice(-byteLength * 2)
    .padStart(byteLength * 2, "0");
  const out = Buffer.alloc(byteLength);
  for (let i = 0; i < byteLength; i += 1) {
    const hi = Number(digits[i * 2]);
    const lo = Number(digits[i * 2 + 1]);
    out[i] = ((hi & 0x0f) << 4) | (lo & 0x0f);
  }
  return out;
}

export function parseBcdTimestamp(bcdBuffer, { timezoneOffsetHours = 8 } = {}) {
  if (!Buffer.isBuffer(bcdBuffer) || bcdBuffer.length < 6) return null;
  const digits = bcdToString(bcdBuffer).padStart(12, "0");
  const year = Number(`20${digits.slice(0, 2)}`);
  const month = Number(digits.slice(2, 4));
  const day = Number(digits.slice(4, 6));
  const hour = Number(digits.slice(6, 8));
  const minute = Number(digits.slice(8, 10));
  const second = Number(digits.slice(10, 12));
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
  const utcMs = Date.UTC(year, Math.max(0, month - 1), day, hour - timezoneOffsetHours, minute, second);
  if (Number.isNaN(utcMs)) return null;
  return new Date(utcMs).toISOString();
}

export function xorChecksum(buffer) {
  let value = 0;
  for (let i = 0; i < buffer.length; i += 1) {
    value ^= buffer[i];
  }
  return value & 0xff;
}

export function escapeJt808(buffer) {
  const escaped = [];
  for (const byte of buffer) {
    if (byte === FRAME_FLAG) {
      escaped.push(ESCAPE_FLAG, ESCAPE_7E);
      continue;
    }
    if (byte === ESCAPE_FLAG) {
      escaped.push(ESCAPE_FLAG, ESCAPE_7D);
      continue;
    }
    escaped.push(byte);
  }
  return Buffer.from(escaped);
}

export function unescapeJt808(buffer) {
  const unescaped = [];
  for (let i = 0; i < buffer.length; i += 1) {
    const byte = buffer[i];
    if (byte === ESCAPE_FLAG && i + 1 < buffer.length) {
      const next = buffer[i + 1];
      if (next === ESCAPE_7E) {
        unescaped.push(FRAME_FLAG);
        i += 1;
        continue;
      }
      if (next === ESCAPE_7D) {
        unescaped.push(ESCAPE_FLAG);
        i += 1;
        continue;
      }
    }
    unescaped.push(byte);
  }
  return Buffer.from(unescaped);
}

export function extractJt808Frames(buffer) {
  const frames = [];
  if (!buffer?.length) {
    return { frames, remaining: Buffer.alloc(0) };
  }

  let cursor = 0;
  let firstStart = buffer.indexOf(FRAME_FLAG, cursor);

  while (firstStart >= 0) {
    const nextEnd = buffer.indexOf(FRAME_FLAG, firstStart + 1);
    if (nextEnd < 0) {
      return {
        frames,
        remaining: buffer.slice(firstStart),
      };
    }

    if (nextEnd === firstStart + 1) {
      cursor = nextEnd;
      firstStart = buffer.indexOf(FRAME_FLAG, cursor);
      continue;
    }

    frames.push(buffer.slice(firstStart, nextEnd + 1));
    cursor = nextEnd + 1;
    firstStart = buffer.indexOf(FRAME_FLAG, cursor);
  }

  return {
    frames,
    remaining: Buffer.alloc(0),
  };
}

function parseHeader(data) {
  if (data.length < 12) {
    return { error: "header-too-short" };
  }

  const msgId = data.readUInt16BE(0);
  const bodyProps = data.readUInt16BE(2);
  const bodyLength = bodyProps & 0x03ff;
  const encryption = (bodyProps >> 10) & 0x07;
  const hasSubpackage = ((bodyProps >> 13) & 0x01) === 1;
  const versionFlag = ((bodyProps >> 14) & 0x01) === 1;

  const terminalId = bcdToString(data.slice(4, 10)).padStart(12, "0");
  const seq = data.readUInt16BE(10);

  let offset = 12;
  let packageInfo = null;
  if (hasSubpackage) {
    if (data.length < 16) {
      return { error: "subpackage-header-too-short" };
    }
    packageInfo = {
      total: data.readUInt16BE(12),
      index: data.readUInt16BE(14),
    };
    offset = 16;
  }

  const body = data.slice(offset);

  return {
    msgId,
    bodyProps,
    bodyLength,
    encryption,
    hasSubpackage,
    versionFlag,
    terminalId,
    seq,
    packageInfo,
    body,
  };
}

export function parseJt808Frame(rawFrame) {
  if (!rawFrame?.length) {
    return { ok: false, error: "empty-frame" };
  }
  if (rawFrame[0] !== FRAME_FLAG || rawFrame[rawFrame.length - 1] !== FRAME_FLAG) {
    return { ok: false, error: "invalid-frame-markers" };
  }

  const packed = rawFrame.slice(1, -1);
  const data = unescapeJt808(packed);
  if (data.length < 3) {
    return { ok: false, error: "invalid-frame-length" };
  }

  const checkCode = data[data.length - 1];
  const payload = data.slice(0, -1);
  const checkCodeExpected = xorChecksum(payload);
  const checksumOk = checkCode === checkCodeExpected;

  const header = parseHeader(payload);
  if (header.error) {
    return {
      ok: false,
      checksumOk,
      checkCode,
      checkCodeExpected,
      error: header.error,
    };
  }

  return {
    ok: true,
    checksumOk,
    checkCode,
    checkCodeExpected,
    ...header,
    rawFrame,
    receivedAt: new Date().toISOString(),
  };
}

export function encodeJt808Frame({
  msgId,
  terminalId,
  seq = 1,
  body = Buffer.alloc(0),
  encryption = 0,
  packageInfo = null,
} = {}) {
  const payloadBody = Buffer.isBuffer(body) ? body : Buffer.from(body || []);
  const hasSubpackage = Boolean(packageInfo?.total && packageInfo?.index);
  const props =
    (payloadBody.length & 0x03ff) |
    ((encryption & 0x07) << 10) |
    (hasSubpackage ? 1 << 13 : 0);

  const headerSize = hasSubpackage ? 16 : 12;
  const payload = Buffer.alloc(headerSize + payloadBody.length);

  payload.writeUInt16BE(Number(msgId) & 0xffff, 0);
  payload.writeUInt16BE(props, 2);
  bcdFromString(terminalId, 6).copy(payload, 4);
  payload.writeUInt16BE(Number(seq) & 0xffff, 10);

  let offset = 12;
  if (hasSubpackage) {
    payload.writeUInt16BE(Number(packageInfo.total) & 0xffff, 12);
    payload.writeUInt16BE(Number(packageInfo.index) & 0xffff, 14);
    offset = 16;
  }

  payloadBody.copy(payload, offset);
  const checksum = xorChecksum(payload);
  const escaped = escapeJt808(Buffer.concat([payload, Buffer.from([checksum])]));
  return Buffer.concat([Buffer.from([FRAME_FLAG]), escaped, Buffer.from([FRAME_FLAG])]);
}

export function buildPlatformGeneralResponse({ terminalId, replySeq, replyMsgId, result = 0, seq = 1 } = {}) {
  const body = Buffer.alloc(5);
  body.writeUInt16BE(Number(replySeq) & 0xffff, 0);
  body.writeUInt16BE(Number(replyMsgId) & 0xffff, 2);
  body.writeUInt8(Number(result) & 0xff, 4);
  return encodeJt808Frame({
    msgId: JT808_MESSAGE_IDS.PLATFORM_COMMON_RESPONSE,
    terminalId,
    seq,
    body,
  });
}

export function buildTerminalRegisterResponse({ terminalId, replySeq, result = 0, authCode = "NT407" } = {}) {
  const auth = Buffer.from(String(authCode || ""), "utf8");
  const body = Buffer.alloc(3 + auth.length);
  body.writeUInt16BE(Number(replySeq) & 0xffff, 0);
  body.writeUInt8(Number(result) & 0xff, 2);
  if (auth.length) {
    auth.copy(body, 3);
  }

  return encodeJt808Frame({
    msgId: JT808_MESSAGE_IDS.TERMINAL_REGISTER_RESPONSE,
    terminalId,
    seq: ((Number(replySeq) || 0) + 1) & 0xffff,
    body,
  });
}

export function parseRegister0100(body) {
  if (!Buffer.isBuffer(body) || body.length < 37) {
    return null;
  }

  const provinceId = body.readUInt16BE(0);
  const cityId = body.readUInt16BE(2);
  const manufacturerId = body.slice(4, 9).toString("ascii").replace(/\u0000/g, "").trim();
  const terminalModel = body.slice(9, 29).toString("ascii").replace(/\u0000/g, "").trim();
  const terminalSerial = body.slice(29, 36).toString("ascii").replace(/\u0000/g, "").trim();
  const plateColor = body.readUInt8(36);
  const vehicleNo = body.slice(37).toString("utf8").replace(/\u0000/g, "").trim();

  return {
    provinceId,
    cityId,
    manufacturerId,
    terminalModel,
    terminalSerial,
    plateColor,
    vehicleNo,
  };
}

function parseLocationBase(baseBody) {
  if (!Buffer.isBuffer(baseBody) || baseBody.length < 28) {
    return null;
  }

  const alarmFlags = baseBody.readUInt32BE(0);
  const statusFlags = baseBody.readUInt32BE(4);
  const latitudeRaw = baseBody.readUInt32BE(8);
  const longitudeRaw = baseBody.readUInt32BE(12);
  const altitude = baseBody.readUInt16BE(16);
  const speedKmh = baseBody.readUInt16BE(18) / 10;
  const direction = baseBody.readUInt16BE(20);
  const fixTime = parseBcdTimestamp(baseBody.slice(22, 28));

  const isSouth = ((statusFlags >> 2) & 0x1) === 1;
  const isWest = ((statusFlags >> 3) & 0x1) === 1;

  return {
    alarmFlags,
    statusFlags,
    latitude: (isSouth ? -1 : 1) * (latitudeRaw / 1_000_000),
    longitude: (isWest ? -1 : 1) * (longitudeRaw / 1_000_000),
    altitude,
    speedKmh,
    direction,
    fixTime,
  };
}

function parseLocationExtras(extraBody) {
  const extras = [];
  let offset = 0;

  while (offset + 2 <= extraBody.length) {
    const id = extraBody.readUInt8(offset);
    const length = extraBody.readUInt8(offset + 1);
    const valueStart = offset + 2;
    const valueEnd = valueStart + length;
    if (valueEnd > extraBody.length) {
      break;
    }
    const value = extraBody.slice(valueStart, valueEnd);

    const entry = {
      id,
      length,
      hex: value.toString("hex"),
      value,
    };

    if (id === 0x01 && length >= 4) {
      entry.name = "mileage";
      entry.km = value.readUInt32BE(0) / 10;
    } else if (id === 0x02 && length >= 2) {
      entry.name = "fuel";
      entry.liters = value.readUInt16BE(0) / 10;
    } else if (id === 0x03 && length >= 2) {
      entry.name = "speed";
      entry.speedKmh = value.readUInt16BE(0) / 10;
    } else if (id === 0x14 && length >= 4) {
      entry.name = "videoAlarmFlags";
      entry.flags = value.readUInt32BE(0);
    } else if (id === 0x15 && length >= 4) {
      entry.name = "videoSignalLoss";
      entry.flags = value.readUInt32BE(0);
    } else if (id === 0x16 && length >= 4) {
      entry.name = "videoSignalMask";
      entry.flags = value.readUInt32BE(0);
    } else if (id === 0x17 && length >= 2) {
      entry.name = "storageFault";
      entry.flags = value.readUInt16BE(0);
    } else if (id === 0x18 && length >= 2) {
      entry.name = "abnormalDrivingBehavior";
      entry.behaviorFlags = value.readUInt16BE(0);
      if (length >= 3) {
        entry.fatigueScore = value.readUInt8(2);
      }
    }

    extras.push(entry);
    offset = valueEnd;
  }

  return extras;
}

export function parsePosition0200(body) {
  if (!Buffer.isBuffer(body) || body.length < 28) {
    return null;
  }

  const base = parseLocationBase(body.slice(0, 28));
  const extras = parseLocationExtras(body.slice(28));
  return {
    ...base,
    extras,
  };
}

export function parseBatchPosition0704(body) {
  if (!Buffer.isBuffer(body) || body.length < 3) {
    return [];
  }

  const total = body.readUInt16BE(0);
  const locationType = body.readUInt8(2);
  const items = [];

  let offset = 3;
  while (offset + 2 <= body.length && items.length < total) {
    const length = body.readUInt16BE(offset);
    const start = offset + 2;
    const end = start + length;
    if (end > body.length) break;

    const location = parsePosition0200(body.slice(start, end));
    if (location) {
      items.push({ ...location, locationType });
    }

    offset = end;
  }

  return items;
}

export function parseMultimediaEvent0800(body) {
  if (!Buffer.isBuffer(body) || body.length < 8) {
    return null;
  }

  const mediaId = body.readUInt32BE(0);
  const mediaTypeCode = body.readUInt8(4);
  const mediaFormatCode = body.readUInt8(5);
  const eventCode = body.readUInt8(6);
  const channel = body.readUInt8(7);

  return {
    mediaId,
    mediaTypeCode,
    mediaType: MEDIA_TYPE_MAP[mediaTypeCode] || "unknown",
    mediaFormatCode,
    mediaFormat: MEDIA_FORMAT_MAP[mediaFormatCode] || "unknown",
    eventCode,
    eventType: MEDIA_EVENT_MAP[eventCode] || "unknown",
    channel,
  };
}

export function parseMultimediaData0801(body) {
  if (!Buffer.isBuffer(body) || body.length < 36) {
    return null;
  }

  const mediaId = body.readUInt32BE(0);
  const mediaTypeCode = body.readUInt8(4);
  const mediaFormatCode = body.readUInt8(5);
  const eventCode = body.readUInt8(6);
  const channel = body.readUInt8(7);

  const locationBuffer = body.slice(8, 36);
  const location = parseLocationBase(locationBuffer);
  const payload = body.slice(36);

  return {
    mediaId,
    mediaTypeCode,
    mediaType: MEDIA_TYPE_MAP[mediaTypeCode] || "unknown",
    mediaFormatCode,
    mediaFormat: MEDIA_FORMAT_MAP[mediaFormatCode] || "unknown",
    eventCode,
    eventType: MEDIA_EVENT_MAP[eventCode] || "unknown",
    channel,
    location,
    payload,
  };
}

export function parseStoredMultimediaResponse0802(body) {
  if (!Buffer.isBuffer(body) || body.length < 4) {
    return null;
  }

  const responseSeq = body.readUInt16BE(0);
  const totalItems = body.readUInt16BE(2);
  const items = [];

  let offset = 4;
  while (offset + 36 <= body.length) {
    const mediaId = body.readUInt32BE(offset);
    const mediaTypeCode = body.readUInt8(offset + 4);
    const mediaFormatCode = body.readUInt8(offset + 5);
    const eventCode = body.readUInt8(offset + 6);
    const channel = body.readUInt8(offset + 7);
    const location = parseLocationBase(body.slice(offset + 8, offset + 36));

    items.push({
      mediaId,
      mediaTypeCode,
      mediaType: MEDIA_TYPE_MAP[mediaTypeCode] || "unknown",
      mediaFormatCode,
      mediaFormat: MEDIA_FORMAT_MAP[mediaFormatCode] || "unknown",
      eventCode,
      eventType: MEDIA_EVENT_MAP[eventCode] || "unknown",
      channel,
      location,
    });

    offset += 36;
  }

  return {
    responseSeq,
    totalItems,
    items,
  };
}

export function parseVideoAttributes1003(body) {
  if (!Buffer.isBuffer(body) || body.length < 10) {
    return null;
  }

  return {
    channelCount: body.readUInt8(0),
    audioChannelCount: body.readUInt8(1),
    maxAudioChannelCount: body.readUInt8(2),
    maxVideoChannelCount: body.readUInt8(3),
    hardDiskCount: body.readUInt8(4),
    alarmSupportMask: body.readUInt32BE(5),
  };
}

export function parsePassengerFlow1005(body) {
  if (!Buffer.isBuffer(body) || body.length < 16) {
    return null;
  }
  return {
    startTime: parseBcdTimestamp(body.slice(0, 6)),
    endTime: parseBcdTimestamp(body.slice(6, 12)),
    onboard: body.readUInt16BE(12),
    offboard: body.readUInt16BE(14),
  };
}

export function parseResourceList1205(body) {
  if (!Buffer.isBuffer(body) || body.length < 6) {
    return null;
  }

  const responseSeq = body.readUInt16BE(0);
  const totalItems = body.readUInt32BE(2);
  return {
    responseSeq,
    totalItems,
  };
}

export function buildLiveStreamRequest9101({
  serverIp,
  tcpPort,
  udpPort,
  channel = 1,
  dataType = 0,
  streamType = 0,
} = {}) {
  const ipBuffer = Buffer.from(String(serverIp || "127.0.0.1"), "utf8");
  const body = Buffer.alloc(1 + ipBuffer.length + 2 + 2 + 1 + 1 + 1);
  body.writeUInt8(ipBuffer.length, 0);
  ipBuffer.copy(body, 1);

  let offset = 1 + ipBuffer.length;
  body.writeUInt16BE(Number(tcpPort) & 0xffff, offset);
  offset += 2;
  body.writeUInt16BE(Number(udpPort) & 0xffff, offset);
  offset += 2;
  body.writeUInt8(Number(channel) & 0xff, offset);
  offset += 1;
  body.writeUInt8(Number(dataType) & 0xff, offset);
  offset += 1;
  body.writeUInt8(Number(streamType) & 0xff, offset);
  return body;
}

export function buildLiveStreamControl9102({ channel = 1, command = 0, closeType = 0, switchStream = 0 } = {}) {
  const body = Buffer.alloc(4);
  body.writeUInt8(Number(channel) & 0xff, 0);
  body.writeUInt8(Number(command) & 0xff, 1);
  body.writeUInt8(Number(closeType) & 0xff, 2);
  body.writeUInt8(Number(switchStream) & 0xff, 3);
  return body;
}

export function classifyMessage(parsed) {
  if (!parsed?.ok) {
    return "invalid";
  }
  const id = parsed.msgId;
  if (id >= 0x9000 && id <= 0x93ff) return "jt1078-signaling";
  return "jt808-signaling";
}

export function createMockPositionMessage({
  terminalId,
  seq = 1,
  latitude = -23.55052,
  longitude = -46.633308,
  speedKmh = 52.4,
  alarmFlags = 0,
  statusFlags = 0,
  fixTime = new Date(),
} = {}) {
  const body = Buffer.alloc(28);
  body.writeUInt32BE(alarmFlags >>> 0, 0);
  body.writeUInt32BE(statusFlags >>> 0, 4);
  body.writeUInt32BE(Math.round(Math.abs(latitude) * 1_000_000), 8);
  body.writeUInt32BE(Math.round(Math.abs(longitude) * 1_000_000), 12);
  body.writeUInt16BE(750, 16);
  body.writeUInt16BE(Math.round(speedKmh * 10), 18);
  body.writeUInt16BE(182, 20);

  const dt = new Date(fixTime);
  const yy = String(dt.getUTCFullYear()).slice(-2);
  const MM = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  const hh = String((dt.getUTCHours() + 8) % 24).padStart(2, "0");
  const mm = String(dt.getUTCMinutes()).padStart(2, "0");
  const ss = String(dt.getUTCSeconds()).padStart(2, "0");
  bcdFromString(`${yy}${MM}${dd}${hh}${mm}${ss}`, 6).copy(body, 22);

  return {
    id: randomUUID(),
    frame: encodeJt808Frame({
      msgId: JT808_MESSAGE_IDS.POSITION_REPORT,
      terminalId,
      seq,
      body,
    }),
  };
}
