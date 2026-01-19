import React, { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { NavLink, useLocation } from "react-router-dom";
import { ChevronDown, ChevronRight, Menu } from "lucide-react";

import { sidebarGroupIcons } from "../lib/sidebarGroupIcons";

import { useTenant } from "../lib/tenant-context";
import { usePermissions } from "../lib/permissions/permission-gate";
import { MENU_REGISTRY } from "../lib/permissions/registry";
import { useUI } from "../lib/store";

// Discovery note (Epic A): sidebar navigation will be reorganized into
// collapsible section headers without changing the top fixed block.

const ACCENT_FALLBACK = "#39bdf8";
const DEFAULT_SECTIONS_OPEN = {
  negocios: false,
  principais: false,
  frotas: false,
  telemetria: false,
  administracao: false,
};
const DEFAULT_SUBMENUS_OPEN = {
  dispositivos: false,
  documentos: false,
  servicos: false,
  "euro-view": false,
  "euro-can": false,
  relatorios: false,
  analises: false,
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
  const setSidebarCollapsed = useUI((state) => state.setSidebarCollapsed);
  const [openProfile, setOpenProfile] = useState(false);
  const [openSections, setOpenSections] = useState(() => ({
    ...DEFAULT_SECTIONS_OPEN,
  }));
  const [openSubmenus, setOpenSubmenus] = useState(() => ({
    ...DEFAULT_SUBMENUS_OPEN,
  }));
  const location = useLocation();

  const { tenant, role } = useTenant();
  const { getPermission } = usePermissions();
  const accentColor = tenant?.brandColor || ACCENT_FALLBACK;
  const navLinkClass = linkClass(collapsed);
  const nestedLinkClass = linkClass(false);
  const activeStyle = linkStyle(accentColor);
  const canManageUsers = role === "admin" || role === "manager";
  const isEuroImportEnabled = import.meta.env.VITE_FEATURE_EURO_XLSX_IMPORT === "true";
  const labelVisibilityClass = collapsed ? "hidden" : "flex-1 truncate";
  const linkIconSize = collapsed ? 22 : 18;
  const navLabelProps = (label) => ({
    title: label,
    ...(collapsed ? { "aria-label": label } : {}),
  });

  const filterMenuItem = useCallback(
    (item) => {
      if (!item) return null;
      if (item.children?.length) {
        const children = item.children
          .map((child) => filterMenuItem(child))
          .filter(Boolean);
        if (!children.length) return null;
        return { ...item, children };
      }
      if (item.isVisible && !item.isVisible({ canManageUsers, isEuroImportEnabled, role })) {
        return null;
      }
      if (!item.permission) {
        return item;
      }
      const permission = getPermission(item.permission);
      return permission.canShow ? item : null;
    },
    [canManageUsers, getPermission, isEuroImportEnabled, role],
  );

  useEffect(() => {
    setOpenSections({ ...DEFAULT_SECTIONS_OPEN });
    setOpenSubmenus({ ...DEFAULT_SUBMENUS_OPEN });
  }, []);

  const toggleSection = (key) => {
    setOpenSections((state) => ({ ...state, [key]: state[key] === false ? true : !state[key] }));
  };

  const toggleSubmenu = (key) => {
    setOpenSubmenus((state) => ({ ...state, [key]: state[key] === false ? true : !state[key] }));
  };

  const currentPath = location.pathname;
  const isLinkActive = (link) => Boolean(link?.to && currentPath.startsWith(link.to));

  const menuSections = useMemo(() => {
    const sections = MENU_REGISTRY.map((section) => ({
      ...section,
      items: section.items.map(filterMenuItem).filter(Boolean),
    }))
      .map((section) => (section.items.length ? section : null))
      .filter(Boolean);

    return sections;
  }, [filterMenuItem]);

  const renderNavLink = (link) => (
    <NavLink
      key={link.key ?? link.to}
      to={link.to}
      className={navLinkClass}
      style={activeStyle}
      {...navLabelProps(link.label)}
    >
      <link.icon size={linkIconSize} />
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
              <item.icon size={linkIconSize} />
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
    const Icon = sidebarGroupIcons[section.key];
    const showIconOnly = collapsed && Icon;
    const sectionIconSize = collapsed ? 20 : 16;

    const handleSectionClick = () => {
      if (collapsed) {
        setSidebarCollapsed(false);
        setOpenSections((state) => ({
          ...DEFAULT_SECTIONS_OPEN,
          [section.key]: state[section.key] !== false,
        }));
        return;
      }
      toggleSection(section.key);
    };

    return (
      <div key={section.key} className="space-y-2">
        <button
          type="button"
          onClick={handleSectionClick}
          aria-expanded={isOpen}
          aria-label={`Alternar seção ${section.title}`}
          title={collapsed ? section.title : undefined}
          className="flex w-full items-center justify-between rounded-lg px-2 text-[11px] font-semibold uppercase tracking-wide text-white/60 hover:text-white"
        >
          <span className="flex flex-1 items-center gap-2">
            {Icon && (
              <Icon
                size={sectionIconSize}
                aria-hidden
                className={collapsed ? "mx-auto" : "text-white/70"}
              />
            )}
            {!showIconOnly && <span>{section.title}</span>}
          </span>
          {!collapsed && (
            <span aria-hidden className="text-white/60">
              {isOpen ? "▾" : "▸"}
            </span>
          )}
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
        <div className={`flex items-center px-2 py-1 ${collapsed ? "justify-center" : "justify-between"}`}>
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
            className="flex h-9 w-9 items-center justify-center rounded-full text-white/70 transition hover:text-white"
            onClick={toggleCollapsed}
          >
            <Menu size={20} />
          </button>
        </div>

        <div
          className={`rounded-xl ${
            collapsed ? "bg-transparent p-2 shadow-none" : "bg-[#111827] p-3 shadow-soft"
          }`}
        >
          <div className={`flex items-center gap-3 ${collapsed ? "justify-center" : "justify-between"}`}>
            <div className={`flex items-center gap-3 ${collapsed ? "justify-center" : ""}`}>
              <div
                className={`grid flex-shrink-0 place-items-center rounded-full ${collapsed ? "h-9 w-9 text-xs" : "h-10 w-10 text-sm"}`}
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
                className="rounded-full p-2 text-white/70 transition hover:text-white"
                onClick={() => setOpenProfile((value) => !value)}
                aria-expanded={openProfile}
                title={openProfile ? "Fechar resumo" : "Abrir resumo"}
              >
                {openProfile ? <ChevronUp size={16} /> : <ChevronDownIcon size={16} />}
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
