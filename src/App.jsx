import React from "react";
import { Navigate, Route, Routes } from "react-router-dom";

import Layout from "./layout/Layout";

import Home from "./pages/Home";
import Monitoring from "./pages/Monitoring";
import Trips from "./pages/Trips";
import Devices from "./pages/Devices";
import Chips from "./pages/Chips";
import Products from "./pages/Products";
import Stock from "./pages/Stock";
import Vehicles from "./pages/Vehicles";
import Docs from "./pages/Docs";
import Services from "./pages/Services";
import Deliveries from "./pages/Deliveries";
import Fences from "./pages/Fences";
import Events from "./pages/Events";
import Videos from "./pages/Videos";
import Face from "./pages/Face";
import Live from "./pages/Live";
import Ranking from "./pages/Ranking";
import Account from "./pages/Account";
import Settings from "./pages/Settings";
import Reports from "./pages/Reports";
import Monitoramento from "./pages/Monitoramento";
import Atlas from "./pages/Atlas";

const withLayout = (Component, options = {}) => (
  <Layout title={options.title} hideTitle={options.hideTitle} fullBleed={options.fullBleed}>
    <Component />
  </Layout>
);

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/home" replace />} />

      <Route path="/home" element={withLayout(Home, { title: "Visão geral", hideTitle: true })} />
      <Route path="/monitoring" element={withLayout(Monitoring, { title: "Monitoramento em tempo real" })} />
      <Route path="/monitoramento" element={withLayout(Monitoramento, { title: "Mapa tático", hideTitle: true, fullBleed: true })} />
      <Route path="/atlas" element={withLayout(Atlas, { title: "Mapa tático", hideTitle: true, fullBleed: true })} />
      <Route path="/trips" element={withLayout(Trips, { title: "Replays e trajetos" })} />

      <Route path="/devices" element={withLayout(Devices, { title: "Equipamentos" })} />
      <Route path="/devices/chips" element={withLayout(Chips, { title: "Chips e SIM cards" })} />
      <Route path="/devices/products" element={withLayout(Products, { title: "Modelos de rastreadores" })} />
      <Route path="/devices/stock" element={withLayout(Stock, { title: "Estoque inteligente" })} />

      <Route path="/vehicles" element={withLayout(Vehicles, { title: "Frota" })} />
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
      <Route path="/account" element={withLayout(Account, { title: "Conta e clientes" })} />
      <Route path="/settings" element={withLayout(Settings, { title: "Configurações" })} />

      <Route path="*" element={<Navigate to="/home" replace />} />
    </Routes>
  );
}
