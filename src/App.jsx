import React from "react";
import { Navigate, Route, Routes } from "react-router-dom";

import Layout from "./layout/Layout";

import Home from "./pages/Home";
import Dashboard from "./pages/Dashboard";
import Monitoring from "./pages/Monitoring";
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
import Live from "./pages/Live";
import Ranking from "./pages/Ranking";
import Account from "./pages/Account";
import Settings from "./pages/Settings";
import Monitoramento from "./pages/Monitoramento";
import Reports from "./pages/Reports";
import ReportsRoute from "./pages/ReportsRoute";
import ReportsSummary from "./pages/ReportsSummary";
import ReportsStops from "./pages/ReportsStops";
import Groups from "./pages/Groups";
import Drivers from "./pages/Drivers";
import Notifications from "./pages/Notifications";
import Login from "./pages/Login";
import PrivateRoute from "./components/PrivateRoute";
import AdminClients from "./pages/AdminClients";
import ClientUsers from "./pages/ClientUsers";
import NotFound from "./pages/NotFound";
import { useTenant } from "./lib/tenant-context";

const withLayout = (Component, options = {}) => (
  <Layout title={options.title} hideTitle={options.hideTitle}>
    <Component />
  </Layout>
);

function NotFoundRoute() {
  const { isAuthenticated } = useTenant();

  if (isAuthenticated) {
    return withLayout(NotFound, { title: "Página não encontrada", hideTitle: true });
  }

  return <NotFound />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route element={<PrivateRoute />}>
        <Route path="/" element={<Navigate to="/dashboard" replace />} />

        <Route path="/dashboard" element={withLayout(Dashboard, { title: "Dashboard", hideTitle: true })} />
        <Route path="/home" element={withLayout(Home, { title: "Visão geral", hideTitle: true })} />
        <Route path="/monitoring" element={withLayout(Monitoring, { title: "Monitoramento em tempo real" })} />
        <Route path="/monitoramento" element={withLayout(Monitoramento, { title: "Mapa em tempo real", hideTitle: true })} />
        <Route path="/trips" element={withLayout(Trips, { title: "Replays e trajetos" })} />

        <Route path="/devices" element={withLayout(Devices, { title: "Equipamentos" })} />
        <Route path="/devices/chips" element={withLayout(Chips, { title: "Chips e SIM cards" })} />
        <Route path="/devices/products" element={withLayout(Products, { title: "Modelos de rastreadores" })} />
        <Route path="/devices/stock" element={withLayout(Stock, { title: "Estoque inteligente" })} />
        <Route
          path="/devices/import"
          element={withLayout(DeviceImport, { title: "Importar dispositivos do Traccar" })}
        />
        <Route path="/commands" element={withLayout(Commands, { title: "Comandos remotos" })} />

        <Route path="/vehicles" element={withLayout(Vehicles, { title: "Frota" })} />
        <Route path="/groups" element={withLayout(Groups, { title: "Grupos" })} />
        <Route path="/drivers" element={withLayout(Drivers, { title: "Motoristas" })} />
        <Route path="/documents" element={withLayout(Docs, { title: "Documentos da frota" })} />
        <Route path="/services" element={withLayout(Services, { title: "Serviços e manutenções" })} />
        <Route path="/deliveries" element={withLayout(Deliveries, { title: "Entregas e rotas" })} />
        <Route path="/geofences" element={withLayout(Fences, { title: "Cercas inteligentes" })} />

        <Route path="/events" element={withLayout(Events, { title: "Eventos Euro View" })} />
        <Route path="/videos" element={withLayout(Videos, { title: "Vídeos" })} />
        <Route path="/face" element={withLayout(Face, { title: "Reconhecimento facial" })} />
        <Route path="/live" element={withLayout(Live, { title: "Streams ao vivo" })} />

        <Route path="/ranking" element={withLayout(Ranking, { title: "Ranking de performance" })} />
        <Route path="/reports" element={withLayout(Reports, { title: "Analytics e relatórios" })} />
        <Route path="/reports/route" element={withLayout(ReportsRoute, { title: "Relatório de rota" })} />
        <Route path="/reports/summary" element={withLayout(ReportsSummary, { title: "Resumo de utilização" })} />
        <Route path="/reports/stops" element={withLayout(ReportsStops, { title: "Paradas" })} />
        <Route path="/account" element={withLayout(Account, { title: "Conta e clientes" })} />
        <Route path="/settings" element={withLayout(Settings, { title: "Configurações" })} />
        <Route path="/notifications" element={withLayout(Notifications, { title: "Notificações" })} />
        <Route path="/admin/clients" element={withLayout(AdminClients, { title: "Gestão de clientes" })} />
        <Route path="/admin/users" element={withLayout(ClientUsers, { title: "Gestão de usuários" })} />

      </Route>
      <Route path="*" element={<NotFoundRoute />} />
    </Routes>
  );
}
