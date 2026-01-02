const normalizeText = (value) => String(value ?? "").toLowerCase();

export const normalizeProtocolKey = (value) => (value ? normalizeText(value).trim() : "");

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
    .filter((command) => String(command?.kind || "").toUpperCase() === "RAW")
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
