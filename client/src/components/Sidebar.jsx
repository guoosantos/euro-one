import React, { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { NavLink, useLocation } from "react-router-dom";
import {
  BarChart3,
  Bell,
  Banknote,
  ChevronDown,
  ChevronRight,
  Boxes,
  Camera,
  Car,
  Cpu,
  Flame,
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
  ShieldCheck,
  Settings,
  Terminal,
  Gauge,
  User,
  Users,
  UserCog,
  Video,
  Wrench,
  NotebookPen,
} from "lucide-react";

import { useTenant } from "../lib/tenant-context";
import { useUI } from "../lib/store";

// Discovery note (Epic A): sidebar navigation will be reorganized into
// collapsible section headers without changing the top fixed block.

const ACCENT_FALLBACK = "#39bdf8";
const SECTION_STATE_KEY = "sidebar.sections.state";
const DEFAULT_SECTIONS_OPEN = {
  negocios: true,
  principais: true,
  frotas: true,
  telemetria: true,
  administracao: true,
};

function toRgba(color, alpha = 1) {
  if (!color || typeof color !== "string" || !color.startsWith("#")) {
    return `rgba(57, 189, 248, ${alpha})`;
  }
  const hex = color.replace("#", "").trim();
  const normalized =
    hex.length === 3
      ? hex
          .split("")
          .map((char) => `${char}${char}`)
          .join("")
      : hex.padEnd(6, "0");
  const int = parseInt(normalized.slice(0, 6), 16);
  const r = (int >> 16) & 255;
  const g = (int >> 8) & 255;
  const b = int & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

const linkClass =
  (collapsed) =>
  ({ isActive }) =>
    `flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40 ${
      collapsed ? "justify-center" : "justify-start"
    } ${
      isActive
        ? "bg-white/10 text-white shadow-[0_0_0_1px_rgba(255,255,255,0.12)]"
        : "text-white/70 hover:bg-white/5 hover:text-white"
    }`;

const linkStyle =
  (accentColor) =>
  ({ isActive }) =>
    isActive
      ? {
          backgroundColor: toRgba(accentColor, 0.18),
          boxShadow: `0 0 0 1px ${toRgba(accentColor, 0.4)}`,
        }
      : undefined;

export default function Sidebar() {
  const collapsed = useUI((state) => state.sidebarCollapsed);
  const toggleCollapsed = useUI((state) => state.toggleSidebarCollapsed);
  const [openProfile, setOpenProfile] = useState(false);
  const [openSections, setOpenSections] = useState(DEFAULT_SECTIONS_OPEN);
  const [openSubmenus, setOpenSubmenus] = useState({
    dispositivos: true,
    "euro-view": true,
    servicos: true,
    relatorios: true,
  });
  const location = useLocation();

  const { tenant, role } = useTenant();
  const accentColor = tenant?.brandColor || ACCENT_FALLBACK;
  const navLinkClass = linkClass(collapsed);
  const nestedLinkClass = linkClass(false);
  const activeStyle = linkStyle(accentColor);
  const canManageUsers = role === "admin" || role === "manager";
  const labelVisibilityClass = collapsed ? "sr-only" : "flex-1 truncate";
  const navLabelProps = (label) => ({
    title: label,
    ...(collapsed ? { "aria-label": label } : {}),
  });

  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(SECTION_STATE_KEY) || "{}");
      setOpenSections({ ...DEFAULT_SECTIONS_OPEN, ...stored });
    } catch (_error) {
      setOpenSections(DEFAULT_SECTIONS_OPEN);
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(SECTION_STATE_KEY, JSON.stringify(openSections));
    } catch (_error) {
      // ignore persistence failures
    }
  }, [openSections]);

  const toggleSection = (key) => {
    setOpenSections((state) => ({ ...state, [key]: state[key] === false ? true : !state[key] }));
  };

  const toggleSubmenu = (key) => {
    setOpenSubmenus((state) => ({ ...state, [key]: state[key] === false ? true : !state[key] }));
  };

  const currentPath = location.pathname;
  const isLinkActive = (link) => Boolean(link?.to && currentPath.startsWith(link.to));

  const clientLink = { to: "/clients", label: "Clientes", icon: Users };
  const userLink = { to: "/users", label: "Usuários", icon: User };

  const primaryLinks = [
    { to: "/home", label: "Home", icon: Home },
    { to: "/monitoring", label: "Monitoramento", icon: MapPinned },
    { to: "/trips", label: "Trajetos", icon: MapPinned },
  ];

  const deviceLinks = [
    { to: "/devices", label: "Equipamentos", icon: Cpu },
    { to: "/devices/chips", label: "Chip", icon: HardDrive },
    { to: "/devices/products", label: "Produtos", icon: Boxes },
    { to: "/devices/import", label: "Importar", icon: DownloadCloud },
    { to: "/commands", label: "Comandos", icon: Terminal },
    { to: "/devices/stock", label: "Estoque Produtos", icon: Map },
  ];

  const analyticsLinks = [
    { to: "/analytics/heatmap", label: "Analytics", icon: BarChart3 },
    { to: "/ranking", label: "Ranking", icon: Medal },
  ];

  const reportLinks = [
    { to: "/reports/trips", label: "Viagens", icon: FileText },
    { to: "/reports/route", label: "Rotas", icon: Route },
    { to: "/reports/stops", label: "Paradas", icon: Navigation },
    { to: "/reports/summary", label: "Resumo", icon: FileBarChart },
  ];

  const businessLinks = [
    { to: "/dashboard", label: "Dashboard", icon: Home },
    { to: "/finance", label: "Financeiro", icon: Banknote },
    { to: "/crm", label: "CRM", icon: NotebookPen },
  ];

  const telematicsLinks = [
    { to: "/driver-behavior", label: "Driver Behavior", icon: Gauge },
    { to: "/maintenance", label: "Manutenção", icon: Wrench },
    { to: "/fuel", label: "Combustível", icon: Flame },
    { to: "/routing", label: "Roteirização", icon: Route },
    { to: "/compliance", label: "Compliance", icon: ShieldCheck },
    { to: "/iot-sensors", label: "Sensores IoT", icon: Cpu },
    { to: "/video-telematics", label: "Vídeo Telemetria", icon: Video },
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
    ...(canManageUsers ? [{ to: "/geofences", label: "Cercas", icon: Map }] : []),
    ...(canManageUsers ? [clientLink, userLink] : []),
  ];

  const utilityLinks = [
    { to: "/settings", label: "Configurações", icon: Settings },
    { to: "/notifications", label: "Notificações", icon: Bell },
  ];

  const menuSections = useMemo(
    () => [
      {
        key: "negocios",
        title: "NEGÓCIOS",
        items: businessLinks,
      },
      {
        key: "principais",
        title: "PRINCIPAIS",
        items: [
          ...primaryLinks,
          {
            key: "dispositivos",
            label: "Dispositivos",
            icon: Cpu,
            children: deviceLinks,
          },
          { to: "/events", label: "Eventos", icon: Video },
        ],
      },
      {
        key: "frotas",
        title: "FROTAS",
        items: [
          { to: "/vehicles", label: "Veículos", icon: Car },
          { to: "/groups", label: "Grupos", icon: Layers },
          { to: "/drivers", label: "Motoristas", icon: UserCog },
          { to: "/documents", label: "Documentos", icon: FileText },
          {
            key: "servicos",
            label: "Serviços",
            icon: Wrench,
            children: [
              { to: "/services", label: "Ordem de Serviço", icon: Wrench },
              { to: "/deliveries", label: "Entregas", icon: Package },
            ].filter(Boolean),
          },
        ],
      },
      {
        key: "telemetria",
        title: "TELEMETRIA",
        items: [
          {
            key: "euro-view",
            label: "Euro View",
            icon: Video,
            children: euroViewLinks,
          },
          ...telematicsLinks,
        ],
      },
      {
        key: "administracao",
        title: "ADMINISTRAÇÃO",
        items: [
          {
            key: "relatorios",
            label: "Relatórios",
            icon: FileText,
            children: reportLinks,
          },
          ...analyticsLinks,
          ...adminLinks,
          ...utilityLinks,
        ],
      },
    ],
    [adminLinks, analyticsLinks, businessLinks, deviceLinks, primaryLinks, reportLinks, telematicsLinks, utilityLinks],
  );

  const renderNavLink = (link) => (
    <NavLink
      key={link.to}
      to={link.to}
      className={navLinkClass}
      style={activeStyle}
      {...navLabelProps(link.label)}
    >
      <link.icon size={18} />
      <span className={labelVisibilityClass}>{link.label}</span>
    </NavLink>
  );

  const renderMenuItem = (item) => {
    if (!item) return null;
    if (item.children?.length) {
      const isOpen = openSubmenus[item.key] !== false;
      const hasActiveChild = item.children.some((child) => isLinkActive(child));

      return (
        <div key={item.key} className="space-y-1">
          <button
            type="button"
            className={`flex w-full items-center justify-between rounded-xl px-3 py-2 text-sm transition ${
              hasActiveChild
                ? "bg-white/10 text-white shadow-[0_0_0_1px_rgba(255,255,255,0.12)]"
                : "text-white/70 hover:bg-white/5 hover:text-white"
            }`}
            onClick={() => toggleSubmenu(item.key)}
            aria-expanded={isOpen}
          >
            <span className="flex items-center gap-2">
              <item.icon size={18} />
              <span className={labelVisibilityClass}>{item.label}</span>
            </span>
            <span className="text-white/60">{isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</span>
          </button>

          <AnimatePresence initial={false}>
            {isOpen && (
              <motion.div
                key={`${item.key}-children`}
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.18 }}
                className="ml-3 space-y-2 overflow-hidden text-sm"
              >
                {item.children.map(renderNavLink)}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      );
    }

    return renderNavLink(item);
  };

  const renderSection = (section) => {
    const isOpen = openSections[section.key] !== false;
    return (
      <div key={section.key} className="space-y-2">
        <button
          type="button"
          onClick={() => toggleSection(section.key)}
          aria-expanded={isOpen}
          aria-label={`Alternar seção ${section.title}`}
          className="flex w-full items-center justify-between rounded-lg px-2 text-[11px] font-semibold uppercase tracking-wide text-white/60 hover:text-white"
        >
          <span className={collapsed ? "sr-only" : ""}>{section.title}</span>
          <span aria-hidden className="text-white/60">
            {isOpen ? "▾" : "▸"}
          </span>
        </button>

        <AnimatePresence initial={false}>
          {isOpen && (
            <motion.div
              key={`${section.key}-items`}
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="space-y-2 overflow-hidden"
            >
              {section.items.map((item) => renderMenuItem(item))}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  };

  return (

    <motion.aside
      className="flex h-screen min-h-screen flex-col overflow-hidden bg-[#0f141c]"
      aria-label="Menu principal"
      data-collapsed={collapsed ? "true" : "false"}
      initial={false}
      animate={{
        width: collapsed ? 64 : 288, // 64px ≈ w-16, 288px ≈ w-72
        boxShadow: collapsed
          ? "0 12px 28px rgba(0,0,0,0.35)"
          : "0 18px 42px rgba(0,0,0,0.4)",
      }}
      transition={{ type: "spring", stiffness: 240, damping: 28 }}
    >

      <nav className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto p-3">
        <div
          className="flex items-center justify-between rounded-xl border border-[#1f2430] bg-[#0b1220] px-3 py-2"
          style={{
            borderColor: tenant?.brandColor
              ? `${tenant.brandColor}33`
              : undefined,
          }}
        >
          <span
            className={`text-white font-semibold ${
              collapsed ? "hidden" : "truncate"
            }`}
          >
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

        <div className="rounded-xl border border-[#1f2430] bg-[#111827] p-3 shadow-soft">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div
                className="grid h-10 w-10 flex-shrink-0 place-items-center rounded-full"
                style={{
                  backgroundColor: tenant?.brandColor
                    ? `${tenant.brandColor}1a`
                    : "#1f2937",
                  color: tenant?.brandColor ?? "#f8fafc",
                }}
              >
                <span className="text-sm font-semibold">
                  {(tenant?.name || "Euro One").slice(0, 2).toUpperCase()}
                </span>
              </div>
              {!collapsed && (
                <div className="min-w-0">
                  <div className="text-sm font-medium text-white">
                    {tenant?.segment ?? "Operação"}
                  </div>
                  <div className="-mt-0.5 text-xs text-[#9AA3B2]">
                    Clientes premium
                  </div>
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

          <AnimatePresence initial={false}>
            {!collapsed && openProfile && (
              <motion.div
                key="profile-links"
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="mt-3 space-y-2 text-sm overflow-hidden"
              >
                <NavLink
                  to="/account"
                  className={nestedLinkClass}
                  style={activeStyle}
                  title="Perfil"
                >
                  <User size={18} />
                  <span>Perfil</span>
                </NavLink>
                <NavLink
                  to="/settings"
                  className={nestedLinkClass}
                  style={activeStyle}
                  title="Configurações"
                >
                  <Settings size={18} />
                  <span>Configurações</span>
                </NavLink>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div className="sidebar-scroll flex-1 min-h-0 space-y-3 overflow-y-auto pr-1">
          {menuSections.map((section) => renderSection(section))}
        </div>
      </nav>
    </motion.aside>
  );
}
