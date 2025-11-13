
import { Routes, Route, Navigate } from "react-router-dom";

import Home from './pages/Home';
import Monitoring from './pages/Monitoring';
import Trips from './pages/Trips';
import Devices from './pages/Devices';
import Chips from './pages/Chips';
import Products from './pages/Products';
import Stock from './pages/Stock';
import Vehicles from './pages/Vehicles';

import VehicleModalGlobal from './components/VehicleModalGlobal'
import React from 'react'
import Events from './pages/Events'
import Videos from './pages/Videos'
import Face from './pages/Face'
import Live from './pages/Live'
import Docs from './pages/Docs'
import Services from './pages/Services'
import Deliveries from './pages/Deliveries'
import Fences from './pages/Fences'
import Ranking from './pages/Ranking'
import Account from './pages/Account'
import Settings from './pages/Settings'
import Monitoramento from './pages/Monitoramento';
import LayoutLocal from "./components/LayoutLocal";
export default function App(){
  return (
        <AppErrorBoundary>
  <React.Suspense fallback={<div style={{padding:16}}>Carregando…</div>}>
    <Routes>
  <Route path="/vehicles" element={<Vehicles/>} />

  <Route path="/devices/chips"    element={<Chips/>} />
  <Route path="/devices/products" element={<Products/>} />
  <Route path="/devices/stock"    element={<Stock/>
} />

            <Route path="/devices/chips" element={<Chips/>} />
  <Route path="/devices/products" element={<Products/>} />
  <Route path="/devices/stock" element={<Stock/>} />
<Route path="/" element={<Navigate to="/home" replace/>} />
  <Route path="/home" element={<LayoutLocal title="Euro One"><Home/></LayoutLocal>} />
  <Route path="/monitoring" element={<Monitoring/>} />
  <Route path="/trips" element={<Trips/>} />
  <Route path="/devices" element={<Devices/>} />
<Route path="/" element={<Navigate to="/home" replace/>} />
  <Route path="/home" element={<LayoutLocal title="Euro One"><Home/></LayoutLocal>} />
  <Route path="/monitoring" element={<Monitoring/>} />
  <Route path="/trips" element={<Trips/>} />
<Route path="/" element={<Navigate to="/home" replace/>} />
  <Route path="/home" element={<LayoutLocal title="Euro One"><Home/></LayoutLocal>} />
  <Route path="/monitoring" element={<Monitoring/>} />
  <Route path="/trips" element={<Trips/>} />
<Route path="/home" element={<LayoutLocal title="Euro One"><Home/></LayoutLocal>} />
  <Route path="/monitoring" element={<Monitoring/>} />
  <Route path="/trips" element={<Trips/>} />
  <Route path="/" element={<Navigate to="/home" replace/>} />
  <Route path="/monitoring" element={<Monitoramento/>} />
  <Route path="/monitoramento" element={<Monitoramento/>} />
</Routes>
  </React.Suspense>
</AppErrorBoundary>
  )
}

<VehicleModalGlobal />


function AppErrorBoundary({ children }) {
  try { return children; } catch (e) {
    console.error(e);
    return <div style={{padding:16}}>Falha ao renderizar. Veja o console.</div>;
  }
}


<Routes>
</Routes>


function AppRoutes(){
  return (
    <Routes>
    </Routes>
  );
}


function _AppRoutesDup(){
  return (
    <Routes>
    </Routes>
  );
}
