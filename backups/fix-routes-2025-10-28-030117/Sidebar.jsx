import React, { useState } from 'react'
import { NavLink } from 'react-router-dom'
import {
  Home, Cpu, HardDrive, Boxes, MapPinned, Car, Video, Camera, Radio,
  FileText, Wrench, Package, Map, Cog, ChevronDown, BarChart3, Medal
} from 'lucide-react'

const linkClass = ({ isActive }) =>
  `flex items-center gap-2 px-3 py-2 rounded-xl transition
   ${isActive ? 'bg-[#1b2330] text-white' : 'text-[#AAB1C2] hover:text-white hover:bg-[#151B24]'}`

const plainClass = "w-full flex items-center justify-between px-3 py-2 rounded-xl text-[#AAB1C2] hover:text-white hover:bg-[#151B24]"

export function Sidebar(){
  const [openDisp, setOpenDisp] = useState(true)
  const [openAnalytics, setOpenAnalytics] = useState(true)

  return (
    <aside className="w-64 bg-[#0f141c] border-r border-[#1f2430] h-screen sticky top-0 overflow-y-auto">
      <nav className="p-3 space-y-3 pb-24">

        {/* Home */}
        <NavLink to="/routes" className={linkClass}><Home size={18}/> Home</NavLink>

        {/* Monitoramento & Trajetos */}
        <NavLink to="/routes" className={linkClass}><MapPinned size={18}/> Monitoramento</NavLink>
        <NavLink to="/routes" className={linkClass}><MapPinned size={18}/> Trajetos</NavLink>

        {/* Dispositivos (grupo) */}
        <button type="button" className={plainClass} onClick={()=>setOpenDisp(v=>!v)} aria-expanded={openDisp}>
          <span className="flex items-center gap-2"><Cpu size={18}/> Dispositivos</span>
          <ChevronDown size={16} className={`transition ${openDisp ? 'rotate-180' : ''}`} />
        </button>
        {openDisp && (
          <div className="ml-4 space-y-2">
            <NavLink to="/devices" className={linkClass}><Cpu size={18}/> Equipamento</NavLink>
            <NavLink to="/devices/chips" className={linkClass}><HardDrive size={18}/> Chip</NavLink>
            <NavLink to="/devices/products" className={linkClass}><Boxes size={18}/> Produto</NavLink>
            <NavLink to="/devices/stock" className={linkClass}><MapPinned size={18}/> Estoque</NavLink>
          </div>
        )}

        {/* Euro View */}
        <div className="mt-3 text-xs uppercase tracking-wide px-2 text-[#7f8a9f]">Euro View</div>
        <NavLink to="/events" className={linkClass}><Video size={18}/> Eventos</NavLink>
        <NavLink to="/videos" className={linkClass}><Camera size={18}/> Vídeos</NavLink>
        <NavLink to="/face" className={linkClass}><Camera size={18}/> Reconhecimento Facial</NavLink>
        <NavLink to="/live" className={linkClass}><Radio size={18}/> Live</NavLink>

        {/* Frotas */}
        <div className="mt-3 text-xs uppercase tracking-wide px-2 text-[#7f8a9f]">Frotas</div>
        <NavLink to="/vehicles" className={linkClass}><Car size={18}/> Veículos</NavLink>
        <NavLink to="/documents" className={linkClass}><FileText size={18}/> Documentos</NavLink>
        <NavLink to="/services" className={linkClass}><Wrench size={18}/> Serviços</NavLink>
        <NavLink to="/deliveries" className={linkClass}><Package size={18}/> Entregas</NavLink>
        <NavLink to="/geofences" className={linkClass}><Map size={18}/> Cercas</NavLink>

        {/* Analytics (submenu) */}
        <button type="button" className={plainClass} onClick={()=>setOpenAnalytics(v=>!v)} aria-expanded={openAnalytics}>
          <span className="flex items-center gap-2"><BarChart3 size={18}/> Analytics</span>
          <ChevronDown size={16} className={`transition ${openAnalytics ? 'rotate-180' : ''}`} />
        </button>
        {openAnalytics && (
          <div className="ml-4 space-y-2">
            <NavLink to="/reports" className={linkClass}><BarChart3 size={18}/> Relatórios</NavLink>
            <NavLink to="/ranking" className={linkClass}><Medal size={18}/> Ranking</NavLink>
          </div>
        )}

        {/* Admin */}
        <div className="mt-3 text-xs uppercase tracking-wide px-2 text-[#7f8a9f]">Admin</div>
        <NavLink to="/settings" className={linkClass}><Cog size={18}/> Configurações</NavLink>
      </nav>
    </aside>
  )
}
export default Sidebar
