import React, { useState } from 'react'
import { NavLink } from 'react-router-dom'
import { Home, Cpu, HardDrive, Boxes, MapPinned, Car, Video, Camera, Cog, ChevronDown } from 'lucide-react'

const linkClass = ({ isActive }) =>
  `flex items-center gap-2 px-3 py-2 rounded-xl transition
   ${isActive ? 'bg-[#1b2330] text-white' : 'text-[#AAB1C2] hover:text-white hover:bg-[#151B24]'}`

const plainClass = "w-full flex items-center justify-between px-3 py-2 rounded-xl text-[#AAB1C2] hover:text-white hover:bg-[#151B24]"

export function Sidebar(){
  const [openDisp, setOpenDisp] = useState(true)

  return (
    <aside className="w-64 bg-[#0f141c] border-r border-[#1f2430] h-screen sticky top-0">
      <nav className="p-3 space-y-3">

        {/* Home */}
        <NavLink to="/home" className={linkClass}><Home size={18}/> Home</NavLink>

        {/* Monitoramento & Trajetos */}
        <NavLink to="/monitor" className={linkClass}><MapPinned size={18}/> Monitoramento</NavLink>
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

        {/* Frotas */}
        <div className="mt-3 text-xs uppercase tracking-wide px-2 text-[#7f8a9f]">Frotas</div>
        <NavLink to="/vehicles" className={linkClass}><Car size={18}/> Veículos</NavLink>

        {/* Euro View */}
        <div className="mt-3 text-xs uppercase tracking-wide px-2 text-[#7f8a9f]">Euro View</div>
        <NavLink to="/events" className={linkClass}><Video size={18}/> Eventos</NavLink>
        <NavLink to="/videos" className={linkClass}><Camera size={18}/> Vídeos</NavLink>
        <NavLink to="/face" className={linkClass}><Camera size={18}/> Reconhecimento Facial</NavLink>

        {/* Admin */}
        <div className="mt-3 text-xs uppercase tracking-wide px-2 text-[#7f8a9f]">Admin</div>
        <NavLink to="/settings" className={linkClass}><Cog size={18}/> Configurações</NavLink>
      </nav>
    </aside>
  )
}
export default Sidebar
