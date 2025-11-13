import React, { useState } from 'react'
import { NavLink } from 'react-router-dom'
import {
  Home, Cpu, HardDrive, Boxes, MapPinned, Car, Video, Camera, Radio,
  FileText, Wrench, Package, Map, Cog, ChevronDown, ChevronRight,
  BarChart3, Medal, User, Settings, Menu
} from 'lucide-react'

const linkClass = (collapsed) => ({ isActive }) =>
  `flex items-center gap-2 px-3 py-2 rounded-xl transition
   ${isActive ? 'bg-[#1b2330] text-white' : 'text-[#AAB1C2] hover:text-white hover:bg-[#151B24]'}
   ${collapsed ? 'justify-center' : ''}`

const sectionTitle = (collapsed, text) =>
  collapsed
    ? '' // esconde rótulo da seção quando colapsado
    : <div className="mt-3 text-xs uppercase tracking-wide px-2 text-[#7f8a9f]">{text}</div>

export default function Sidebar(){
  const [collapsed, setCollapsed] = useState(false)
  const [openDisp, setOpenDisp] = useState(true)
  const [openAnalytics, setOpenAnalytics] = useState(true)
  const [openProfile, setOpenProfile] = useState(true)

  return (
    <aside className={`bg-[#0f141c] border-r border-[#1f2430] h-screen sticky top-0 ${collapsed ? 'w-16' : 'w-64'}`}>
      <nav className="p-3 space-y-3">

        {/* Header do menu: título + hambúrguer */}
        <div className="rounded-xl bg-[#0b1220] border border-[#1f2430] px-3 py-2 flex items-center justify-between">
          <span className={`text-white font-medium ${collapsed ? 'hidden' : ''}`}>Euro One</span>
          <button
            type="button"
            aria-label="Alternar menu"
            className="p-1 text-[#AAB1C2] hover:text-white"
            onClick={()=>setCollapsed(v=>!v)}
          >
            <Menu size={18}/>
          </button>
        </div>

        {/* Conta / Usuário */}
        <div className="p-3 rounded-xl bg-[#111827] border border-[#1f2430]">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center">
                <span className="text-sm">EU</span>
              </div>
              {!collapsed && (
                <div>
                  <div className="text-white font-medium">Euro User</div>
                  <div className="text-[#9AA3B2] -mt-0.5 text-sm">euro@tech</div>
                </div>
              )}
            </div>
            {!collapsed && (
              <button type="button" onClick={()=>setOpenProfile(v=>!v)} className="p-1" aria-label="Alternar conta">
                {openProfile ? <ChevronDown size={16}/> : <ChevronRight size={16}/>}
              </button>
            )}
          </div>

          {!collapsed && openProfile && (
            <div className="mt-3 space-y-2">
              <NavLink to="/account/profile" className={linkClass(false)}><User size={18}/><span>Perfil</span></NavLink>
              <NavLink to="/account/tenants" className={linkClass(false)}><Settings size={18}/><span>Contas</span></NavLink>
            </div>
          )}
        </div>

        {/* Home */}
        <NavLink to="/home" className={linkClass(collapsed)}>
          <Home size={18}/><span className={collapsed ? 'sr-only' : ''}>Home</span>
        </NavLink>

        {/* Monitoramento & Trajetos */}
        <NavLink to="/monitoring" className={linkClass(collapsed)}>
          <MapPinned size={18}/><span className={collapsed ? 'sr-only' : ''}>Monitoramento</span>
        </NavLink>
        <NavLink to="/trips" className={linkClass(collapsed)}>
          <MapPinned size={18}/><span className={collapsed ? 'sr-only' : ''}>Trajetos</span>
        </NavLink>

        {/* Dispositivos */}
        {!collapsed && (
          <button type="button" className="w-full flex items-center justify-between px-3 py-2 rounded-xl text-[#AAB1C2] hover:text-white hover:bg-[#151B24]"
                  onClick={()=>setOpenDisp(v=>!v)} aria-expanded={openDisp}>
            <span className="flex items-center gap-2"><Cpu size={18}/> Dispositivos</span>
            <ChevronDown size={16} className={`transition ${openDisp ? 'rotate-180' : ''}`} />
          </button>
        )}
        {collapsed
          ? <NavLink to="/devices" className={linkClass(true)}><Cpu size={18}/><span className="sr-only">Dispositivos</span></NavLink>
          : openDisp && (
            <div className="ml-4 space-y-2">
              <NavLink to="/devices" className={linkClass(false)}><Cpu size={18}/><span>Equipamento</span></NavLink>
              <NavLink to="/devices/chips" className={linkClass(false)}><HardDrive size={18}/><span>Chip</span></NavLink>
              <NavLink to="/devices/products" className={linkClass(false)}><Boxes size={18}/><span>Produto</span></NavLink>
              <NavLink to="/devices/stock" className={linkClass(false)}><MapPinned size={18}/><span>Estoque</span></NavLink>
            </div>
        )}

        {/* Euro View */}
        {sectionTitle(collapsed, 'Euro View')}
        <NavLink to="/events" className={linkClass(collapsed)}><Video size={18}/><span className={collapsed ? 'sr-only' : ''}>Eventos</span></NavLink>
        <NavLink to="/videos" className={linkClass(collapsed)}><Camera size={18}/><span className={collapsed ? 'sr-only' : ''}>Vídeos</span></NavLink>
        <NavLink to="/face" className={linkClass(collapsed)}><Camera size={18}/><span className={collapsed ? 'sr-only' : ''}>Reconhecimento Facial</span></NavLink>
        <NavLink to="/live" className={linkClass(collapsed)}><Radio size={18}/><span className={collapsed ? 'sr-only' : ''}>Live</span></NavLink>

        {/* Frotas */}
        {sectionTitle(collapsed, 'Frotas')}
        <NavLink to="/vehicles" className={linkClass(collapsed)}><Car size={18}/><span className={collapsed ? 'sr-only' : ''}>Veículos</span></NavLink>
        <NavLink to="/documents" className={linkClass(collapsed)}><FileText size={18}/><span className={collapsed ? 'sr-only' : ''}>Documentos</span></NavLink>
        <NavLink to="/services" className={linkClass(collapsed)}><Wrench size={18}/><span className={collapsed ? 'sr-only' : ''}>Serviços</span></NavLink>
        <NavLink to="/deliveries" className={linkClass(collapsed)}><Package size={18}/><span className={collapsed ? 'sr-only' : ''}>Entregas</span></NavLink>
        <NavLink to="/geofences" className={linkClass(collapsed)}><Map size={18}/><span className={collapsed ? 'sr-only' : ''}>Cercas</span></NavLink>

        {/* Analytics */}
        {!collapsed && (
          <button type="button" className="w-full flex items-center justify-between px-3 py-2 rounded-xl text-[#AAB1C2] hover:text-white hover:bg-[#151B24]"
                  onClick={()=>setOpenAnalytics(v=>!v)} aria-expanded={openAnalytics}>
            <span className="flex items-center gap-2"><BarChart3 size={18}/> Analytics</span>
            <ChevronDown size={16} className={`transition ${openAnalytics ? 'rotate-180' : ''}`} />
          </button>
        )}
        {collapsed
          ? <NavLink to="/reports" className={linkClass(true)}><BarChart3 size={18}/><span className="sr-only">Analytics</span></NavLink>
          : openAnalytics && (
            <div className="ml-4 space-y-2">
              <NavLink to="/reports" className={linkClass(false)}><BarChart3 size={18}/><span>Relatórios</span></NavLink>
              <NavLink to="/ranking" className={linkClass(false)}><Medal size={18}/><span>Ranking</span></NavLink>
            </div>
        )}

        {/* Admin */}
        {sectionTitle(collapsed, 'Admin')}
        <NavLink to="/settings" className={linkClass(collapsed)}><Cog size={18}/><span className={collapsed ? 'sr-only' : ''}>Configurações</span></NavLink>
      </nav>
    </aside>
  )
}
