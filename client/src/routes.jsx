import React from "react";
import { Navigate, Route, Routes } from "react-router-dom";

import Layout from "./layout/Layout";
import PrivateRoute from "./components/PrivateRoute";
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
import AdminClients from "./pages/AdminClients";
import ClientUsers from "./pages/ClientUsers";
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

export const routeConfig = [
  { path: "/dashboard", element: Dashboard, title: "Dashboard", hideTitle: true },
  { path: "/home", element: Home, title: "Visão geral", hideTitle: true },
  { path: "/monitoring", element: Monitoring, title: "Monitoramento" },
  { path: "/monitoramento", element: Monitoramento, title: "Mapa em tempo real", hideTitle: true },
  { path: "/trips", element: Trips, title: "Trajetos" },
  { path: "/routes", element: RoutesPage, title: "Rotas" },
  { path: "/devices", element: Devices, title: "Equipamentos" },
  { path: "/devices/chips", element: Chips, title: "Chips" },
  { path: "/devices/products", element: Products, title: "Produtos" },
  { path: "/devices/stock", element: Stock, title: "Estoque" },
  { path: "/devices/import", element: DeviceImport, title: "Importar dispositivos" },
  { path: "/commands", element: Commands, title: "Comandos" },
  { path: "/vehicles", element: Vehicles, title: "Frota" },
  { path: "/groups", element: Groups, title: "Grupos" },
  { path: "/drivers", element: Drivers, title: "Motoristas" },
  { path: "/documents", element: Docs, title: "Documentos" },
  { path: "/services", element: Services, title: "Serviços" },
  { path: "/deliveries", element: Deliveries, title: "Entregas" },
  { path: "/tasks", element: Tasks, title: "Tasks" },
  { path: "/tasks/new", element: TaskForm, title: "Nova task" },
  { path: "/tasks/:id", element: TaskDetails, title: "Detalhes da task" },
  { path: "/geofences", element: Fences, title: "Cercas" },
  { path: "/events", element: Events, title: "Eventos" },
  { path: "/videos", element: Videos, title: "Vídeos" },
  { path: "/face", element: Face, title: "Reconhecimento facial" },
  { path: "/live", element: LivePage, title: "Streams" },
  { path: "/ranking", element: Ranking, title: "Ranking" },
  { path: "/analytics/heatmap", element: AnalyticsHeatmap, title: "Analytics" },
  { path: "/reports", element: Reports, title: "Relatórios" },
  { path: "/reports/trips", element: Reports, title: "Relatórios" },
  { path: "/reports/route", element: ReportsRoute, title: "Rotas" },
  { path: "/reports/summary", element: ReportsSummary, title: "Resumo" },
  { path: "/reports/stops", element: ReportsStops, title: "Paradas" },
  { path: "/account", element: Account, title: "Conta" },
  { path: "/settings", element: Settings, title: "Configurações" },
  { path: "/notifications", element: Notifications, title: "Notificações" },
  { path: "/admin/clients", element: AdminClients, title: "Clientes" },
  { path: "/admin/users", element: ClientUsers, title: "Usuários" },
  { path: "/clients", element: Clients, title: "Clientes" },
  { path: "/users", element: Users, title: "Usuários" },
  { path: "/finance", element: Finance, title: "Financeiro" },
  { path: "/driver-behavior", element: DriverBehavior, title: "Driver Behavior" },
  { path: "/maintenance", element: Maintenance, title: "Manutenção" },
  { path: "/fuel", element: Fuel, title: "Combustível" },
  { path: "/routing", element: Routing, title: "Roteirização" },
  { path: "/compliance", element: Compliance, title: "Compliance" },
  { path: "/iot-sensors", element: IotSensors, title: "Sensores IoT" },
  { path: "/video-telematics", element: VideoTelematics, title: "Vídeo Telemetria" },
];

const withLayout = (Component, options = {}) => (
  <Layout title={options.title} hideTitle={options.hideTitle}>
    <Component />
  </Layout>
);

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route element={<PrivateRoute />}>
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        {routeConfig.map(({ path, element: Component, title, hideTitle }) => (
          <Route key={path} path={path} element={withLayout(Component, { title, hideTitle })} />
        ))}
      </Route>
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}

export default routeConfig;
