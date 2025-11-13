
import { Routes, Route, Navigate } from "react-router-dom";
import Home from "./pages/Home";
import Monitoring from "./pages/Monitoring";
import Trips from "./pages/Trips";

import VehicleModalGlobal from './components/VehicleModalGlobal'
import React from 'react'
import RoutesPage from './pages/Routes'
import Monitor from './pages/Monitor'
import { Routes, Route, Navigate } from 'react-router-dom'
import Home from './pages/Home'
import Monitoring from './pages/Monitoring'
import Trips from './pages/Trips'
import Devices from './pages/Devices'
import Chips from './pages/Chips'
import Products from './pages/Products'
import Stock from './pages/Stock'
import Vehicles from './pages/Vehicles'
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
export default function App(){
  return (
        <Routes>
    <Route path="/home" element={<Home/>} />
    <Route path="/monitoring" element={<Monitoring/>} />
    <Route path="/trips" element={<Trips/>} />
    <Route path="/" element={<Navigate to="/home" replace />} />
    <Route path="/home" element=<Home/> />
  <Route path="/monitoring" element=<Monitoring/> />
  <Route path="/trips" element=<Trips/> />
  <Route path="/" element={<Navigate to="/home" replace />} />
</Routes>
  )
}

<VehicleModalGlobal />
