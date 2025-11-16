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
  `flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40 ${
    collapsed ? "justify-center" : "justify-start"
  } ${
    isActive
      ? "bg-white/10 text-white shadow-[0_0_0_1px_rgba(255,255,255,0.12)]"
      : "text-white/70 hover:bg-white/5 hover:text-white"
  }`;

const linkStyle = (accentColor) => ({ isActive }) =>
  isActive
    ? {
        backgroundColor: toRgba(accentColor, 0.18),
        boxShadow: `0 0 0 1px ${toRgba(accentColor, 0.4)}`,
      }
    : undefined;

const sectionTitle = (collapsed, text) =>
  collapsed ? null : (
    <div className="mt-4 px-2 text-xs font-semibold uppercase tracking-wide text-white/50" aria-hidden="true">
      {text}
    </div>
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
  const labelVisibilityClass = collapsed ? "sr-only" : "flex-1 truncate";
  const navLabelProps = (label) => ({ title: label, ...(collapsed ? { "aria-label": label } : {}) });

  const primaryLinks = [
    { to: "/home", label: "Home", icon: Home },
    { to: "/monitoring", label: "Monitoramento", icon: MapPinned },
    { to: "/trips", label: "Trajetos", icon: MapPinned },
  ];

  const deviceLinks = [
    { to: "/devices", label: "Equipamentos", icon: Cpu },
    { to: "/devices/chips", label: "Chips", icon: HardDrive },
    { to: "/devices/products", label: "Produtos", icon: Boxes },
    { to: "/devices/import", label: "Importar", icon: DownloadCloud },
    { to: "/commands", label: "Comandos", icon: Terminal },
    { to: "/devices/stock", label: "Estoque", icon: Map },
  ];

  const analyticsLinks = [
    { to: "/ranking", label: "Ranking", icon: Medal },
    { to: "/reports", label: "Relatórios", icon: BarChart3 },
    { to: "/reports/route", label: "Rotas", icon: Route },
    { to: "/reports/summary", label: "Resumo", icon: FileBarChart },
    { to: "/reports/stops", label: "Paradas", icon: Navigation },
  ];

  const euroViewLinks = [
    { to: "/events", label: "Eventos", icon: Video },
    { to: "/videos", label: "Vídeos", icon: Camera },
    { to: "/face", label: "Reconhecimento Facial", icon: Camera },
    { to: "/live", label: "Live", icon: Radio },
  ];

  const fleetLinks = [
    { to: "/vehicles", label: "Veículos", icon: Car },
    { to: "/groups", label: "Grupos", icon: Layers },
    { to: "/drivers", label: "Motoristas", icon: UserCog },
    { to: "/documents", label: "Documentos", icon: FileText },
    { to: "/services", label: "Serviços", icon: Wrench },
    { to: "/deliveries", label: "Entregas", icon: Package },
  ];

  const adminLinks = [
    ...(isAdmin ? [{ to: "/admin/clients", label: "Clientes", icon: Users }] : []),
    ...(canManageUsers ? [{ to: "/admin/users", label: "Usuários", icon: User }] : []),
    { to: "/geofences", label: "Cercas", icon: Map },
  ];

  const utilityLinks = [
    { to: "/settings", label: "Configurações", icon: Settings },
    { to: "/notifications", label: "Notificações", icon: Bell },
  ];

  const quickDeviceLinks = [
    { to: "/devices", label: "Equipamentos", icon: Cpu },
    { to: "/commands", label: "Comandos", icon: Terminal },
  ];

  const renderNavLink = (link) => (
    <NavLink key={link.to} to={link.to} className={navLinkClass} style={activeStyle} {...navLabelProps(link.label)}>
      <link.icon size={18} />
      <span className={labelVisibilityClass}>{link.label}</span>
    </NavLink>
  );

  const renderNestedLink = (link) => (
    <NavLink key={link.to} to={link.to} className={nestedLinkClass} style={activeStyle} title={link.label}>
      <link.icon size={18} />
      <span>{link.label}</span>
    </NavLink>
  );

  const renderCompactLink = (link) => (
    <NavLink key={link.to} to={link.to} className={compactLinkClass} style={activeStyle} title={link.label}>
      <link.icon size={18} />
      <span className="sr-only">{link.label}</span>
    </NavLink>
  );

  return (
    <aside className="flex h-full flex-col overflow-hidden bg-[#0f141c]" aria-label="Menu principal">
      <nav className="flex h-full flex-col gap-3 overflow-y-auto p-3">
        <div
          className="flex items-center justify-between rounded-xl border border-[#1f2430] bg-[#0b1220] px-3 py-2"
          style={{ borderColor: tenant?.brandColor ? `${tenant.brandColor}33` : undefined }}
        >
          <span className={`text-white font-semibold ${collapsed ? "hidden" : "truncate"}`}>
            {tenant?.name ?? "Euro One"}
          </span>
          <button
            type="button"
            aria-label="Alternar menu"
            className="rounded-full p-1 text-white/60 transition hover:text-white"
            onClick={toggleCollapsed}
          >
            <Menu size={18} />
          </button>
        </div>

        <div className="rounded-xl border border-[#1f2430] bg-[#111827] p-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div
                className="grid h-10 w-10 flex-shrink-0 place-items-center rounded-full"
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
                <div className="min-w-0">
                  <div className="text-sm font-medium text-white">{tenant?.segment ?? "Operação"}</div>
                  <div className="-mt-0.5 text-xs text-[#9AA3B2]">Clientes premium</div>
                </div>
              )}
            </div>
            {!collapsed && (
              <button
                type="button"
                className="rounded-full border border-white/20 px-3 py-1 text-xs text-white/70 transition hover:border-white/40"
                onClick={() => setOpenProfile((value) => !value)}
                aria-expanded={openProfile}
              >
                {openProfile ? "Ocultar" : "Resumo"}
              </button>
            )}
          </div>

          {!collapsed && openProfile && (
            <div className="mt-3 space-y-2 text-sm">
              <NavLink to="/account" className={nestedLinkClass} style={activeStyle} title="Perfil">
                <User size={18} />
                <span>Perfil</span>
              </NavLink>
              <NavLink to="/settings" className={nestedLinkClass} style={activeStyle} title="Configurações">
                <Settings size={18} />
                <span>Configurações</span>
              </NavLink>
            </div>
          )}
        </div>

        {primaryLinks.map(renderNavLink)}

        {!collapsed && (
          <button
            type="button"
            className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-sm text-white/70 transition hover:bg-white/5 hover:text-white"
            onClick={() => setOpenDisp((value) => !value)}
            aria-expanded={openDisp}
          >
            <span className="flex items-center gap-2">
              <Cpu size={18} />
              <span>Dispositivos</span>
            </span>
            <span className="text-xs">{openDisp ? "−" : "+"}</span>
          </button>
        )}
        {collapsed ? (
          <div className="flex flex-col gap-2">{quickDeviceLinks.map(renderCompactLink)}</div>
        ) : (
          openDisp && <div className="ml-3 space-y-2 text-sm">{deviceLinks.map(renderNestedLink)}</div>
        )}

        {sectionTitle(collapsed, "Euro View")}
        {euroViewLinks.map(renderNavLink)}

        {sectionTitle(collapsed, "Frotas")}
        {fleetLinks.map(renderNavLink)}

        {(isAdmin || canManageUsers) && sectionTitle(collapsed, "Administração")}
        {adminLinks.map(renderNavLink)}

        {!collapsed && (
          <button
            type="button"
            className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-sm text-white/70 transition hover:bg-white/5 hover:text-white"
            onClick={() => setOpenAnalytics((value) => !value)}
            aria-expanded={openAnalytics}
          >
            <span className="flex items-center gap-2">
              <BarChart3 size={18} />
              <span>Analytics</span>
            </span>
            <span className="text-xs">{openAnalytics ? "−" : "+"}</span>
          </button>
        )}
        {collapsed ? (
          <div className="flex flex-col gap-2">{analyticsLinks.map(renderCompactLink)}</div>
        ) : (
          openAnalytics && <div className="ml-3 space-y-2 text-sm">{analyticsLinks.map(renderNestedLink)}</div>
        )}

        {sectionTitle(collapsed, "Admin")}
        {utilityLinks.map(renderNavLink)}
      </nav>
    </aside>
  );
}
