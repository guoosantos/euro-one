import React from 'react'
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
      <Route path="/" element={<Navigate to="/home" replace/>}/>
      <Route path="/home" element={<Home/>}/>
      <Route path="/monitoring" element={<Monitoring/>}/>
      <Route path="/trips" element={<Trips/>}/>
      [[[[<Route path="/devices" element={<Devices/>}/>]
      <Route path="/devices/products" element={<Products/>}/>
      <Route path="/devices/stock" element={<Stock/>}/> ]
      <Route path="/devices/products" element={<Products/>}/>
      <Route path="/devices/stock" element={<Stock/>}/> ]
      <Route path="/devices/products" element={<Products/>}/>
      <Route path="/devices/stock" element={<Stock/>}/> ]
      <Route path="/devices/products" element={<Products/>}/>
      <Route path="/devices/stock" element={<Stock/>}/> 
      <Route path="/devices/chips" element={<Chips/>}/>
      <Route path="/devices/products" element={<Products/>}/>
      <Route path="/devices/stock" element={<Stock/>}/>
      <Route path="/vehicles" element={<Vehicles/>}/>
      <Route path="/view/events" element={<Events/>}/>
      <Route path="/view/videos" element={<Videos/>}/>
      <Route path="/view/face" element={<Face/>}/>
      <Route path="/view/live" element={<Live/>}/>
      <Route path="/docs" element={<Docs/>}/>
      <Route path="/services" element={<Services/>}/>
      <Route path="/deliveries" element={<Deliveries/>}/>
      <Route path="/fences" element={<Fences/>}/>
      <Route path="/ranking" element={<Ranking/>}/>
      <Route path="/account" element={<Account/>}/>
      <Route path="/settings" element={<Settings/>}/>
      <Route path="*" element={<Navigate to="/home" replace/>}/>
    </Routes>
  )
}
