import assert from "node:assert/strict";
import test from "node:test";

import {
  JT808_MESSAGE_IDS,
  createMockPositionMessage,
  encodeJt808Frame,
  extractJt808Frames,
  parseJt808Frame,
  parsePosition0200,
} from "../services/nt407/jt808-codec.js";

test("NT407 JT/T 808 parseia mensagem de posicao mock", () => {
  const terminalId = "139000000001";
  const { frame } = createMockPositionMessage({
    terminalId,
    seq: 33,
    latitude: -23.55052,
    longitude: -46.633308,
    speedKmh: 52.4,
    statusFlags: (1 << 2) | (1 << 3),
  });

  const parsed = parseJt808Frame(frame);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.checksumOk, true);
  assert.equal(parsed.msgId, JT808_MESSAGE_IDS.POSITION_REPORT);
  assert.equal(parsed.terminalId, terminalId);
  assert.equal(parsed.seq, 33);

  const position = parsePosition0200(parsed.body);
  assert.ok(position);
  assert.equal(Number(position.latitude.toFixed(5)), -23.55052);
  assert.equal(Number(position.longitude.toFixed(6)), -46.633308);
});

test("NT407 JT/T 808 extrai frames em lote com remainder", () => {
  const frameA = createMockPositionMessage({ terminalId: "139000000001", seq: 1 }).frame;
  const frameB = createMockPositionMessage({ terminalId: "139000000001", seq: 2 }).frame;

  const partial = frameB.subarray(0, frameB.length - 5);
  const merged = Buffer.concat([frameA, partial]);

  const first = extractJt808Frames(merged);
  assert.equal(first.frames.length, 1);
  assert.ok(first.remaining.length > 0);

  const second = extractJt808Frames(Buffer.concat([first.remaining, frameB.subarray(frameB.length - 5)]));
  assert.equal(second.frames.length, 1);
  assert.equal(second.remaining.length, 0);
});

test("NT407 JT/T 808 preserva bytes escapados no payload", () => {
  const rawBody = Buffer.from([0x7e, 0x7d, 0x01, 0x02]);
  const frame = encodeJt808Frame({
    msgId: JT808_MESSAGE_IDS.TERMINAL_AUTH,
    terminalId: "139000000001",
    seq: 9,
    body: rawBody,
  });

  const parsed = parseJt808Frame(frame);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.checksumOk, true);
  assert.deepEqual(parsed.body, rawBody);
});
