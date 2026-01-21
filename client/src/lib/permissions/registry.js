import {
  BarChart3,
  Banknote,
  Boxes,
  Camera,
  Car,
  CalendarClock,
  Cpu,
  FileBarChart,
  FileText,
  Flame,
  GaugeCircle,
  HardDrive,
  Home,
  Map,
  MapPinned,
  Medal,
  NotebookPen,
  Package,
  Radio,
  ShieldCheck,
  Target,
  Terminal,
  UploadCloud,
  User,
  UserCog,
  Users,
  Video,
  Wrench,
} from "lucide-react";

export const PERMISSION_REGISTRY = [
  {
    menuKey: "business",
    label: "Negócios",
    pages: [
      { pageKey: "dashboard", label: "Dashboard" },
      { pageKey: "finance", label: "Financeiro" },
      { pageKey: "crm", label: "CRM" },
    ],
  },
  {
    menuKey: "primary",
    label: "Principais",
    pages: [
      { pageKey: "home", label: "Home" },
      { pageKey: "monitoring", label: "Monitoramento" },
      { pageKey: "trips", label: "Trajetos / Replay" },
      {
        pageKey: "devices",
        label: "Dispositivos",
        subpages: [
          { subKey: "devices-list", label: "Equipamentos" },
          { subKey: "devices-chips", label: "Chip" },
          { subKey: "devices-models", label: "Modelos & Portas" },
          { subKey: "devices-stock", label: "Estoque" },
        ],
      },
      {
        pageKey: "commands",
        label: "Comandos",
        subpages: [
          { subKey: "list", label: "Comandos" },
          { subKey: "advanced", label: "Avançado" },
          { subKey: "create", label: "Criar comandos" },
        ],
      },
      {
        pageKey: "events",
        label: "Eventos",
        subpages: [
          { subKey: "report", label: "Relatório" },
          { subKey: "severity", label: "Severidade" },
        ],
      },
    ],
  },
  {
    menuKey: "fleet",
    label: "Frotas",
    pages: [
      { pageKey: "vehicles", label: "Veículos" },
      {
        pageKey: "documents",
        label: "Documentos",
        subpages: [
          { subKey: "drivers", label: "Motorista" },
          { subKey: "contracts", label: "Contratos" },
        ],
      },
      {
        pageKey: "services",
        label: "Serviços",
        subpages: [
          { subKey: "service-orders", label: "Ordem de Serviço" },
          { subKey: "service-orders-all", label: "Todos" },
          { subKey: "service-orders-installation", label: "Instalação" },
          { subKey: "service-orders-maintenance", label: "Manutenção" },
          { subKey: "service-orders-removal", label: "Retirada" },
          { subKey: "service-orders-socorro", label: "Socorro" },
          { subKey: "service-orders-remanejamento", label: "Remanejamento" },
          { subKey: "service-orders-reinstall", label: "Reinstalação" },
          { subKey: "appointments", label: "Agendamentos" },
          { subKey: "technicians", label: "Técnico" },
        ],
      },
      { pageKey: "routes", label: "Rotas" },
      { pageKey: "geofences", label: "Cercas" },
      { pageKey: "targets", label: "Alvos" },
      { pageKey: "itineraries", label: "Embarcar Itinerários" },
      { pageKey: "deliveries", label: "Entregas" },
    ],
  },
  {
    menuKey: "telemetry",
    label: "Telemetria Euro",
    pages: [
      {
        pageKey: "euro-view",
        label: "Euro View",
        subpages: [
          { subKey: "videos", label: "Vídeos" },
          { subKey: "face", label: "Reconhecimento Facial" },
          { subKey: "live", label: "Live" },
        ],
      },
      {
        pageKey: "euro-can",
        label: "Euro CAN",
        subpages: [
          { subKey: "fuel", label: "Combustível" },
          { subKey: "compliance", label: "Compliance" },
          { subKey: "driver-behavior", label: "Drive Behavior" },
          { subKey: "maintenance", label: "Manutenção" },
        ],
      },
    ],
  },
  {
    menuKey: "admin",
    label: "Administração",
    pages: [
      {
        pageKey: "reports",
        label: "Relatórios",
        subpages: [
          { subKey: "reports-positions", label: "Relatório de Posições" },
          { subKey: "reports-analytic", label: "Relatório Analítico" },
        ],
      },
      {
        pageKey: "analytics",
        label: "Análises",
        subpages: [
          { subKey: "analytics-heatmap", label: "Mapa de Calor" },
          { subKey: "ranking", label: "Ranking" },
          { subKey: "risk-area", label: "Área de Risco" },
          { subKey: "security-events", label: "Segurança" },
        ],
      },
      {
        pageKey: "mirrors",
        label: "Espelhamento",
        subpages: [
          { subKey: "mirrors-main", label: "Espelhamento" },
          { subKey: "mirrors-received", label: "Espelhados" },
        ],
      },
      { pageKey: "clients", label: "Clientes" },
      { pageKey: "users", label: "Usuários" },
      { pageKey: "import", label: "Importar Base (XLSX)" },
    ],
  },
];

export const MENU_REGISTRY = [
  {
    key: "negocios",
    title: "NEGÓCIOS",
    items: [
      { to: "/dashboard", label: "Dashboard", icon: Home, permission: { menuKey: "business", pageKey: "dashboard" } },
      { to: "/finance", label: "Financeiro", icon: Banknote, permission: { menuKey: "business", pageKey: "finance" } },
      { to: "/crm", label: "CRM", icon: NotebookPen, permission: { menuKey: "business", pageKey: "crm" } },
    ],
  },
  {
    key: "principais",
    title: "PRINCIPAIS",
    items: [
      { to: "/home", label: "Home", icon: Home, permission: { menuKey: "primary", pageKey: "home" } },
      { to: "/monitoring", label: "Monitoramento", icon: MapPinned, permission: { menuKey: "primary", pageKey: "monitoring" } },
      { to: "/trips", label: "Trajetos / Replay", icon: MapPinned, permission: { menuKey: "primary", pageKey: "trips" } },
      {
        key: "dispositivos",
        label: "Dispositivos",
        icon: Cpu,
        children: [
          { to: "/devices", label: "Equipamentos", icon: Cpu, permission: { menuKey: "primary", pageKey: "devices", subKey: "devices-list" } },
          { to: "/devices/chips", label: "Chip", icon: HardDrive, permission: { menuKey: "primary", pageKey: "devices", subKey: "devices-chips" } },
          { to: "/devices/products", label: "Modelos & Portas", icon: Boxes, permission: { menuKey: "primary", pageKey: "devices", subKey: "devices-models" } },
          { to: "/devices/stock", label: "Estoque", icon: Map, permission: { menuKey: "primary", pageKey: "devices", subKey: "devices-stock" } },
          { to: "/commands", label: "Comandos", icon: Terminal, permission: { menuKey: "primary", pageKey: "commands" } },
        ],
      },
      { to: "/events", label: "Eventos", icon: Video, permission: { menuKey: "primary", pageKey: "events" } },
    ],
  },
  {
    key: "frotas",
    title: "FROTAS",
    items: [
      { to: "/vehicles", label: "Veículos", icon: Car, permission: { menuKey: "fleet", pageKey: "vehicles" } },
      {
        key: "documentos",
        label: "Documentos",
        icon: FileText,
        children: [
          { to: "/drivers", label: "Motorista", icon: UserCog, permission: { menuKey: "fleet", pageKey: "documents", subKey: "drivers" } },
          { to: "/documents", label: "Contratos", icon: FileText, permission: { menuKey: "fleet", pageKey: "documents", subKey: "contracts" } },
        ],
      },
      {
        key: "servicos",
        label: "Serviços",
        icon: Wrench,
        children: [
          { to: "/services", label: "Ordem de Serviço", icon: Wrench, permission: { menuKey: "fleet", pageKey: "services", subKey: "service-orders" } },
          { to: "/appointments", label: "Agendamentos", icon: CalendarClock, permission: { menuKey: "fleet", pageKey: "services", subKey: "appointments" } },
          { to: "/technicians", label: "Técnico", icon: UserCog, permission: { menuKey: "fleet", pageKey: "services", subKey: "technicians" } },
        ],
      },
      { to: "/routes", label: "Rotas", icon: Map, permission: { menuKey: "fleet", pageKey: "routes" } },
      { to: "/geofences", label: "Cercas", icon: Map, permission: { menuKey: "fleet", pageKey: "geofences" } },
      { to: "/targets", label: "Alvos", icon: Target, permission: { menuKey: "fleet", pageKey: "targets" } },
      { to: "/itineraries", label: "Embarcar Itinerários", icon: Map, permission: { menuKey: "fleet", pageKey: "itineraries" } },
      { to: "/deliveries", label: "Entregas", icon: Package, permission: { menuKey: "fleet", pageKey: "deliveries" } },
    ],
  },
  {
    key: "telemetria",
    title: "TELEMETRIA EURO",
    items: [
      {
        key: "euro-view",
        label: "Euro View",
        icon: Video,
        children: [
          { to: "/videos", label: "Vídeos", icon: Camera, permission: { menuKey: "telemetry", pageKey: "euro-view", subKey: "videos" } },
          { to: "/face", label: "Reconhecimento Facial", icon: Camera, permission: { menuKey: "telemetry", pageKey: "euro-view", subKey: "face" } },
          { to: "/live", label: "Live", icon: Radio, permission: { menuKey: "telemetry", pageKey: "euro-view", subKey: "live" } },
        ],
      },
      {
        key: "euro-can",
        label: "Euro CAN",
        icon: Cpu,
        children: [
          { to: "/fuel", label: "Combustível", icon: Flame, permission: { menuKey: "telemetry", pageKey: "euro-can", subKey: "fuel" } },
          { to: "/compliance", label: "Compliance", icon: ShieldCheck, permission: { menuKey: "telemetry", pageKey: "euro-can", subKey: "compliance" } },
          { to: "/driver-behavior", label: "Drive Behavior", icon: GaugeCircle, permission: { menuKey: "telemetry", pageKey: "euro-can", subKey: "driver-behavior" } },
          { to: "/maintenance", label: "Manutenção", icon: Wrench, permission: { menuKey: "telemetry", pageKey: "euro-can", subKey: "maintenance" } },
        ],
      },
    ],
  },
  {
    key: "administracao",
    title: "ADMINISTRAÇÃO",
    items: [
      {
        key: "relatorios",
        label: "Relatórios",
        icon: FileText,
        children: [
          { to: "/reports/positions", label: "Relatório de Posições", icon: FileBarChart, permission: { menuKey: "admin", pageKey: "reports", subKey: "reports-positions" } },
          { to: "/reports/analytic", label: "Relatório Analítico", icon: FileBarChart, permission: { menuKey: "admin", pageKey: "reports", subKey: "reports-analytic" } },
        ],
      },
      {
        key: "analises",
        label: "Análises",
        icon: BarChart3,
        children: [
          { to: "/analytics/heatmap", label: "Mapa de Calor", icon: BarChart3, permission: { menuKey: "admin", pageKey: "analytics", subKey: "analytics-heatmap" } },
          { to: "/ranking", label: "Ranking", icon: Medal, permission: { menuKey: "admin", pageKey: "analytics", subKey: "ranking" } },
          { to: "/analytics/risk-area", label: "Área de Risco", icon: Map, permission: { menuKey: "admin", pageKey: "analytics", subKey: "risk-area" } },
          { to: "/events", label: "Segurança", icon: ShieldCheck, permission: { menuKey: "primary", pageKey: "events" } },
        ],
      },
      {
        to: "/clients",
        label: "Clientes",
        icon: Users,
        permission: { menuKey: "admin", pageKey: "clients" },
        isVisible: ({ canManageUsers }) => canManageUsers,
      },
      {
        to: "/users",
        label: "Usuários",
        icon: User,
        permission: { menuKey: "admin", pageKey: "users" },
        isVisible: ({ canManageUsers }) => canManageUsers,
      },
      {
        to: "/mirrors/received",
        label: "Espelhamento",
        icon: Users,
        permission: { menuKey: "admin", pageKey: "mirrors" },
        isVisible: ({ canManageUsers }) => canManageUsers,
      },
      {
        to: "/admin/import-euro-xlsx",
        label: "Importar Base (XLSX)",
        icon: UploadCloud,
        permission: { menuKey: "admin", pageKey: "import" },
        isVisible: ({ isEuroImportEnabled, role }) => role === "admin" && isEuroImportEnabled,
      },
    ],
  },
];

export default PERMISSION_REGISTRY;
