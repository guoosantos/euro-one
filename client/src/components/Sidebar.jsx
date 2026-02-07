import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { NavLink, useLocation } from "react-router-dom";
import { ChevronDown, ChevronRight, ChevronUp, Menu } from "lucide-react";

import { sidebarGroupIcons } from "../lib/sidebarGroupIcons";

import { useTenant } from "../lib/tenant-context";
import { resolveCanManageUsers, usePermissions } from "../lib/permissions/permission-gate";
import { MENU_REGISTRY } from "../lib/permissions/registry";
import { useUI } from "../lib/store";
import { useTranslation } from "../lib/i18n.js";
import { UserMenuItems } from "./popovers/UserMenuPopover.jsx";

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

function getInitials(value) {
  const normalized = String(value || "").trim().replace(/\s+/g, " ");
  if (!normalized) return "EU";
  const parts = normalized.split(" ");
  if (parts.length === 1) {
    const word = parts[0];
    const first = word.slice(0, 1);
    const second = word.slice(1, 2);
    return `${first}${second}`.toUpperCase();
  }
  const first = parts[0].slice(0, 1);
  const last = parts[parts.length - 1].slice(0, 1);
  return `${first}${last}`.toUpperCase();
}

  const linkClass =
  (collapsed) =>
  ({ isActive }) =>
    `flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40 ${
      collapsed ? "justify-center" : "justify-start"
    } ${
      isActive
        ? "bg-white/10 text-text shadow-[0_0_0_1px_rgba(255,255,255,0.12)]"
        : "text-sub hover:bg-layer hover:text-text"
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
  const profileMenuRef = useRef(null);
  const [openSections, setOpenSections] = useState(() => ({
    ...DEFAULT_SECTIONS_OPEN,
  }));
  const [openSubmenus, setOpenSubmenus] = useState(() => ({
    ...DEFAULT_SUBMENUS_OPEN,
  }));
  const location = useLocation();

  const {
    homeClient,
    isMirrorReceiver,
    user,
    tenant,
    tenantScope,
    hasAdminAccess,
    permissionsReady,
    canAccess,
    role,
  } = useTenant();
  const { getPermission } = usePermissions();
  const { t } = useTranslation();
  const allClientsLabel = t("topbar.allClients");
  const accentColor = homeClient?.brandColor || ACCENT_FALLBACK;
  const hasBrandColor = Boolean(homeClient?.brandColor);
  const avatarStyle = hasBrandColor
    ? {
        backgroundColor: `${homeClient.brandColor}1a`,
        color: homeClient.brandColor,
      }
    : undefined;
  const navLinkClass = linkClass(collapsed);
  const activeStyle = linkStyle(accentColor);
  const adminUsersPermission = getPermission({ menuKey: "admin", pageKey: "users" });
  const adminClientsPermission = getPermission({ menuKey: "admin", pageKey: "clients" });
  const adminMirrorsPermission = getPermission({ menuKey: "admin", pageKey: "mirrors" });
  const canManageUsers = [adminUsersPermission, adminClientsPermission, adminMirrorsPermission].some((permission) =>
    resolveCanManageUsers({ permission }),
  );
  const isEuroImportEnabled = import.meta.env.VITE_FEATURE_EURO_XLSX_IMPORT === "true";
  const labelVisibilityClass = collapsed ? "hidden" : "flex-1 truncate";
  const linkIconSize = collapsed ? 22 : 18;
  const translateLabel = useCallback((label) => (label ? t(label) : ""), [t]);
  const navLabelProps = (label) => ({
    title: label,
    ...(collapsed ? { "aria-label": label } : {}),
  });
  const userName = useMemo(() => {
    return (
      user?.name ||
      user?.attributes?.name ||
      user?.username ||
      user?.email ||
      t("sidebar.userFallback")
    );
  }, [t, user?.attributes?.name, user?.email, user?.name, user?.username]);
  const clientName = useMemo(() => {
    if (tenantScope === "ALL" || (hasAdminAccess && (tenant?.id == null || tenant?.name === allClientsLabel))) {
      return allClientsLabel;
    }
    return (
      tenant?.name ||
      homeClient?.name ||
      user?.client?.name ||
      user?.attributes?.companyName ||
      t("sidebar.clientFallback")
    );
  }, [
    allClientsLabel,
    hasAdminAccess,
    homeClient?.name,
    t,
    tenant?.id,
    tenant?.name,
    tenantScope,
    user?.attributes?.companyName,
    user?.client?.name,
  ]);
  const userInitials = useMemo(() => getInitials(userName), [userName]);
  const menuReady = permissionsReady;
  const showMenuSkeleton = !menuReady;

  useEffect(() => {
    if (!openProfile) return;
    const handleOutsideClick = (event) => {
      if (!profileMenuRef.current) return;
      if (profileMenuRef.current.contains(event.target)) return;
      setOpenProfile(false);
    };
    document.addEventListener("pointerdown", handleOutsideClick);
    return () => document.removeEventListener("pointerdown", handleOutsideClick);
  }, [openProfile]);

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
      if (item.isVisible && !item.isVisible({ canManageUsers, isEuroImportEnabled, role, isMirrorReceiver })) {
        return null;
      }
      if (!item.permission) {
        return item;
      }
      return canAccess(item.permission) ? item : null;
    },
    [canAccess, canManageUsers, isEuroImportEnabled, isMirrorReceiver, role],
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

  const renderNavLink = (link) => {
    const translated = translateLabel(link.label);
    return (
    <NavLink
      key={link.key ?? link.to}
      to={link.to}
      className={navLinkClass}
      style={activeStyle}
      {...navLabelProps(translated)}
    >
      <link.icon size={linkIconSize} />
      <span className={labelVisibilityClass}>{translated}</span>
    </NavLink>
    );
  };

  const renderMenuItem = (item) => {
    if (!item) return null;
    if (item.children?.length) {
      const isOpen = openSubmenus[item.key] !== false;
      const hasActiveChild = item.children.some((child) => isLinkActive(child));
      const translatedLabel = translateLabel(item.label);

      return (
        <div key={item.key} className="space-y-1">
          <button
            type="button"
            className={`flex w-full items-center justify-between rounded-xl px-3 py-2 text-sm transition ${
              hasActiveChild
                ? "bg-white/10 text-text shadow-[0_0_0_1px_rgba(255,255,255,0.12)]"
                : "text-sub hover:bg-layer hover:text-text"
            }`}
            onClick={() => toggleSubmenu(item.key)}
            aria-expanded={isOpen}
            aria-label={translatedLabel}
          >
            <span className="flex items-center gap-2">
              <item.icon size={linkIconSize} />
              <span className={labelVisibilityClass}>{translatedLabel}</span>
            </span>
            <span className="text-sub">{isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</span>
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
    const translatedTitle = translateLabel(section.title);

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
          aria-label={t("sidebar.toggleSection", { section: translatedTitle })}
          title={collapsed ? translatedTitle : undefined}
          className="flex w-full items-center justify-between rounded-lg px-2 text-[11px] font-semibold uppercase tracking-wide text-sub hover:text-text"
        >
          <span className="flex flex-1 items-center gap-2">
            {Icon && (
              <Icon
                size={sectionIconSize}
                aria-hidden
                className={collapsed ? "mx-auto" : "text-sub"}
              />
            )}
            {!showIconOnly && <span>{translatedTitle}</span>}
          </span>
          {!collapsed && (
            <span aria-hidden className="text-sub">
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

  const renderMenuSkeleton = () => {
    const itemCount = collapsed ? 6 : 9;
    return (
      <div className="space-y-3 animate-pulse">
        {Array.from({ length: itemCount }).map((_, index) => (
          <div
            key={`sidebar-skeleton-${index}`}
            className={`rounded-xl bg-white/10 ${collapsed ? "h-10" : "h-9"} `}
          />
        ))}
      </div>
    );
  };

  return (

    <motion.aside
      className="flex h-screen min-h-screen flex-col overflow-hidden bg-sidebar"
      aria-label={t("sidebar.mainMenu")}
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
            className={`text-text font-semibold ${
              collapsed ? "hidden" : "truncate"
            }`}
          >
            {homeClient?.name ?? "Euro One"}
          </span>
          <button
            type="button"
            aria-label={t("sidebar.toggleMenu")}
            className="flex h-9 w-9 items-center justify-center rounded-full text-sub transition hover:text-text"
            onClick={toggleCollapsed}
          >
            <Menu size={20} />
          </button>
        </div>

        <div
          ref={profileMenuRef}
          className={`rounded-xl ${
            collapsed ? "bg-transparent p-2 shadow-none" : "bg-[var(--surface-user-card)] p-3 shadow-soft"
          }`}
        >
          <div className={`flex items-center gap-3 ${collapsed ? "justify-center" : "justify-between"}`}>
            <div className={`flex items-center gap-3 ${collapsed ? "justify-center" : ""}`}>
              <div
                className={`sidebar-avatar grid flex-shrink-0 place-items-center rounded-full ${!hasBrandColor ? "sidebar-avatar--fallback" : ""} ${collapsed ? "h-9 w-9 text-xs" : "h-10 w-10 text-sm"}`}
                style={avatarStyle}
              >
                <span className="text-sm font-semibold">
                  {userInitials}
                </span>
              </div>
              {!collapsed && (
                <div className="min-w-0">
                  <div className="text-sm font-medium text-text">
                    {userName}
                  </div>
                  <div className="-mt-0.5 text-xs text-sub">
                    {clientName}
                  </div>
                </div>
              )}
            </div>
            {!collapsed && (
              <button
                type="button"
                className="rounded-full p-2 text-sub transition hover:text-text"
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  setOpenProfile((value) => !value);
                }}
                aria-expanded={openProfile}
                title={openProfile ? t("sidebar.profileMenuClose") : t("sidebar.profileMenuOpen")}
              >
                {openProfile ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
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
                <UserMenuItems
                  onSelect={() => setOpenProfile(false)}
                  className="space-y-2"
                  showNotifications
                  showLogout={false}
                />
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div className="sidebar-scroll flex-1 min-h-0 space-y-3 overflow-y-auto pr-1">
          {showMenuSkeleton ? renderMenuSkeleton() : menuSections.map((section) => renderSection(section))}
        </div>
      </nav>
    </motion.aside>
  );
}
