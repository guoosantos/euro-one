import assert from "node:assert/strict";
import test from "node:test";

import { bcdFromString } from "../services/nt407/jt808-codec.js";
import { extractJt1078Packets, parseJt1078Packet } from "../services/nt407/jt1078-codec.js";

function buildPacket({ terminalId = "139000000001", channel = 1, packetSeq = 1, payload = Buffer.from([1, 2, 3, 4]) } = {}) {
  const buffer = Buffer.alloc(30 + payload.length);
  buffer[0] = 0x30;
  buffer[1] = 0x31;
  buffer[2] = 0x63;
  buffer[3] = 0x64;
  buffer[4] = 0x40; // version 1
  buffer[5] = 0x62; // marker 0, payloadType 98
  buffer.writeUInt16BE(packetSeq & 0xffff, 6);
  bcdFromString(terminalId, 6).copy(buffer, 8);
  buffer.writeUInt8(channel & 0xff, 14);
  buffer.writeUInt8(0x10, 15); // dataType P-frame, subpackage atomic
  buffer.writeBigUInt64BE(1234567890n, 16);
  buffer.writeUInt16BE(40, 24);
  buffer.writeUInt16BE(40, 26);
  buffer.writeUInt16BE(payload.length, 28);
  payload.copy(buffer, 30);
  return buffer;
}

test("NT407 JT/T 1078 parseia pacote RTP", () => {
  const packet = buildPacket({ terminalId: "139000000001", channel: 2, packetSeq: 77, payload: Buffer.from([0xaa, 0xbb]) });
  const parsed = parseJt1078Packet(packet);

  assert.ok(parsed);
  assert.equal(parsed.terminalId, "139000000001");
  assert.equal(parsed.channel, 2);
  assert.equal(parsed.packetSeq, 77);
  assert.equal(parsed.dataType, "video-p-frame");
  assert.equal(parsed.bodyLength, 2);
  assert.deepEqual(parsed.payload, Buffer.from([0xaa, 0xbb]));
});

test("NT407 JT/T 1078 extrai pacotes de stream com remainder", () => {
  const packetA = buildPacket({ packetSeq: 1, payload: Buffer.from([1, 2, 3]) });
  const packetB = buildPacket({ packetSeq: 2, payload: Buffer.from([4, 5, 6, 7]) });

  const merged = Buffer.concat([packetA, packetB.subarray(0, packetB.length - 3)]);
  const first = extractJt1078Packets(merged);
  assert.equal(first.packets.length, 1);
  assert.ok(first.remaining.length > 0);

  const second = extractJt1078Packets(Buffer.concat([first.remaining, packetB.subarray(packetB.length - 3)]));
  assert.equal(second.packets.length, 1);
  assert.equal(second.remaining.length, 0);
  assert.equal(second.packets[0].packetSeq, 2);
});
