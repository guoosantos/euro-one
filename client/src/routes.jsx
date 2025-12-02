import React from "react";
import { Navigate, Route, Routes } from "react-router-dom";

import Layout from "./layout/Layout";
import PrivateRoute from "./components/PrivateRoute";
import RequireRole from "./components/RequireRole.jsx";
import RequireTenant from "./components/RequireTenant.jsx";
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
import Vehicles from "./pages/Vehicles";
import Docs from "./pages/Docs";
import Services from "./pages/Services";
import Deliveries from "./pages/Deliveries";
import DeviceImport from "./pages/DeviceImport";
import Fences from "./pages/Fences";
import Events from "./pages/Events";
import Videos from "./pages/Videos";
import Face from "./pages/Face";
import Ranking from "./pages/Ranking";
import Reports from "./pages/Reports";
import ReportsRoute from "./pages/ReportsRoute";
import ReportsSummary from "./pages/ReportsSummary";
import ReportsStops from "./pages/ReportsStops";
import AnalyticsHeatmap from "./pages/Analytics/Heatmap";
import Account from "./pages/Account";
import Settings from "./pages/Settings";
import Notifications from "./pages/Notifications";
import Clients from "./pages/Clients";
import Users from "./pages/Users";
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

export const routeConfig = [
  { path: "/dashboard", element: Dashboard, title: "Dashboard", hideTitle: true, requireTenant: true },
  { path: "/home", element: Home, title: "Visão geral", hideTitle: true, requireTenant: true },
  { path: "/monitoring", element: Monitoring, title: "Monitoramento", requireTenant: true },
  { path: "/monitoramento", element: Monitoramento, title: "Mapa em tempo real", hideTitle: true, requireTenant: true },
  { path: "/trips", element: Trips, title: "Trajetos", requireTenant: true },
  { path: "/routes", element: RoutesPage, title: "Rotas", requireTenant: true },
  { path: "/devices", element: Devices, title: "Equipamentos", requireTenant: true },
  { path: "/devices/chips", element: Chips, title: "Chips", requireTenant: true },
  { path: "/devices/products", element: Products, title: "Produtos", requireTenant: true },
  { path: "/devices/stock", element: Stock, title: "Estoque", requireTenant: true },
  { path: "/devices/import", element: DeviceImport, title: "Importar dispositivos", requireTenant: true },
  { path: "/commands", element: Commands, title: "Comandos", requireTenant: true },
  { path: "/vehicles", element: Vehicles, title: "Frota", requireTenant: true },
  { path: "/groups", element: Groups, title: "Grupos", requireTenant: true },
  { path: "/drivers", element: Drivers, title: "Motoristas", requireTenant: true },
  { path: "/documents", element: Docs, title: "Documentos", requireTenant: true },
  { path: "/services", element: Services, title: "Serviços", requireTenant: true },
  { path: "/deliveries", element: Deliveries, title: "Entregas", requireTenant: true },
  { path: "/tasks", element: Tasks, title: "Tasks", requireTenant: true },
  { path: "/tasks/new", element: TaskForm, title: "Nova task", requireTenant: true },
  { path: "/tasks/:id", element: TaskDetails, title: "Detalhes da task", requireTenant: true },
  { path: "/geofences", element: Fences, title: "Cercas", requireTenant: true },
  { path: "/events", element: Events, title: "Eventos", requireTenant: true },
  { path: "/videos", element: Videos, title: "Vídeos", requireTenant: true },
  { path: "/face", element: Face, title: "Reconhecimento facial", requireTenant: true },
  { path: "/live", element: LivePage, title: "Streams", requireTenant: true },
  { path: "/ranking", element: Ranking, title: "Ranking", requireTenant: true },
  { path: "/analytics/heatmap", element: AnalyticsHeatmap, title: "Analytics", requireTenant: true },
  { path: "/reports", element: Reports, title: "Relatórios", requireTenant: true },
  { path: "/reports/trips", element: Reports, title: "Relatórios", requireTenant: true },
  { path: "/reports/route", element: ReportsRoute, title: "Rotas", requireTenant: true },
  { path: "/reports/summary", element: ReportsSummary, title: "Resumo", requireTenant: true },
  { path: "/reports/stops", element: ReportsStops, title: "Paradas", requireTenant: true },
  { path: "/account", element: Account, title: "Conta", requireTenant: true },
  { path: "/settings", element: Settings, title: "Configurações", requireTenant: true },
  { path: "/notifications", element: Notifications, title: "Notificações", requireTenant: true },
  { path: "/clients", element: Clients, title: "Clientes", roles: ["admin", "manager"] },
  { path: "/users", element: Users, title: "Usuários", roles: ["admin", "manager"] },
  { path: "/crm", element: Crm, title: "CRM", requireTenant: true },
  { path: "/crm/:section", element: Crm, title: "CRM", requireTenant: true },
  { path: "/finance", element: Finance, title: "Financeiro", requireTenant: true },
  { path: "/driver-behavior", element: DriverBehavior, title: "Driver Behavior", requireTenant: true },
  { path: "/maintenance", element: Maintenance, title: "Manutenção", requireTenant: true },
  { path: "/fuel", element: Fuel, title: "Combustível", requireTenant: true },
  { path: "/routing", element: Routing, title: "Roteirização", requireTenant: true },
  { path: "/compliance", element: Compliance, title: "Compliance", requireTenant: true },
  { path: "/iot-sensors", element: IotSensors, title: "Sensores IoT", requireTenant: true },
  { path: "/video-telematics", element: VideoTelematics, title: "Vídeo Telemetria", requireTenant: true },
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
  return guarded;
};

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route element={<PrivateRoute />}>
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        {routeConfig.map(({ path, element: Component, title, hideTitle, roles, requireTenant }) => {
          const content = <Component />;
          const guarded = applyGuards(withLayout(content, { title, hideTitle }), { roles, requireTenant });
          return <Route key={path} path={path} element={guarded} />;
        })}
      </Route>
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}

export default routeConfig;
