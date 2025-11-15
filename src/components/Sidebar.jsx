import React, { useState } from "react";
import { NavLink } from "react-router-dom";
import {
  BarChart3,
  Bell,
  Boxes,
  Camera,
  Car,
  Cpu,
  DownloadCloud,
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

const ACCENT_FALLBACK = "#39bdf8";

function toRgba(color, alpha = 1) {
  if (!color || typeof color !== "string" || !color.startsWith("#")) {
    return `rgba(57, 189, 248, ${alpha})`;
  }
  const hex = color.replace("#", "").trim();
  const normalized = hex.length === 3 ? hex.split("").map((char) => `${char}${char}`).join("") : hex.padEnd(6, "0");
  const int = parseInt(normalized.slice(0, 6), 16);
  const r = (int >> 16) & 255;
  const g = (int >> 8) & 255;
  const b = int & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

const linkClass = (collapsed) => ({ isActive }) =>
  `flex items-center gap-2 px-3 py-2 rounded-xl transition ${
    isActive ? "text-white font-semibold" : "text-white/60 hover:text-white"
  } ${collapsed ? "justify-center" : ""}`;

const linkStyle = (accentColor) => ({ isActive }) =>
  isActive
    ? {
        backgroundColor: toRgba(accentColor, 0.18),
        boxShadow: `0 0 0 1px ${toRgba(accentColor, 0.4)}`,
      }
    : undefined;

const sectionTitle = (collapsed, text) =>
  collapsed ? null : (
    <div className="mt-3 px-2 text-xs uppercase tracking-wide text-white/50">{text}</div>
  );

export default function Sidebar() {
  const collapsed = useUI((state) => state.sidebarCollapsed);
  const toggleCollapsed = useUI((state) => state.toggleSidebarCollapsed);
  const [openDisp, setOpenDisp] = useState(true);
  const [openAnalytics, setOpenAnalytics] = useState(false);
  const [openProfile, setOpenProfile] = useState(false);

  const { tenant, role } = useTenant();
  const accentColor = tenant?.brandColor || ACCENT_FALLBACK;
  const navLinkClass = linkClass(collapsed);
  const nestedLinkClass = linkClass(false);
  const compactLinkClass = linkClass(true);
  const activeStyle = linkStyle(accentColor);
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
            className="p-1 text-white/60 hover:text-white"
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
                className="p-1 text-white/60 hover:text-white"
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

        <NavLink to="/home" className={navLinkClass} style={activeStyle} title="Home">
          <Home size={18} />
          <span className={collapsed ? "sr-only" : ""}>Home</span>
        </NavLink>

        <NavLink to="/monitoring" className={navLinkClass} style={activeStyle} title="Monitoramento">
          <MapPinned size={18} />
          <span className={collapsed ? "sr-only" : ""}>Monitoramento</span>
        </NavLink>
        <NavLink to="/trips" className={navLinkClass} style={activeStyle} title="Trajetos">
          <MapPinned size={18} />
          <span className={collapsed ? "sr-only" : ""}>Trajetos</span>
        </NavLink>

        {!collapsed && (
          <button
            type="button"
            className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-white/60 hover:bg-[#151B24] hover:text-white"
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
            <NavLink to="/devices" className={compactLinkClass} style={activeStyle} title="Equipamentos">
              <Cpu size={18} />
              <span className="sr-only">Equipamentos</span>
            </NavLink>
            <NavLink to="/commands" className={compactLinkClass} style={activeStyle} title="Comandos">
              <Terminal size={18} />
              <span className="sr-only">Comandos</span>
            </NavLink>
          </div>
        ) : (
          openDisp && (
            <div className="ml-3 space-y-2 text-sm">
              <NavLink to="/devices" className={nestedLinkClass} style={activeStyle} title="Equipamentos">
                <Cpu size={18} />
                <span>Equipamentos</span>
              </NavLink>
              <NavLink to="/devices/chips" className={nestedLinkClass} style={activeStyle} title="Chips">
                <HardDrive size={18} />
                <span>Chips</span>
              </NavLink>
              <NavLink
                to="/devices/products"
                className={nestedLinkClass}
                style={activeStyle}
                title="Modelos"
              >
                <Boxes size={18} />
                <span>Produtos</span>
              </NavLink>
              <NavLink to="/devices/import" className={nestedLinkClass} style={activeStyle} title="Importação">
                <DownloadCloud size={18} />
                <span>Importar</span>
              </NavLink>
              <NavLink to="/commands" className={nestedLinkClass} style={activeStyle} title="Comandos">
                <Terminal size={18} />
                <span>Comandos</span>
              </NavLink>
              <NavLink to="/devices/stock" className={nestedLinkClass} style={activeStyle} title="Estoque">
                <Map size={18} />
                <span>Estoque</span>
              </NavLink>
            </div>
          )
        )}

        {sectionTitle(collapsed, "Euro View")}
        <NavLink to="/events" className={navLinkClass} style={activeStyle} title="Eventos">
          <Video size={18} />
          <span className={collapsed ? "sr-only" : ""}>Eventos</span>
        </NavLink>
        <NavLink to="/videos" className={navLinkClass} style={activeStyle} title="Vídeos">
          <Camera size={18} />
          <span className={collapsed ? "sr-only" : ""}>Vídeos</span>
        </NavLink>
        <NavLink to="/face" className={navLinkClass} style={activeStyle} title="Reconhecimento facial">
          <Camera size={18} />
          <span className={collapsed ? "sr-only" : ""}>Reconhecimento Facial</span>
        </NavLink>
        <NavLink to="/live" className={navLinkClass} style={activeStyle} title="Live">
          <Radio size={18} />
          <span className={collapsed ? "sr-only" : ""}>Live</span>
        </NavLink>

        {sectionTitle(collapsed, "Frotas")}
        <NavLink to="/vehicles" className={navLinkClass} style={activeStyle} title="Veículos">
          <Car size={18} />
          <span className={collapsed ? "sr-only" : ""}>Veículos</span>
        </NavLink>
        <NavLink to="/groups" className={navLinkClass} style={activeStyle} title="Grupos">
          <Layers size={18} />
          <span className={collapsed ? "sr-only" : ""}>Grupos</span>
        </NavLink>
        <NavLink to="/drivers" className={navLinkClass} style={activeStyle} title="Motoristas">
          <UserCog size={18} />
          <span className={collapsed ? "sr-only" : ""}>Motoristas</span>
        </NavLink>
        <NavLink to="/documents" className={navLinkClass} style={activeStyle} title="Documentos">
          <FileText size={18} />
          <span className={collapsed ? "sr-only" : ""}>Documentos</span>
        </NavLink>
        <NavLink to="/services" className={navLinkClass} style={activeStyle} title="Serviços">
          <Wrench size={18} />
          <span className={collapsed ? "sr-only" : ""}>Serviços</span>
        </NavLink>
        <NavLink to="/deliveries" className={navLinkClass} style={activeStyle} title="Entregas">
          <Package size={18} />
          <span className={collapsed ? "sr-only" : ""}>Entregas</span>
        </NavLink>

        {(isAdmin || canManageUsers) && sectionTitle(collapsed, "Administração")}
        {isAdmin && (
          <NavLink to="/admin/clients" className={navLinkClass} style={activeStyle} title="Clientes">
            <Users size={18} />
            <span className={collapsed ? "sr-only" : ""}>Clientes</span>
          </NavLink>
        )}
        {canManageUsers && (
          <NavLink to="/admin/users" className={navLinkClass} style={activeStyle} title="Usuários">
            <User size={18} />
            <span className={collapsed ? "sr-only" : ""}>Usuários</span>
          </NavLink>
        )}
        <NavLink to="/geofences" className={navLinkClass} style={activeStyle} title="Cercas">
          <Map size={18} />
          <span className={collapsed ? "sr-only" : ""}>Cercas</span>
        </NavLink>

        {!collapsed && (
          <button
            type="button"
            className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-white/60 hover:bg-[#151B24] hover:text-white"
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
            <NavLink to="/ranking" className={compactLinkClass} style={activeStyle} title="Ranking">
              <Medal size={18} />
              <span className="sr-only">Ranking</span>
            </NavLink>
            <NavLink to="/reports" className={compactLinkClass} style={activeStyle} title="Relatórios">
              <BarChart3 size={18} />
              <span className="sr-only">Relatórios</span>
            </NavLink>
            <NavLink to="/reports/route" className={compactLinkClass} style={activeStyle} title="Rotas">
              <Route size={18} />
              <span className="sr-only">Rotas</span>
            </NavLink>
            <NavLink to="/reports/summary" className={compactLinkClass} style={activeStyle} title="Resumo">
              <FileBarChart size={18} />
              <span className="sr-only">Resumo</span>
            </NavLink>
            <NavLink to="/reports/stops" className={compactLinkClass} style={activeStyle} title="Paradas">
              <Navigation size={18} />
              <span className="sr-only">Paradas</span>
            </NavLink>
          </div>
        ) : (
          openAnalytics && (
            <div className="ml-3 space-y-2 text-sm">
              <NavLink to="/ranking" className={nestedLinkClass} style={activeStyle} title="Ranking">
                <Medal size={18} />
                <span>Ranking</span>
              </NavLink>
              <NavLink to="/reports" className={nestedLinkClass} style={activeStyle} title="Relatórios">
                <BarChart3 size={18} />
                <span>Relatórios</span>
              </NavLink>
              <NavLink to="/reports/route" className={nestedLinkClass} style={activeStyle} title="Rotas">
                <Route size={18} />
                <span>Rotas</span>
              </NavLink>
              <NavLink to="/reports/summary" className={nestedLinkClass} style={activeStyle} title="Resumo">
                <FileBarChart size={18} />
                <span>Resumo</span>
              </NavLink>
              <NavLink to="/reports/stops" className={nestedLinkClass} style={activeStyle} title="Paradas">
                <Navigation size={18} />
                <span>Paradas</span>
              </NavLink>
            </div>
          )
        )}

        {sectionTitle(collapsed, "Admin")}
        <NavLink to="/settings" className={navLinkClass} style={activeStyle} title="Configurações">
          <Settings size={18} />
          <span className={collapsed ? "sr-only" : ""}>Configurações</span>
        </NavLink>
        <NavLink to="/notifications" className={navLinkClass} style={activeStyle} title="Notificações">
          <Bell size={18} />
          <span className={collapsed ? "sr-only" : ""}>Notificações</span>
        </NavLink>
      </nav>
    </div>
  );
}
