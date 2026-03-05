#!/usr/bin/env node
import net from "node:net";

import {
  JT808_MESSAGE_IDS,
  bcdFromString,
  createMockPositionMessage,
  encodeJt808Frame,
  extractJt808Frames,
  hex,
  parseJt808Frame,
} from "../../server/services/nt407/jt808-codec.js";

const host = process.env.NT407_MOCK_HOST || process.env.NT407_BIND_HOST || "127.0.0.1";
const port = Number(process.env.NT407_MOCK_PORT || process.env.NT407_TCP_PORT || 5001);
const terminalId = String(process.env.NT407_MOCK_TERMINAL || "139000000001");

if (!Number.isFinite(port) || port <= 0) {
  console.error("Porta invalida. Configure NT407_MOCK_PORT ou NT407_TCP_PORT.");
  process.exit(1);
}

function buildRegisterBody() {
  const plate = Buffer.from("ABC1D23", "utf8");
  const body = Buffer.alloc(37 + plate.length);
  body.writeUInt16BE(35, 0); // province
  body.writeUInt16BE(3550, 2); // city
  Buffer.from("X3TCH", "ascii").copy(body, 4);
  Buffer.from("NT407-PRO", "ascii").copy(body, 9);
  Buffer.from("0000001", "ascii").copy(body, 29);
  body.writeUInt8(1, 36); // plate color
  plate.copy(body, 37);
  return body;
}

function buildAuthBody(auth = "NT407-EURO-ONE") {
  return Buffer.from(auth, "utf8");
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sendFrame(socket, frame, label) {
  socket.write(frame);
  console.log(`[mock] enviado ${label}, bytes=${frame.length}`);
}

async function run() {
  console.log(`[mock] conectando em ${host}:${port} terminalId=${terminalId}`);

  const socket = net.createConnection({ host, port });
  let rxBuffer = Buffer.alloc(0);

  socket.on("data", (chunk) => {
    rxBuffer = Buffer.concat([rxBuffer, chunk]);
    const { frames, remaining } = extractJt808Frames(rxBuffer);
    rxBuffer = remaining;

    frames.forEach((frame) => {
      const parsed = parseJt808Frame(frame);
      if (!parsed.ok) {
        console.log("[mock] frame de resposta invalido", parsed.error);
        return;
      }
      console.log(
        `[mock] resposta msgId=${hex(parsed.msgId)} seq=${parsed.seq} terminal=${parsed.terminalId} checksumOk=${parsed.checksumOk}`,
      );
    });
  });

  socket.on("error", (error) => {
    console.error("[mock] erro de socket", error?.message || error);
  });

  await new Promise((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("error", reject);
  });

  const registerFrame = encodeJt808Frame({
    msgId: JT808_MESSAGE_IDS.TERMINAL_REGISTER,
    terminalId,
    seq: 1,
    body: buildRegisterBody(),
  });

  const authFrame = encodeJt808Frame({
    msgId: JT808_MESSAGE_IDS.TERMINAL_AUTH,
    terminalId,
    seq: 2,
    body: buildAuthBody(),
  });

  const positionFrame = createMockPositionMessage({
    terminalId,
    seq: 3,
    latitude: -23.55052,
    longitude: -46.633308,
    speedKmh: 48.7,
    alarmFlags: 1 << 2, // fadiga (bit usado no serviço)
    statusFlags: 0,
    fixTime: new Date(),
  }).frame;

  sendFrame(socket, registerFrame, "0x0100 register");
  await wait(350);
  sendFrame(socket, authFrame, "0x0102 auth");
  await wait(350);
  sendFrame(socket, positionFrame, "0x0200 position (fatigue)");

  await wait(2000);
  socket.end();
  console.log("[mock] finalizado");
}

run().catch((error) => {
  console.error("[mock] falha", error?.message || error);
  process.exit(1);
});
