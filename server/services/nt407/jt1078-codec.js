import { bcdToString } from "./jt808-codec.js";

const FRAME_HEADER = Buffer.from([0x30, 0x31, 0x63, 0x64]);
const MIN_PACKET_SIZE = 30;

function readUInt64BE(buffer) {
  if (!buffer || buffer.length < 8) return null;
  try {
    const value = buffer.readBigUInt64BE(0);
    const asNumber = Number(value);
    return Number.isSafeInteger(asNumber) ? asNumber : value.toString();
  } catch (_error) {
    return null;
  }
}

function findHeader(buffer, from = 0) {
  for (let i = from; i <= buffer.length - FRAME_HEADER.length; i += 1) {
    if (
      buffer[i] === FRAME_HEADER[0] &&
      buffer[i + 1] === FRAME_HEADER[1] &&
      buffer[i + 2] === FRAME_HEADER[2] &&
      buffer[i + 3] === FRAME_HEADER[3]
    ) {
      return i;
    }
  }
  return -1;
}

function parseDataTypeNibble(value) {
  switch (value) {
    case 0x0:
      return "video-i-frame";
    case 0x1:
      return "video-p-frame";
    case 0x2:
      return "video-b-frame";
    case 0x3:
      return "audio-frame";
    case 0x4:
      return "transparent";
    default:
      return "unknown";
  }
}

function parseSubpackageFlag(value) {
  switch (value) {
    case 0x0:
      return "atomic";
    case 0x1:
      return "first";
    case 0x2:
      return "last";
    case 0x3:
      return "middle";
    default:
      return "unknown";
  }
}

export function parseJt1078Packet(packet) {
  if (!Buffer.isBuffer(packet) || packet.length < MIN_PACKET_SIZE) {
    return null;
  }

  if (!packet.subarray(0, 4).equals(FRAME_HEADER)) {
    return null;
  }

  const version = (packet[4] >> 6) & 0x03;
  const marker = (packet[5] >> 7) & 0x01;
  const payloadType = packet[5] & 0x7f;
  const packetSeq = packet.readUInt16BE(6);
  const terminalId = bcdToString(packet.subarray(8, 14)).padStart(12, "0");
  const channel = packet.readUInt8(14);
  const dataTypeNibble = (packet[15] >> 4) & 0x0f;
  const subpackageNibble = packet[15] & 0x0f;
  const timestampRaw = packet.subarray(16, 24);
  const timestamp = readUInt64BE(timestampRaw);
  const lastIFrameIntervalMs = packet.readUInt16BE(24);
  const lastFrameIntervalMs = packet.readUInt16BE(26);
  const bodyLength = packet.readUInt16BE(28);
  const payload = packet.subarray(30);

  return {
    protocol: "jt1078-rtp",
    version,
    marker,
    payloadType,
    packetSeq,
    terminalId,
    channel,
    dataTypeCode: dataTypeNibble,
    dataType: parseDataTypeNibble(dataTypeNibble),
    subpackageCode: subpackageNibble,
    subpackageFlag: parseSubpackageFlag(subpackageNibble),
    timestamp,
    timestampRaw: timestampRaw.toString("hex"),
    lastIFrameIntervalMs,
    lastFrameIntervalMs,
    bodyLength,
    payload,
  };
}

export function extractJt1078Packets(buffer) {
  const packets = [];
  if (!buffer?.length) {
    return { packets, remaining: Buffer.alloc(0) };
  }

  let offset = 0;
  let firstHeader = findHeader(buffer, offset);
  if (firstHeader < 0) {
    return { packets, remaining: Buffer.alloc(0) };
  }
  if (firstHeader > 0) {
    offset = firstHeader;
  }

  while (offset + MIN_PACKET_SIZE <= buffer.length) {
    if (!buffer.subarray(offset, offset + 4).equals(FRAME_HEADER)) {
      const next = findHeader(buffer, offset + 1);
      if (next < 0) {
        return {
          packets,
          remaining: buffer.subarray(buffer.length - Math.min(buffer.length, FRAME_HEADER.length - 1)),
        };
      }
      offset = next;
      continue;
    }

    const bodyLength = buffer.readUInt16BE(offset + 28);
    const totalLength = MIN_PACKET_SIZE + bodyLength;
    if (offset + totalLength > buffer.length) {
      return {
        packets,
        remaining: buffer.subarray(offset),
      };
    }

    const packet = buffer.subarray(offset, offset + totalLength);
    const parsed = parseJt1078Packet(packet);
    if (parsed) {
      packets.push(parsed);
    }
    offset += totalLength;
  }

  return {
    packets,
    remaining: buffer.subarray(offset),
  };
}
