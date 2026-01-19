import React from "react";
import { Navigate, Route, Routes } from "react-router-dom";

import Layout from "./layout/Layout";
import PrivateRoute from "./components/PrivateRoute";
import RequireRole from "./components/RequireRole.jsx";
import RequireTenant from "./components/RequireTenant.jsx";
import RequirePermission from "./components/RequirePermission.jsx";
import Home from "./pages/Home";
import Dashboard from "./pages/Dashboard";
import Monitoring from "./pages/Monitoring";
import Monitoramento from "./pages/Monitoramento";
import Trips from "./pages/Trips";
import Devices from "./pages/Devices";
import Chips from "./pages/Chips";
import Products from "./pages/Products";
import Stock from "./pages/Stock";
import Commands from "./pages/Commands";
import CreateCommands from "./pages/CreateCommands";
import Vehicles from "./pages/Vehicles";
import Docs from "./pages/Docs";
import Services from "./pages/Services";
import ServiceOrderDetails from "./pages/serviceOrders/ServiceOrderDetails.jsx";
import ServiceOrderExecute from "./pages/serviceOrders/ServiceOrderExecute.jsx";
import ServiceOrderImport from "./pages/serviceOrders/ServiceOrderImport.jsx";
import ServiceOrderNew from "./pages/serviceOrders/ServiceOrderNew.jsx";
import Deliveries from "./pages/Deliveries";
import DeviceImport from "./pages/DeviceImport";
import Geofences from "./pages/Geofences.jsx";
import Targets from "./pages/Targets.jsx";
import Events from "./pages/Events";
import Videos from "./pages/Videos";
import Face from "./pages/Face";
import Ranking from "./pages/Ranking";
import ReportsPositions from "./pages/ReportsPositions.jsx";
import ReportsAnalytic from "./pages/ReportsAnalytic.jsx";
import AnalyticsHeatmap from "./pages/Analytics/Heatmap";
import Account from "./pages/Account";
import Settings from "./pages/Settings";
import Notifications from "./pages/Notifications";
import Clients from "./pages/Clients";
import ClientDetailsPage from "./pages/ClientDetailsPage.jsx";
import MirrorReceivers from "./pages/MirrorReceivers.jsx";
import Users from "./pages/Users";
import Technicians from "./pages/Technicians.jsx";
import Groups from "./pages/Groups";
import Drivers from "./pages/Drivers";
import Login from "./pages/Login";
import Finance from "./pages/Finance";
import DriverBehavior from "./pages/DriverBehavior";
import Maintenance from "./pages/Maintenance";
import Fuel from "./pages/Fuel";
import Routing from "./pages/Routing";
import Compliance from "./pages/Compliance";
import IotSensors from "./pages/IotSensors";
import VideoTelematics from "./pages/VideoTelematics";
import LivePage from "./pages/Live";
import NotFound from "./pages/NotFound";
import RoutesPage from "./pages/Routes";
import Tasks from "./pages/Tasks";
import TaskForm from "./pages/TaskForm";
import TaskDetails from "./pages/TaskDetails";
import Crm from "./pages/Crm";
import Itineraries from "./pages/Itineraries.jsx";
import VehicleDetailsPage from "./pages/VehicleDetailsPage.jsx";
import AdminImportXlsx from "./pages/AdminImportXlsx.jsx";
import Appointments from "./pages/Appointments.jsx";

const isEuroImportEnabled = import.meta.env.VITE_FEATURE_EURO_XLSX_IMPORT === "true";

export const routeConfig = [
  { path: "/dashboard", element: Dashboard, title: "Dashboard", hideTitle: true, requireTenant: true, permission: { menuKey: "business", pageKey: "dashboard" } },
  { path: "/home", element: Home, title: "Visão geral", hideTitle: true, requireTenant: true, permission: { menuKey: "primary", pageKey: "home" } },
  { path: "/monitoring", element: Monitoring, title: "Monitoramento", requireTenant: true, permission: { menuKey: "primary", pageKey: "monitoring" } },
  { path: "/monitoramento", element: Monitoramento, title: "Mapa em tempo real", hideTitle: true, requireTenant: true, permission: { menuKey: "primary", pageKey: "monitoring" } },
  { path: "/trips", element: Trips, title: "Trajetos", hideTitle: true, requireTenant: true, permission: { menuKey: "primary", pageKey: "trips" } },
  { path: "/routes", element: RoutesPage, title: "Rotas", requireTenant: true, permission: { menuKey: "fleet", pageKey: "routes" } },
  { path: "/rotas", element: RoutesPage, title: "Rotas", requireTenant: true, permission: { menuKey: "fleet", pageKey: "routes" } },
  { path: "/devices", element: Devices, title: "Equipamentos", hideTitle: true, requireTenant: true, permission: { menuKey: "primary", pageKey: "devices", subKey: "devices-list" } },
  { path: "/equipamentos", element: Devices, title: "Equipamentos", hideTitle: true, requireTenant: true, permission: { menuKey: "primary", pageKey: "devices", subKey: "devices-list" } },
  { path: "/devices/chips", element: Chips, title: "Chips", hideTitle: true, requireTenant: true, permission: { menuKey: "primary", pageKey: "devices", subKey: "devices-chips" } },
  { path: "/chips", element: Chips, title: "Chips", hideTitle: true, requireTenant: true, permission: { menuKey: "primary", pageKey: "devices", subKey: "devices-chips" } },
  { path: "/devices/products", element: Products, title: "Modelos & Portas", hideTitle: true, requireTenant: true, permission: { menuKey: "primary", pageKey: "devices", subKey: "devices-models" } },
  { path: "/devices/stock", element: Stock, title: "Estoque", hideTitle: true, requireTenant: true, permission: { menuKey: "primary", pageKey: "devices", subKey: "devices-stock" } },
  { path: "/devices/import", element: DeviceImport, title: "Importar dispositivos", requireTenant: true, permission: { menuKey: "primary", pageKey: "devices", subKey: "devices-list" } },
  { path: "/commands", element: Commands, title: "Comandos", hideTitle: true, requireTenant: true, permission: { menuKey: "primary", pageKey: "commands" } },
  { path: "/commands/create", element: CreateCommands, title: "Criar Comandos", hideTitle: true, requireTenant: true, permission: { menuKey: "primary", pageKey: "commands", subKey: "create", requireFull: true } },
  { path: "/vehicles", element: Vehicles, title: "Veículos", hideTitle: true, requireTenant: true, permission: { menuKey: "fleet", pageKey: "vehicles" } },
  { path: "/vehicles/:id", element: VehicleDetailsPage, title: "Veículo", requireTenant: true, permission: { menuKey: "fleet", pageKey: "vehicles" } },
  { path: "/veiculos", element: Vehicles, title: "Veículos", hideTitle: true, requireTenant: true, permission: { menuKey: "fleet", pageKey: "vehicles" } },
  { path: "/veiculos/:id", element: VehicleDetailsPage, title: "Veículo", requireTenant: true, permission: { menuKey: "fleet", pageKey: "vehicles" } },
  { path: "/groups", element: Groups, title: "Grupos", requireTenant: true },
  { path: "/drivers", element: Drivers, title: "Motoristas", requireTenant: true, permission: { menuKey: "fleet", pageKey: "documents", subKey: "drivers" } },
  { path: "/documents", element: Docs, title: "Documentos", requireTenant: true, permission: { menuKey: "fleet", pageKey: "documents", subKey: "contracts" } },
  { path: "/services", element: Services, title: "Ordem de Serviço", hideTitle: true, requireTenant: true, permission: { menuKey: "fleet", pageKey: "services", subKey: "service-orders" } },
  { path: "/services/new", element: ServiceOrderNew, title: "Nova Ordem de Serviço", hideTitle: true, requireTenant: true, permission: { menuKey: "fleet", pageKey: "services", subKey: "service-orders", requireFull: true } },
  { path: "/services/import", element: ServiceOrderImport, title: "Importar OS", requireTenant: true, roles: ["admin"], permission: { menuKey: "fleet", pageKey: "services", subKey: "service-orders", requireFull: true } },
  { path: "/services/:id", element: ServiceOrderDetails, title: "Detalhes da OS", hideTitle: true, requireTenant: true, permission: { menuKey: "fleet", pageKey: "services", subKey: "service-orders" } },
  { path: "/services/:id/execute", element: ServiceOrderExecute, title: "Execução da OS", hideTitle: true, requireTenant: true, permission: { menuKey: "fleet", pageKey: "services", subKey: "service-orders", requireFull: true } },
  { path: "/appointments", element: Appointments, title: "Agendamentos", hideTitle: true, requireTenant: true, permission: { menuKey: "fleet", pageKey: "services", subKey: "appointments" } },
  { path: "/deliveries", element: Deliveries, title: "Entregas", requireTenant: true, permission: { menuKey: "fleet", pageKey: "deliveries" } },
  { path: "/tasks", element: Tasks, title: "Tasks", requireTenant: true },
  { path: "/tasks/new", element: TaskForm, title: "Nova task", requireTenant: true },
  { path: "/tasks/:id", element: TaskDetails, title: "Detalhes da task", requireTenant: true },
  { path: "/geofences", element: Geofences, title: "Cercas", requireTenant: true, permission: { menuKey: "fleet", pageKey: "geofences" } },
  { path: "/cercas", element: Geofences, title: "Cercas", requireTenant: true, permission: { menuKey: "fleet", pageKey: "geofences" } },
  { path: "/targets", element: Targets, title: "Alvos", requireTenant: true, permission: { menuKey: "fleet", pageKey: "targets" } },
  { path: "/alvos", element: Targets, title: "Alvos", requireTenant: true, permission: { menuKey: "fleet", pageKey: "targets" } },
  { path: "/itineraries", element: Itineraries, title: "Embarcar Itinerários", hideTitle: true, requireTenant: true, permission: { menuKey: "fleet", pageKey: "itineraries" } },
  { path: "/events", element: Events, title: "Eventos", hideTitle: true, requireTenant: true, permission: { menuKey: "primary", pageKey: "events" } },
  { path: "/videos", element: Videos, title: "Vídeos", requireTenant: true, permission: { menuKey: "telemetry", pageKey: "euro-view", subKey: "videos" } },
  { path: "/face", element: Face, title: "Reconhecimento facial", requireTenant: true, permission: { menuKey: "telemetry", pageKey: "euro-view", subKey: "face" } },
  { path: "/live", element: LivePage, title: "Streams", requireTenant: true, permission: { menuKey: "telemetry", pageKey: "euro-view", subKey: "live" } },
  { path: "/ranking", element: Ranking, title: "Ranking", requireTenant: true, permission: { menuKey: "admin", pageKey: "analytics", subKey: "ranking" } },
  { path: "/analytics/heatmap", element: AnalyticsHeatmap, title: "Analytics", requireTenant: true, permission: { menuKey: "admin", pageKey: "analytics", subKey: "analytics-heatmap" } },
  { path: "/reports/positions", element: ReportsPositions, title: "Relatório de posições", hideTitle: true, requireTenant: true, permission: { menuKey: "admin", pageKey: "reports", subKey: "reports-positions" } },
  { path: "/reports/analytic", element: ReportsAnalytic, title: "Relatório Analítico", hideTitle: true, requireTenant: true, permission: { menuKey: "admin", pageKey: "reports", subKey: "reports-analytic" } },
  { path: "/account", element: Account, title: "Conta", requireTenant: true },
  { path: "/settings", element: Settings, title: "Configurações", requireTenant: true },
  { path: "/notifications", element: Notifications, title: "Notificações", requireTenant: true },
  { path: "/clients", element: Clients, title: "Clientes", roles: ["admin", "manager"], permission: { menuKey: "admin", pageKey: "clients" } },
  { path: "/clients/:id", element: ClientDetailsPage, title: "Detalhes do cliente", roles: ["admin", "manager"], permission: { menuKey: "admin", pageKey: "clients" } },
  { path: "/mirrors/received", element: MirrorReceivers, title: "Espelhamento", requireTenant: true, permission: { menuKey: "admin", pageKey: "mirrors" } },
  { path: "/users", element: Users, title: "Usuários", roles: ["admin", "manager"], permission: { menuKey: "admin", pageKey: "users" } },
  { path: "/technicians", element: Technicians, title: "Técnico", hideTitle: true, roles: ["admin", "manager"], permission: { menuKey: "fleet", pageKey: "services", subKey: "technicians" } },
  { path: "/crm", element: Crm, title: "CRM", requireTenant: true, permission: { menuKey: "business", pageKey: "crm" } },
  { path: "/crm/:section", element: Crm, title: "CRM", requireTenant: true, permission: { menuKey: "business", pageKey: "crm" } },
  { path: "/finance", element: Finance, title: "Financeiro", requireTenant: true, permission: { menuKey: "business", pageKey: "finance" } },
  { path: "/driver-behavior", element: DriverBehavior, title: "Driver Behavior", requireTenant: true, permission: { menuKey: "telemetry", pageKey: "euro-can", subKey: "driver-behavior" } },
  { path: "/maintenance", element: Maintenance, title: "Manutenção", requireTenant: true, permission: { menuKey: "telemetry", pageKey: "euro-can", subKey: "maintenance" } },
  { path: "/fuel", element: Fuel, title: "Combustível", requireTenant: true, permission: { menuKey: "telemetry", pageKey: "euro-can", subKey: "fuel" } },
  { path: "/routing", element: Routing, title: "Roteirização", requireTenant: true },
  { path: "/compliance", element: Compliance, title: "Compliance", requireTenant: true, permission: { menuKey: "telemetry", pageKey: "euro-can", subKey: "compliance" } },
  { path: "/iot-sensors", element: IotSensors, title: "Sensores IoT", requireTenant: true },
  { path: "/video-telematics", element: VideoTelematics, title: "Vídeo Telemetria", requireTenant: true },
  ...(isEuroImportEnabled
    ? [{ path: "/admin/import-euro-xlsx", element: AdminImportXlsx, title: "Importar Base (XLSX)", roles: ["admin"], permission: { menuKey: "admin", pageKey: "import" } }]
    : []),
];

const withLayout = (element, options = {}) => (
  <Layout title={options.title} hideTitle={options.hideTitle}>
    {element}
  </Layout>
);

const applyGuards = (element, options = {}) => {
  let guarded = element;
  if (options.requireTenant) {
    guarded = <RequireTenant>{guarded}</RequireTenant>;
  }
  if (options.roles?.length) {
    guarded = <RequireRole roles={options.roles}>{guarded}</RequireRole>;
  }
  if (options.permission) {
    guarded = <RequirePermission permission={options.permission}>{guarded}</RequirePermission>;
  }
  return guarded;
};

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route element={<PrivateRoute />}>
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        {routeConfig.map(({ path, element: Component, title, hideTitle, roles, requireTenant, permission }) => {
          const content = <Component />;
          const guarded = applyGuards(withLayout(content, { title, hideTitle }), { roles, requireTenant, permission });
          return <Route key={path} path={path} element={guarded} />;
        })}
      </Route>
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}

export default routeConfig;
