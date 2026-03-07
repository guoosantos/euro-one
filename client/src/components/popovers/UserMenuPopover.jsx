import React, { useEffect, useRef, useState } from "react";
import { Bell, LogOut, Settings, User } from "lucide-react";
import { useNavigate } from "react-router-dom";

import { useTranslation } from "../../lib/i18n.js";
import { useTenant } from "../../lib/tenant-context";

export function UserMenuItems({
  onSelect,
  className = "",
  itemClassName = "",
  showLogout = true,
  showNotifications = false,
}) {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { logout } = useTenant();

  const handleNavigate = (path) => {
    navigate(path);
    onSelect?.();
  };

  const handleLogout = async () => {
    await logout();
    onSelect?.();
    navigate("/login");
  };

  const baseItemClass = `flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm text-text transition hover:bg-layer ${itemClassName}`.trim();

  return (
    <div className={`flex flex-col gap-1 ${className}`.trim()} role="menu">
      <button type="button" role="menuitem" className={baseItemClass} onClick={() => handleNavigate("/account")}> 
        <User size={16} />
        <span>{t("userMenu.profile")}</span>
      </button>
      <button type="button" role="menuitem" className={baseItemClass} onClick={() => handleNavigate("/settings")}> 
        <Settings size={16} />
        <span>{t("userMenu.settings")}</span>
      </button>
      {showNotifications && (
        <button type="button" role="menuitem" className={baseItemClass} onClick={() => handleNavigate("/notifications")}> 
          <Bell size={16} />
          <span>{t("notifications.title")}</span>
        </button>
      )}
      {showLogout && (
        <button type="button" role="menuitem" className={baseItemClass} onClick={handleLogout}> 
          <LogOut size={16} />
          <span>{t("userMenu.logout")}</span>
        </button>
      )}
    </div>
  );
}

export default function UserMenuPopover() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const containerRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const handleOutside = (event) => {
      if (!containerRef.current) return;
      if (containerRef.current.contains(event.target)) return;
      setOpen(false);
    };
    const handleEscape = (event) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", handleOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("pointerdown", handleOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      <button
        className="btn"
        type="button"
        aria-label={t("userMenu.trigger")}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((state) => !state)}
      >
        <User size={18} />
      </button>

      {open && (
        <div className="absolute right-0 top-full z-30 mt-2 w-56 rounded-2xl border border-border bg-surface p-2 shadow-soft">
          <UserMenuItems onSelect={() => setOpen(false)} />
        </div>
      )}
    </div>
  );
}
