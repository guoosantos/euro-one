export const PERMISSIONS_CATALOG = [
  {
    menuKey: "clients",
    label: "Clientes",
    pages: [
      { pageKey: "details", label: "Detalhes", actions: ["view", "create", "edit", "delete"] },
      { pageKey: "users", label: "Usuários", actions: ["view", "create", "edit", "delete"] },
      { pageKey: "vehicles", label: "Veículos", actions: ["view", "create", "edit", "delete"] },
      { pageKey: "permissions", label: "Grupos de permissões", actions: ["view", "create", "edit", "delete"] },
      { pageKey: "mirrors", label: "Espelhamento", actions: ["view", "create", "edit", "delete"] },
    ],
  },
  {
    menuKey: "fleet",
    label: "Frota",
    pages: [
      { pageKey: "vehicles", label: "Veículos", actions: ["view", "create", "edit", "delete"] },
      { pageKey: "devices", label: "Equipamentos", actions: ["view", "create", "edit", "delete"] },
      { pageKey: "drivers", label: "Motoristas", actions: ["view", "create", "edit", "delete"] },
    ],
  },
  {
    menuKey: "monitoring",
    label: "Monitoramento",
    pages: [
      { pageKey: "map", label: "Mapa", actions: ["view"] },
      { pageKey: "events", label: "Eventos", actions: ["view", "create", "edit", "delete"] },
    ],
  },
  {
    menuKey: "reports",
    label: "Relatórios",
    pages: [
      { pageKey: "positions", label: "Posições", actions: ["view", "create"] },
      { pageKey: "analytics", label: "Analytics", actions: ["view"] },
    ],
  },
];

export default PERMISSIONS_CATALOG;
