export const COMMAND_TABS = [
  { id: "list", label: "Comandos", permission: { menuKey: "primary", pageKey: "commands", subKey: "list" } },
  { id: "advanced", label: "Avançado", permission: { menuKey: "primary", pageKey: "commands", subKey: "advanced" } },
  { id: "create", label: "Criar comandos", permission: { menuKey: "primary", pageKey: "commands", subKey: "create" } },
];

export function filterCommandTabs(getPermission) {
  return COMMAND_TABS.filter((tab) => getPermission(tab.permission).canShow);
}
