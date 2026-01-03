const normalizeText = (value) => String(value ?? "").toLowerCase();

export const normalizeProtocolKey = (value) => (value ? normalizeText(value).trim() : "");

export function resolveCommandSendError(error, fallbackMessage = "Erro ao enviar comando") {
  const status = Number(error?.response?.status ?? error?.status);
  const payload = error?.response?.data || {};
  const message =
    payload?.error?.message ||
    payload?.message ||
    (error instanceof Error && error.message ? error.message : null) ||
    null;

  if (status === 400) return message || "Requisição inválida para envio do comando.";
  if (status === 403) return message || "Dispositivo não autorizado para este cliente.";
  if (status === 404) return message || "Veículo ou dispositivo não encontrado.";
  if (status === 409) return message || "Equipamento sem Traccar ID válido.";
  if (status === 502) return message || "Não foi possível conectar ao Traccar.";
  if (status === 503) return message || "Serviço temporariamente indisponível. Tente novamente em instantes.";
  return message || fallbackMessage;
}

export function isCustomCommandConfigured(command, deviceProtocol = null) {
  if (!command || command.kind !== "custom") return true;
  const payload = command?.payload && typeof command.payload === "object" ? command.payload : {};
  const customKind = String(command.customKind || command.kind || "").toUpperCase();
  const commandProtocol = normalizeProtocolKey(command.protocol);
  const selectedProtocol = normalizeProtocolKey(deviceProtocol);

  if (commandProtocol && selectedProtocol && commandProtocol !== selectedProtocol) {
    return false;
  }

  if (customKind === "SMS") {
    return Boolean(payload.message);
  }
  if (customKind === "JSON") {
    return Boolean(payload.type);
  }
  if (customKind === "RAW" || customKind === "HEX") {
    return String(payload.data ?? "").trim().length > 0;
  }

  return false;
}

export function mergeCommands(
  protocolCommands = [],
  customCommands = [],
  { includeHiddenCustom = false, deviceProtocol = null } = {},
) {
  const normalizedDeviceProtocol =
    deviceProtocol === undefined ? undefined : normalizeProtocolKey(deviceProtocol);

  const customVisible = (customCommands || [])
    .filter((command) => includeHiddenCustom || command?.visible)
    .filter((command) => {
      const commandProtocol = normalizeProtocolKey(command?.protocol);
      if (!commandProtocol) return true;
      if (normalizedDeviceProtocol === undefined) return true;
      if (!normalizedDeviceProtocol) return false;
      return commandProtocol === normalizedDeviceProtocol;
    })
    .map((command) => ({
      ...command,
      kind: "custom",
      customKind: command.kind,
      parameters: [],
    }));

  const protocol = (protocolCommands || []).map((command) => ({
    ...command,
    kind: "protocol",
  }));

  return [...protocol, ...customVisible];
}

export function filterCommandsBySearch(commands = [], search = "") {
  const term = normalizeText(search);
  if (!term) return [...commands];
  return commands.filter((command) => {
    const name = normalizeText(command?.name);
    const description = normalizeText(command?.description);
    return name.includes(term) || description.includes(term);
  });
}
