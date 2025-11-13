import React, { useState } from 'react'
import { NavLink } from 'react-router-dom'
import {
  Home, Map, Route, Cpu, Car, Camera, Video, ScanFace, Radio,
  FileText, Wrench, Package, MapPinned, LineChart, Settings as Cog,
  ChevronDown
} from 'lucide-react'

function linkClass({isActive}){ return 'nav-link ' + (isActive?'active':'') }

function MenuGroup({icon:Icon, label, baseTo, baseLabel, children, defaultOpen=false}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="mt-1">
      <button className="nav-link w-full flex items-center justify-between" onClick={()=>setOpen(o=>!o)} aria-expanded={open}>
        <span className="flex items-center gap-3">{Icon && <Icon size={18}/>} {label}</span>
        <ChevronDown size={16} className={`transition-transform ${open?'rotate-180':''}`}/>
      </button>
      {/* clique no título vai para a rota base */}
      <div className="ml-3 mt-1">
        <NavLink to={baseTo} className={linkClass}>{baseLabel}</NavLink>
      </div>
      <div className="overflow-hidden transition-[max-height] duration-300" style={{maxHeight: open ? 500 : 0}}>
        <div className="ml-8 mt-2 space-y-1">{children}</div>
      </div>
    </div>
  )
}

export function Sidebar(){
  return (
    <aside className="hidden md:block w-64 shrink-0 border-r border-stroke bg-bg/60 backdrop-blur">
      <div className="p-4 font-semibold">EURO ONE</div>
      <nav className="px-2 space-y-1">
        <NavLink to="/home" className={linkClass}><Home size={18}/> Home</NavLink>

        <div className="mt-3 text-xs uppercase tracking-wide px-3 muted">Rastreamento</div>
        <NavLink to="/monitoring" className={linkClass}><Map size={18}/> Monitoramento</NavLink>
        <NavLink to="/trips" className={linkClass}><Route size={18}/> Trajetos</NavLink>

        <MenuGroup icon={Cpu} label="Dispositivos" baseTo="/devices" baseLabel="Equipamentos" defaultOpen={true}>
          <NavLink to="/devices" className={linkClass}>  <Cpu size={16}/> Equipamentos</NavLink>
          <NavLink to="/devices/chips" className={linkClass}>  <Cpu size={16}/> Chips</NavLink>
          <NavLink to="/devices/products" className={linkClass}>  <Cpu size={16}/> Produtos</NavLink>
          <NavLink to="/devices/stock" className={linkClass}>  <Cpu size={16}/> Estoque</NavLink>
        </MenuGroup>

        <MenuGroup icon={Car} label="Veículos" baseTo="/vehicles" baseLabel="Vinculado" defaultOpen={true}>
          <NavLink to="/vehicles" className={linkClass}>Veículos</NavLink>
        </MenuGroup>

        <div className="mt-3 text-xs uppercase tracking-wide px-3 muted">Euro View</div>
        <NavLink to="/view/events" className={linkClass}><Camera size={18}/> Eventos</NavLink>
        <NavLink to="/view/videos" className={linkClass}><Video size={18}/> Vídeos</NavLink>
        <NavLink to="/view/face" className={linkClass}><ScanFace size={18}/> Reconhecimento Facial</NavLink>
        <NavLink to="/view/live" className={linkClass}><Radio size={18}/> Live</NavLink>

        <div className="mt-3 text-xs uppercase tracking-wide px-3 muted">Frotas</div>
        <NavLink to="/docs" className={linkClass}><FileText size={18}/> Documentos</NavLink>
        <NavLink to="/services" className={linkClass}><Wrench size={18}/> Serviços</NavLink>
        <NavLink to="/deliveries" className={linkClass}><Package size={18}/> Entregas</NavLink>
        <NavLink to="/fences" className={linkClass}><MapPinned size={18}/> Cercas</NavLink>

        <div className="mt-3 text-xs uppercase tracking-wide px-3 muted">Analytics</div>
        <NavLink to="/ranking" className={linkClass}><LineChart size={18}/> Ranking</NavLink>

        <div className="mt-3 text-xs uppercase tracking-wide px-3 muted">Admin</div>
        <NavLink to="/settings" className={linkClass}><Cog size={18}/> Configurações</NavLink>
      </nav>
    </aside>
  )
}
