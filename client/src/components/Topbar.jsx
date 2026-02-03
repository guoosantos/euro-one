import React, { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Languages, Menu, Moon, Search, Sun } from "lucide-react";

import { useUI } from "../lib/store";
import { useTenant, setStoredMirrorOwnerId } from "../lib/tenant-context";
import useDevices from "../lib/hooks/useDevices";
import { useLivePositions } from "../lib/hooks/useLivePositions";
import { useEvents } from "../lib/hooks/useEvents";
import { buildFleetState, formatDate } from "../lib/fleet-utils";
import { translateEventType } from "../lib/event-translations.js";
import { useTranslation } from "../lib/i18n.js";
import NotificationsPopover from "./popovers/NotificationsPopover.jsx";
import UserMenuPopover from "./popovers/UserMenuPopover.jsx";
import TenantCombobox from "./inputs/TenantCombobox.jsx";

function normalizePlateValue(value) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function isNumericIdPlate(value, id) {
  if (!value) return false;
  const normalized = String(value).trim();
  if (!normalized || !/^\d+$/.test(normalized)) return false;
  return String(id) === normalized;
}

function getDeviceKey(device) {
  const key = device?.id ?? device?.deviceId ?? device?.uniqueId ?? device?.name ?? null;
  return key == null ? null : String(key);
}

function resolveDevicePlate(device) {
  if (!device) return "";
  const attributes = device.attributes ?? {};
  return (
    device.plate ??
    device.registrationNumber ??
    device.vehiclePlate ??
    attributes.plate ??
    attributes.plateNumber ??
    attributes.vehiclePlate ??
    attributes.registrationNumber ??
    device.vehicle?.plate ??
    device.vehicle?.registrationNumber ??
    ""
  );
}

export function Topbar({ title }) {
  const toggleSidebar = useUI((state) => state.toggle);
  const theme = useUI((state) => state.theme);
  const toggleTheme = useUI((state) => state.toggleTheme);
  const setLocale = useUI((state) => state.setLocale);
  const {
    tenantId,
    switchContext,
    tenant,
    tenants,
    hasAdminAccess,
    canSwitchTenant,
    mirrorOwners,
    isMirrorReceiver,
    homeClientId,
    homeClient,
    mirrorContextMode,
    activeMirrorOwnerClientId,
    contextSwitching,
  } = useTenant();
  const navigate = useNavigate();
  const location = useLocation();
  const { locale, t } = useTranslation();

  const [query, setQuery] = useState("");
  const [focused, setFocused] = useState(false);
  const [switchLocked, setSwitchLocked] = useState(false);
  const switchTimerRef = useRef(null);

  const { data: devices = [] } = useDevices();
  const { data: positions = [] } = useLivePositions();
  const { events: recentEvents } = useEvents({ limit: 3 });
  const deviceByKey = useMemo(() => {
    const map = new Map();
    devices.forEach((device) => {
      const key = getDeviceKey(device);
      if (key) map.set(key, device);
      if (device?.uniqueId != null) map.set(String(device.uniqueId), device);
      if (device?.deviceId != null) map.set(String(device.deviceId), device);
    });
    return map;
  }, [devices]);

  const mirrorOwnerIds = useMemo(() => {
    if (!Array.isArray(mirrorOwners)) return new Set();
    return new Set(mirrorOwners.map((owner) => String(owner.id)));
  }, [mirrorOwners]);
  const isMirrorSelectable = isMirrorReceiver && Array.isArray(mirrorOwners) && mirrorOwners.length > 0;
  const selectValue = mirrorContextMode === "target"
    ? (activeMirrorOwnerClientId ? String(activeMirrorOwnerClientId) : (isMirrorSelectable ? "all" : String(homeClientId ?? tenantId ?? "")))
    : String(tenantId ?? "");
  const ownedTenants = useMemo(() => {
    if (hasAdminAccess) return [];
    let base = tenants.filter((item) => !mirrorOwnerIds.has(String(item.id)));
    if (homeClient && homeClientId && !base.some((item) => String(item.id) === String(homeClientId))) {
      base = [homeClient, ...base];
    }
    if (isMirrorSelectable && homeClientId) {
      base = base.filter((item) => String(item.id) !== String(homeClientId));
    }
    return base;
  }, [hasAdminAccess, homeClient, homeClientId, isMirrorSelectable, mirrorOwnerIds, tenants]);
  const mirroredTenants = useMemo(() => {
    if (hasAdminAccess) return [];
    return Array.isArray(mirrorOwners) ? mirrorOwners : [];
  }, [hasAdminAccess, mirrorOwners]);
  const showMirrorOwnerLabel = isMirrorReceiver && Array.isArray(mirrorOwners) && mirrorOwners.length > 1;
  const mirrorAllLabel = t("topbar.mirrorAll");
  const handleTenantSelect = (nextValue) => {
    const nextId = nextValue || null;
    if (switchTimerRef.current) {
      clearTimeout(switchTimerRef.current);
      switchTimerRef.current = null;
    }
    setSwitchLocked(true);
    switchTimerRef.current = setTimeout(() => {
      if (isMirrorSelectable) {
        if (nextId === "all") {
          setStoredMirrorOwnerId("all");
          switchContext({
            nextTenantId: homeClientId ?? tenantId,
            nextOwnerClientId: "all",
            nextMirrorMode: "target",
          });
          return;
        }
        if (!nextId || String(nextId) === String(homeClientId ?? "")) {
          switchContext({
            nextTenantId: nextId,
            nextOwnerClientId: null,
            nextMirrorMode: "self",
          });
          return;
        }
        if (mirrorOwnerIds.has(String(nextId))) {
          setStoredMirrorOwnerId(String(nextId));
          switchContext({
            nextTenantId: nextId,
            nextOwnerClientId: String(nextId),
            nextMirrorMode: "target",
          });
          return;
        }
        switchContext({
          nextTenantId: nextId,
          nextOwnerClientId: null,
          nextMirrorMode: "self",
        });
        return;
      }
      switchContext({ nextTenantId: nextId, nextOwnerClientId: null });
    }, 220);
  };

  useEffect(() => {
    if (!contextSwitching && switchLocked) {
      setSwitchLocked(false);
    }
  }, [contextSwitching, switchLocked]);

  useEffect(() => () => {
    if (switchTimerRef.current) clearTimeout(switchTimerRef.current);
  }, []);

  const fleetIndex = useMemo(() => {
    const { rows } = buildFleetState(devices, positions, { tenantId });
    return rows.map((row) => ({
      id: row.id,
      deviceId:
        row?.device?.id ??
        row?.position?.deviceId ??
        row?.position?.device?.id ??
        row?.device?.deviceId ??
        row?.id ??
        null,
      name: row.name,
      plate: (() => {
        const rowPlate = normalizePlateValue(row?.plate);
        const safeRowPlate = isNumericIdPlate(rowPlate, row?.id) ? "" : rowPlate;
        if (safeRowPlate) return safeRowPlate;
        const deviceRef =
          row?.device ??
          row?.position?.device ??
          deviceByKey.get(String(row?.device?.id ?? row?.device?.deviceId ?? row?.id ?? "")) ??
          deviceByKey.get(String(row?.position?.deviceId ?? row?.id ?? ""));
        const fallback = normalizePlateValue(resolveDevicePlate(deviceRef));
        return isNumericIdPlate(fallback, row?.id) ? "" : fallback;
      })(),
      status: row.status,
    }));
  }, [deviceByKey, devices, positions, tenantId]);

  const searchResults = useMemo(() => {
    if (!query.trim()) return [];
    const term = query.trim().toLowerCase();
    const scored = [];
    fleetIndex.forEach((item) => {
      if (!item.deviceId) return;
      const plateRaw = item.plate ?? "";
      const nameRaw = item.name ?? "";
      const plate = plateRaw.toLowerCase();
      const name = nameRaw.toLowerCase();
      let score = 0;
      if (plate) {
        if (plate.startsWith(term)) score = 3;
        else if (plate.includes(term)) score = 2;
      }
      if (!score && name.includes(term)) score = 1;
      if (!score) return;
      scored.push({ ...item, __score: score, __plate: plateRaw, __name: nameRaw });
    });
    return scored
      .sort((a, b) => {
        if (b.__score !== a.__score) return b.__score - a.__score;
        const plateCompare = String(a.__plate || "").localeCompare(String(b.__plate || ""));
        if (plateCompare !== 0) return plateCompare;
        return String(a.__name || "").localeCompare(String(b.__name || ""));
      })
      .slice(0, 5);
  }, [query, fleetIndex]);

  const allClientsLabel = t("topbar.allClients");
  const tenantOptions = useMemo(() => {
    if (hasAdminAccess) {
      return [
        { id: "", label: allClientsLabel },
        ...tenants.map((item) => ({ id: String(item.id ?? ""), label: item.name })),
      ];
    }
    const options = [];
    if (ownedTenants.length > 0) {
      options.push(
        ...ownedTenants.map((item) => ({
          id: String(item.id ?? ""),
          label: item.name,
          group: t("topbar.tenantGroupOwner"),
        })),
      );
    }
    if (isMirrorSelectable && mirroredTenants.length > 0) {
      options.push({
        id: "all",
        label: mirrorAllLabel,
        group: t("topbar.tenantGroupMirrored"),
      });
      options.push(
        ...mirroredTenants.map((item) => ({
          id: String(item.id ?? ""),
          label: `${item.name} (${t("topbar.mirroredSuffix")})`,
          group: t("topbar.tenantGroupMirrored"),
        })),
      );
    }
    return options;
  }, [allClientsLabel, hasAdminAccess, isMirrorSelectable, mirrorAllLabel, mirroredTenants, ownedTenants, tenants]);

  const selectedTenantLabel = useMemo(() => {
    const selected = tenantOptions.find((option) => String(option.id) === String(selectValue));
    if (selected) return selected.label;
    if (!tenantId && hasAdminAccess) return allClientsLabel;
    return tenant?.name ?? allClientsLabel;
  }, [hasAdminAccess, selectValue, t, tenant?.name, tenantId, tenantOptions]);
  const showGlobalTenantLogo =
    hasAdminAccess &&
    (tenantId === null || tenantId === undefined || String(selectValue) === "") &&
    (tenant?.id == null || tenant?.name === allClientsLabel);

  // Reusa o fluxo de foco do monitoramento via location.state, mesmo quando já estamos na rota.
  const handleDeviceFocus = (deviceId) => {
    if (!deviceId) return;
    if (location.pathname === "/monitoring") {
      navigate("/monitoring", { state: { focusDeviceId: deviceId }, replace: true });
      return;
    }
    navigate("/monitoring", { state: { focusDeviceId: deviceId } });
  };

  const handleSubmit = (event) => {
    event.preventDefault();
    if (searchResults.length) {
      handleDeviceFocus(searchResults[0].deviceId);
      setQuery("");
      setFocused(false);
    }
  };

  const logoStyle = theme === "dark" ? { filter: "invert(1)" } : undefined;
  const subtitleLabel = title || tenant?.segment || t("topbar.subtitle");

  return (
    <header className="sticky top-0 z-20 border-b border-border bg-surface backdrop-blur">
      <div className="flex w-full items-center gap-4 px-4 py-3 md:px-6 lg:px-8">
        <div className="flex flex-1 items-center gap-3">
          <button type="button" className="btn md:hidden" onClick={toggleSidebar} aria-label={t("topbar.openMenu")}>
            <Menu size={18} />
          </button>

          <div>
            <div className="text-sm font-medium leading-none text-text">
              {showGlobalTenantLogo ? (
                <img
                  src="https://eurosolucoes.tech/wp-content/uploads/2024/10/logo-3-2048x595.png"
                  alt="Euro Soluções Tecnológicas"
                  className="h-6 w-auto"
                  style={logoStyle}
                  loading="lazy"
                  referrerPolicy="no-referrer"
                />
              ) : (
                tenant?.name ?? "Euro One"
              )}
            </div>
            {!showGlobalTenantLogo && subtitleLabel ? (
              <div className="text-[11px] text-sub">
                {subtitleLabel}
              </div>
            ) : null}
          </div>
        </div>

        <form className="relative hidden flex-1 md:block" onSubmit={handleSubmit} role="search">
          <label className="relative block">
            <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sub">
              <Search size={16} />
            </span>
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onFocus={() => setFocused(true)}
              onBlur={() => setTimeout(() => setFocused(false), 120)}
              placeholder={t("topbar.searchPlaceholder", { scope: selectedTenantLabel })}
              aria-label={t("topbar.searchAriaLabel")}
              className="h-11 w-full rounded-xl border border-border bg-layer pl-10 pr-3 text-sm text-text placeholder:text-sub focus:border-primary/50 focus:outline-none"
            />
          </label>

          {focused && (query ? (
            <div className="absolute left-0 right-0 top-full z-10 mt-2 overflow-hidden rounded-xl border border-border bg-surface shadow-soft">
              {searchResults.length ? (
                <ul>
                  {searchResults.map((item) => {
                    const plateLabel = item.plate ? item.plate : t("topbar.noPlate");
                    const nameLabel = item.name ? item.name : "";
                    return (
                    <li key={item.deviceId ?? item.id}>
                      <button
                        type="button"
                        className="flex w-full items-center justify-between gap-4 px-4 py-3 text-left text-sm text-text hover:bg-layer"
                        onClick={() => {
                          handleDeviceFocus(item.deviceId);
                          setQuery("");
                          setFocused(false);
                        }}
                      >
                        <span className="flex flex-col text-left">
                          <span className="text-base font-semibold text-text">{plateLabel}</span>
                          {nameLabel ? <span className="text-xs text-sub">{nameLabel}</span> : null}
                        </span>
                        <span className="text-xs text-sub">
                          {t(`monitoring.status.${item.status}`)}
                        </span>
                      </button>
                    </li>
                  );
                  })}
                </ul>
              ) : (
                <div className="px-4 py-3 text-sm text-sub">{t("topbar.searchEmpty")}</div>
              )}
            </div>
          ) : (
            <div className="absolute left-0 right-0 top-full z-10 mt-2 overflow-hidden rounded-xl border border-border bg-surface shadow-soft">
              <div className="px-4 py-2 text-xs uppercase tracking-wider text-sub">
                {t("topbar.searchRecentAlerts")}
              </div>
              <ul>
                {recentEvents.map((event) => (
                  <li key={event.id ?? `${event.deviceId}-${event.time}` } className="px-4 py-2 text-sm text-sub">
                    <div className="font-medium text-text">
                      {translateEventType(
                        event.type ?? event.event,
                        locale,
                        t,
                        event.protocol || event.attributes?.protocol || null,
                        event,
                      )}
                    </div>
                    <div className="text-xs text-sub">
                      {formatDate(event.time ?? event.eventTime ?? event.serverTime, locale, {
                        hour: "2-digit",
                        minute: "2-digit",
                      }) || "—"}
                    </div>
                  </li>
                ))}
                {!recentEvents.length && (
                  <li className="px-4 py-2 text-sm text-sub">{t("topbar.searchNoEvents")}</li>
                )}
              </ul>
            </div>
          ))}
        </form>

        <div className="flex items-center gap-2">
          <div className="hidden flex-col items-start gap-1 md:flex">
            {showMirrorOwnerLabel && (
              <span className="text-[10px] uppercase tracking-[0.12em] text-sub">
                {t("topbar.ownerLabel")}
              </span>
            )}
            <TenantCombobox
              className="min-w-[220px]"
              value={selectValue}
              options={tenantOptions}
              onChange={handleTenantSelect}
              placeholder={t("topbar.tenantPlaceholder")}
              emptyLabel={t("topbar.tenantEmpty")}
              ariaLabel={t("topbar.tenantAriaLabel")}
              toggleLabel={t("topbar.tenantToggle")}
              disabled={contextSwitching || switchLocked || !canSwitchTenant || tenantOptions.length <= 1}
            />
          </div>

          <div className="relative hidden items-center gap-2 md:flex">
            <Languages size={18} className="text-sub" />
            <select
              value={locale}
              onChange={(event) => setLocale(event.target.value)}
              aria-label={t("topbar.languageAriaLabel")}
              className="h-11 rounded-xl border border-border bg-layer px-3 text-sm text-text hover:border-primary/40 focus:border-primary/60 focus:outline-none"
            >
              <option value="pt-BR">Português</option>
              <option value="en-US">English</option>
            </select>
          </div>

          <button
            className="btn hidden md:inline-flex"
            type="button"
            title={t("topbar.toggleTheme")}
            aria-label={t("topbar.toggleTheme")}
            onClick={toggleTheme}
          >
            {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
          </button>

          <NotificationsPopover onSelectDevice={handleDeviceFocus} />
          <UserMenuPopover />
        </div>
      </div>
    </header>
  );
}
