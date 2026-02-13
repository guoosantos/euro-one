import createError from "http-errors";

export function buildIotmOutputPayload(params = {}) {
  const rawOutput = params.output ?? params.outputId ?? params.outputIndex ?? 1;
  const outputNumber = Number(rawOutput);
  if (!Number.isFinite(outputNumber) || outputNumber < 1 || outputNumber > 4) {
    throw createError(400, "Saída inválida para comando IOTM");
  }

  const actionRaw = String(params.action ?? params.state ?? params.mode ?? "on").toLowerCase();
  const action =
    actionRaw === "on" || actionRaw === "ligar"
      ? "on"
      : actionRaw === "off" || actionRaw === "desligar"
        ? "off"
        : null;
  if (!action) {
    throw createError(400, "Ação inválida para comando IOTM");
  }

  const rawDuration = params.durationMs ?? params.duration ?? params.timeMs ?? 0;
  const durationMs = Number(rawDuration);
  if (!Number.isFinite(durationMs) || durationMs < 0) {
    throw createError(400, "Tempo inválido para comando IOTM");
  }

  const ticks = Math.round(durationMs / 10);
  if (!Number.isFinite(ticks) || ticks < 0 || ticks > 0xffff) {
    throw createError(400, "Tempo inválido para comando IOTM");
  }

  const buffer = Buffer.alloc(4);
  buffer.writeUInt8(outputNumber - 1, 0);
  buffer.writeUInt8(action === "on" ? 0x00 : 0x01, 1);
  buffer.writeUInt16BE(ticks, 2);

  return {
    type: "custom",
    attributes: {
      data: buffer.toString("hex").toUpperCase(),
    },
  };
}
