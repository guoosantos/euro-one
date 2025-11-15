import React, { useState } from "react";
import { NavLink } from "react-router-dom";
import {
  BarChart3,
  Bell,
  Boxes,
  Camera,
  Car,
  Cpu,
  FileBarChart,
  FileText,
  HardDrive,
  Home,
  Layers,
  Map,
  MapPinned,
  Navigation,
  Medal,
  Menu,
  Package,
  Radio,
  Route,
  Settings,
  Terminal,
  User,
  Users,
  UserCog,
  Video,
  Wrench,
} from "lucide-react";

import { useTenant } from "../lib/tenant-context";
import { useUI } from "../lib/store";

const linkClass = (collapsed) => ({ isActive }) =>
  `flex items-center gap-2 px-3 py-2 rounded-xl transition ${
    isActive
      ? "bg-[#1b2330] text-white"
      : "text-[#AAB1C2] hover:text-white hover:bg-[#151B24]"
  } ${collapsed ? "justify-center" : ""}`;

const sectionTitle = (collapsed, text) =>
  collapsed ? null : (
    <div className="mt-3 px-2 text-xs uppercase tracking-wide text-[#7f8a9f]">{text}</div>
  );

export default function Sidebar() {
  const collapsed = useUI((state) => state.sidebarCollapsed);
  const toggleCollapsed = useUI((state) => state.toggleSidebarCollapsed);
  const [openDisp, setOpenDisp] = useState(true);
  const [openAnalytics, setOpenAnalytics] = useState(false);
  const [openProfile, setOpenProfile] = useState(false);

  const { tenant, role } = useTenant();
  const isAdmin = role === "admin";
  const canManageUsers = role === "admin" || role === "manager";

  return (
    <div className="h-full bg-[#0f141c]">
      <nav className="flex h-full flex-col gap-3 p-3">
        <div
          className="flex items-center justify-between rounded-xl border border-[#1f2430] bg-[#0b1220] px-3 py-2"
          style={{ borderColor: tenant?.brandColor ? `${tenant.brandColor}33` : undefined }}
        >
          <span className={`text-white font-semibold ${collapsed ? "hidden" : ""}`}>
            {tenant?.name ?? "Euro One"}
          </span>
          <button
            type="button"
            aria-label="Alternar menu"
            className="p-1 text-[#AAB1C2] hover:text-white"
            onClick={toggleCollapsed}
          >
            <Menu size={18} />
          </button>
        </div>

        <div className="rounded-xl border border-[#1f2430] bg-[#111827] p-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div
                className="grid h-10 w-10 place-items-center rounded-full"
                style={{
                  backgroundColor: tenant?.brandColor ? `${tenant.brandColor}1a` : "#1f2937",
                  color: tenant?.brandColor ?? "#f8fafc",
                }}
              >
                <span className="text-sm font-semibold">
                  {(tenant?.name || "Euro One").slice(0, 2).toUpperCase()}
                </span>
              </div>
              {!collapsed && (
                <div>
                  <div className="text-sm font-medium text-white">{tenant?.segment ?? "Operação"}</div>
                  <div className="-mt-0.5 text-xs text-[#9AA3B2]">Clientes premium</div>
                </div>
              )}
            </div>
            {!collapsed && (
              <button
                type="button"
                onClick={() => setOpenProfile((value) => !value)}
                className="p-1 text-[#AAB1C2] hover:text-white"
                aria-label="Alternar conta"
              >
                {openProfile ? "−" : "+"}
              </button>
            )}
          </div>

          {!collapsed && openProfile && (
            <div className="mt-3 space-y-2 text-sm">
              <NavLink to="/account" className={linkClass(false)}>
                <User size={18} />
                <span>Perfil</span>
              </NavLink>
              <NavLink to="/settings" className={linkClass(false)}>
                <Settings size={18} />
                <span>Configurações</span>
              </NavLink>
            </div>
          )}
        </div>

        <NavLink to="/home" className={linkClass(collapsed)}>
          <Home size={18} />
          <span className={collapsed ? "sr-only" : ""}>Home</span>
        </NavLink>

        <NavLink to="/monitoring" className={linkClass(collapsed)}>
          <MapPinned size={18} />
          <span className={collapsed ? "sr-only" : ""}>Monitoramento</span>
        </NavLink>
        <NavLink to="/trips" className={linkClass(collapsed)}>
          <MapPinned size={18} />
          <span className={collapsed ? "sr-only" : ""}>Trajetos</span>
        </NavLink>

        {!collapsed && (
          <button
            type="button"
            className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-[#AAB1C2] hover:bg-[#151B24] hover:text-white"
            onClick={() => setOpenDisp((value) => !value)}
            aria-expanded={openDisp}
          >
            <span className="flex items-center gap-2">
              <Cpu size={18} /> Dispositivos
            </span>
            <span className="text-xs">{openDisp ? "−" : "+"}</span>
          </button>
        )}
        {collapsed ? (
          <div className="flex flex-col gap-2">
            <NavLink to="/devices" className={linkClass(true)}>
              <Cpu size={18} />
              <span className="sr-only">Dispositivos</span>
            </NavLink>
            <NavLink to="/commands" className={linkClass(true)}>
              <Terminal size={18} />
              <span className="sr-only">Comandos</span>
            </NavLink>
          </div>
        ) : (
          openDisp && (
            <div className="ml-3 space-y-2 text-sm">
              <NavLink to="/devices" className={linkClass(false)}>
                <Cpu size={18} />
                <span>Equipamentos</span>
              </NavLink>
              <NavLink to="/devices/chips" className={linkClass(false)}>
                <HardDrive size={18} />
                <span>Chips</span>
              </NavLink>
              <NavLink to="/devices/products" className={linkClass(false)}>
                <Boxes size={18} />
                <span>Produtos</span>
              </NavLink>
              <NavLink to="/commands" className={linkClass(false)}>
                <Terminal size={18} />
                <span>Comandos</span>
              </NavLink>
              <NavLink to="/devices/stock" className={linkClass(false)}>
                <Map size={18} />
                <span>Estoque</span>
              </NavLink>
            </div>
          )
        )}

        {sectionTitle(collapsed, "Euro View")}
        <NavLink to="/events" className={linkClass(collapsed)}>
          <Video size={18} />
          <span className={collapsed ? "sr-only" : ""}>Eventos</span>
        </NavLink>
        <NavLink to="/videos" className={linkClass(collapsed)}>
          <Camera size={18} />
          <span className={collapsed ? "sr-only" : ""}>Vídeos</span>
        </NavLink>
        <NavLink to="/face" className={linkClass(collapsed)}>
          <Camera size={18} />
          <span className={collapsed ? "sr-only" : ""}>Reconhecimento Facial</span>
        </NavLink>
        <NavLink to="/live" className={linkClass(collapsed)}>
          <Radio size={18} />
          <span className={collapsed ? "sr-only" : ""}>Live</span>
        </NavLink>

        {sectionTitle(collapsed, "Frotas")}
        <NavLink to="/vehicles" className={linkClass(collapsed)}>
          <Car size={18} />
          <span className={collapsed ? "sr-only" : ""}>Veículos</span>
        </NavLink>
        <NavLink to="/groups" className={linkClass(collapsed)}>
          <Layers size={18} />
          <span className={collapsed ? "sr-only" : ""}>Grupos</span>
        </NavLink>
        <NavLink to="/drivers" className={linkClass(collapsed)}>
          <UserCog size={18} />
          <span className={collapsed ? "sr-only" : ""}>Motoristas</span>
        </NavLink>
        <NavLink to="/documents" className={linkClass(collapsed)}>
          <FileText size={18} />
          <span className={collapsed ? "sr-only" : ""}>Documentos</span>
        </NavLink>
        <NavLink to="/services" className={linkClass(collapsed)}>
          <Wrench size={18} />
          <span className={collapsed ? "sr-only" : ""}>Serviços</span>
        </NavLink>
        <NavLink to="/deliveries" className={linkClass(collapsed)}>
          <Package size={18} />
          <span className={collapsed ? "sr-only" : ""}>Entregas</span>
        </NavLink>

        {(isAdmin || canManageUsers) && sectionTitle(collapsed, "Administração")}
        {isAdmin && (
          <NavLink to="/admin/clients" className={linkClass(collapsed)}>
            <Users size={18} />
            <span className={collapsed ? "sr-only" : ""}>Clientes</span>
          </NavLink>
        )}
        {canManageUsers && (
          <NavLink to="/admin/users" className={linkClass(collapsed)}>
            <User size={18} />
            <span className={collapsed ? "sr-only" : ""}>Usuários</span>
          </NavLink>
        )}
        <NavLink to="/geofences" className={linkClass(collapsed)}>
          <Map size={18} />
          <span className={collapsed ? "sr-only" : ""}>Cercas</span>
        </NavLink>

        {!collapsed && (
          <button
            type="button"
            className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-[#AAB1C2] hover:bg-[#151B24] hover:text-white"
            onClick={() => setOpenAnalytics((value) => !value)}
            aria-expanded={openAnalytics}
          >
            <span className="flex items-center gap-2">
              <BarChart3 size={18} /> Analytics
            </span>
            <span className="text-xs">{openAnalytics ? "−" : "+"}</span>
          </button>
        )}
        {collapsed ? (
          <div className="flex flex-col gap-2">
            <NavLink to="/ranking" className={linkClass(true)}>
              <Medal size={18} />
              <span className="sr-only">Ranking</span>
            </NavLink>
            <NavLink to="/reports" className={linkClass(true)}>
              <BarChart3 size={18} />
              <span className="sr-only">Relatórios</span>
            </NavLink>
            <NavLink to="/reports/route" className={linkClass(true)}>
              <Route size={18} />
              <span className="sr-only">Rotas</span>
            </NavLink>
            <NavLink to="/reports/summary" className={linkClass(true)}>
              <FileBarChart size={18} />
              <span className="sr-only">Resumo</span>
            </NavLink>
            <NavLink to="/reports/stops" className={linkClass(true)}>
              <Navigation size={18} />
              <span className="sr-only">Paradas</span>
            </NavLink>
          </div>
        ) : (
          openAnalytics && (
            <div className="ml-3 space-y-2 text-sm">
              <NavLink to="/ranking" className={linkClass(false)}>
                <Medal size={18} />
                <span>Ranking</span>
              </NavLink>
              <NavLink to="/reports" className={linkClass(false)}>
                <BarChart3 size={18} />
                <span>Relatórios</span>
              </NavLink>
              <NavLink to="/reports/route" className={linkClass(false)}>
                <Route size={18} />
                <span>Rotas</span>
              </NavLink>
              <NavLink to="/reports/summary" className={linkClass(false)}>
                <FileBarChart size={18} />
                <span>Resumo</span>
              </NavLink>
              <NavLink to="/reports/stops" className={linkClass(false)}>
                <Navigation size={18} />
                <span>Paradas</span>
              </NavLink>
            </div>
          )
        )}

        {sectionTitle(collapsed, "Admin")}
        <NavLink to="/settings" className={linkClass(collapsed)}>
          <Settings size={18} />
          <span className={collapsed ? "sr-only" : ""}>Configurações</span>
        </NavLink>
        <NavLink to="/notifications" className={linkClass(collapsed)}>
          <Bell size={18} />
          <span className={collapsed ? "sr-only" : ""}>Notificações</span>
        </NavLink>
      </nav>
    </div>
  );
}
