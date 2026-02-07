import React, { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Languages, Menu, Moon, Search, Sun } from "lucide-react";

import { useUI } from "../lib/store";
import { useTenant, setStoredMirrorOwnerId } from "../lib/tenant-context";
import useDevices from "../lib/hooks/useDevices";
import { useLivePositions } from "../lib/hooks/useLivePositions";
import useTelemetry from "../lib/hooks/useTelemetry";
import useVehicles, { normalizeVehicleDevices } from "../lib/hooks/useVehicles.js";
import { buildFleetState } from "../lib/fleet-utils";
import { useTranslation } from "../lib/i18n.js";
import { isAdminGeneralClientName, normalizeAdminClientName } from "../lib/admin-general.js";
import NotificationsPopover from "./popovers/NotificationsPopover.jsx";
import UserMenuPopover from "./popovers/UserMenuPopover.jsx";
import TenantCombobox from "./inputs/TenantCombobox.jsx";

function normalizePlateValue(value) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function sanitizeName(value, id) {
  if (value === null || value === undefined) return "";
  const normalized = String(value).trim();
  if (!normalized) return "";
  const lower = normalized.toLowerCase();
  const idString = id == null ? "" : String(id);
  if (/^\d+$/.test(normalized) && idString && normalized === idString) return "";
  if (idString && (lower === `dispositivo ${idString}` || lower === `device ${idString}`)) return "";
  return normalized;
}

function sanitizePlate(value, id) {
  const normalized = normalizePlateValue(value);
  if (!normalized) return "";
  return isNumericIdPlate(normalized, id) ? "" : normalized;
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

function resolveVehiclePlate(vehicle) {
  if (!vehicle) return "";
  const attributes = vehicle.attributes ?? {};
  return (
    vehicle.plate ??
    vehicle.registrationNumber ??
    vehicle.vehiclePlate ??
    attributes.plate ??
    attributes.plateNumber ??
    attributes.vehiclePlate ??
    attributes.registrationNumber ??
    ""
  );
}

function resolveVehicleDescriptor(device, vehicle) {
  const deviceAttributes = device?.attributes ?? {};
  const vehicleAttributes = vehicle?.attributes ?? {};
  const make =
    deviceAttributes.make ??
    deviceAttributes.brand ??
    deviceAttributes.vehicleBrand ??
    vehicleAttributes.make ??
    vehicleAttributes.brand ??
    vehicleAttributes.vehicleBrand ??
    vehicle?.brand ??
    vehicle?.make ??
    "";
  const model =
    deviceAttributes.model ??
    deviceAttributes.vehicleModel ??
    deviceAttributes.modelName ??
    vehicleAttributes.model ??
    vehicleAttributes.vehicleModel ??
    vehicleAttributes.modelName ??
    vehicle?.model ??
    vehicle?.vehicleModel ??
    vehicle?.modelName ??
    "";
  return {
    make: sanitizeName(make, null),
    model: sanitizeName(model, null),
  };
}

const ADMIN_SCOPE_STORAGE_KEY = "euro-one.admin.scope";
const ADMIN_SCOPE_ALL = "all";
const ADMIN_SCOPE_EURO = "euro";
const ADMIN_ALL_OPTION_ID = "all";
const ADMIN_GENERAL_OPTION_ID = "admin-general";

function readAdminScope() {
  if (typeof window === "undefined") return ADMIN_SCOPE_ALL;
  try {
    return window.localStorage?.getItem(ADMIN_SCOPE_STORAGE_KEY) || ADMIN_SCOPE_ALL;
  } catch (_error) {
    return ADMIN_SCOPE_ALL;
  }
}

function persistAdminScope(value) {
  if (typeof window === "undefined") return;
  try {
    if (!value) {
      window.localStorage?.removeItem(ADMIN_SCOPE_STORAGE_KEY);
      return;
    }
    window.localStorage?.setItem(ADMIN_SCOPE_STORAGE_KEY, value);
  } catch (_error) {
    // ignore storage failures
  }
}

export function Topbar({ title }) {
  const toggleSidebar = useUI((state) => state.toggle);
  const theme = useUI((state) => state.theme);
  const toggleTheme = useUI((state) => state.toggleTheme);
  const setLocale = useUI((state) => state.setLocale);
  const {
    tenantId,
    tenantScope,
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
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [focused, setFocused] = useState(false);
  const [switchLocked, setSwitchLocked] = useState(false);
  const switchTimerRef = useRef(null);
  const searchDebounceRef = useRef(null);
  const [adminScope, setAdminScope] = useState(() => readAdminScope());

  const { data: devices = [] } = useDevices();
  const { data: positions = [] } = useLivePositions();
  const { telemetry = [] } = useTelemetry();
  const { vehicles = [] } = useVehicles({ includeTelemetry: false });
  const effectiveTenantId = tenantId === "" ? null : tenantId;
  const isGlobalScope = hasAdminAccess && (tenantScope === "ALL" || effectiveTenantId === null);
  const searchTerm = debouncedQuery.trim();
  const searchActive = Boolean(searchTerm) && focused;
  const useGlobalSearchData = isGlobalScope && searchActive;
  const telemetryDevices = useMemo(() => {
    if (!useGlobalSearchData) return [];
    const list = Array.isArray(telemetry) ? telemetry : [];
    return list
      .map((entry) => {
        const device = entry?.device ?? null;
        const vehicle = entry?.vehicle ?? device?.vehicle ?? null;
        const deviceId =
          device?.id ??
          device?.deviceId ??
          entry?.deviceId ??
          entry?.traccarId ??
          entry?.principalDeviceId ??
          null;
        if (!deviceId) return null;
        return {
          ...device,
          id: device?.id ?? deviceId,
          deviceId: device?.deviceId ?? entry?.deviceId ?? device?.id ?? deviceId,
          vehicleId: device?.vehicleId ?? entry?.vehicleId ?? vehicle?.id ?? null,
          vehicle: device?.vehicle ?? vehicle,
          plate: device?.plate ?? entry?.plate ?? vehicle?.plate ?? null,
          clientId: device?.clientId ?? entry?.clientId ?? vehicle?.clientId ?? null,
          attributes: { ...(device?.attributes || {}), ...(entry?.rawAttributes || entry?.attributes || {}) },
        };
      })
      .filter(Boolean);
  }, [telemetry, useGlobalSearchData]);
  const telemetryPositions = useMemo(() => {
    if (!useGlobalSearchData) return [];
    const list = Array.isArray(telemetry) ? telemetry : [];
    return list.map((entry) => entry?.position).filter(Boolean);
  }, [telemetry, useGlobalSearchData]);
  const activeDevices = useMemo(
    () => (searchActive ? (isGlobalScope ? telemetryDevices : devices) : []),
    [devices, isGlobalScope, searchActive, telemetryDevices],
  );
  const activePositions = useMemo(
    () => (searchActive ? (isGlobalScope ? telemetryPositions : positions) : []),
    [isGlobalScope, positions, searchActive, telemetryPositions],
  );
  const activePositionsRef = useRef([]);
  if (searchActive) {
    activePositionsRef.current = activePositions;
  }
  const activeTenantId = isGlobalScope ? null : effectiveTenantId;
  const deviceByKey = useMemo(() => {
    if (!searchActive) return new Map();
    const map = new Map();
    activeDevices.forEach((device) => {
      const key = getDeviceKey(device);
      if (key) map.set(key, device);
      if (device?.uniqueId != null) map.set(String(device.uniqueId), device);
      if (device?.deviceId != null) map.set(String(device.deviceId), device);
    });
    return map;
  }, [activeDevices, searchActive]);
  const vehicleById = useMemo(() => {
    if (!searchActive) return new Map();
    const map = new Map();
    vehicles.forEach((vehicle) => {
      const id = vehicle?.id ?? vehicle?.vehicleId ?? vehicle?.vehicle_id;
      if (id == null) return;
      map.set(String(id), vehicle);
    });
    return map;
  }, [searchActive, vehicles]);
  const plateByDeviceKey = useMemo(() => {
    if (!searchActive) return new Map();
    const map = new Map();
    vehicles.forEach((vehicle) => {
      const plateValue = sanitizePlate(resolveVehiclePlate(vehicle), vehicle?.id);
      if (!plateValue) return;
      const devicesList = normalizeVehicleDevices(vehicle);
      devicesList.forEach((device) => {
        const key = getDeviceKey(device);
        if (key) map.set(String(key), plateValue);
        const rawId = device?.id ?? device?.deviceId ?? device?.uniqueId ?? null;
        if (rawId != null) map.set(String(rawId), plateValue);
      });
      const preferredKey =
        vehicle?.primaryDeviceId ??
        vehicle?.principalDeviceId ??
        vehicle?.deviceId ??
        vehicle?.device?.id ??
        vehicle?.device?.deviceId ??
        vehicle?.device?.uniqueId ??
        null;
      if (preferredKey != null) map.set(String(preferredKey), plateValue);
    });
    return map;
  }, [searchActive, vehicles]);

  const mirrorOwnerIds = useMemo(() => {
    if (!Array.isArray(mirrorOwners)) return new Set();
    return new Set(mirrorOwners.map((owner) => String(owner.id)));
  }, [mirrorOwners]);
  const isMirrorSelectable = isMirrorReceiver && Array.isArray(mirrorOwners) && mirrorOwners.length > 0;
  const selectValueRaw = mirrorContextMode === "target"
    ? (activeMirrorOwnerClientId ? String(activeMirrorOwnerClientId) : (isMirrorSelectable ? "all" : String(homeClientId ?? tenantId ?? "")))
    : String(tenantId ?? "");
  const adminGeneralOption = useMemo(() => {
    if (!hasAdminAccess) return null;
    const candidate = homeClient && isAdminGeneralClientName(homeClient?.name) ? homeClient : null;
    if (!candidate) return null;
    return {
      id: ADMIN_GENERAL_OPTION_ID,
      label: normalizeAdminClientName(candidate.name) || "EURO ONE",
    };
  }, [hasAdminAccess, homeClient]);
  const selectValue = useMemo(() => {
    if (!hasAdminAccess) return selectValueRaw;
    if (tenantId !== null && tenantId !== undefined && String(tenantId) !== "") {
      return String(tenantId);
    }
    if (adminScope === ADMIN_SCOPE_EURO && adminGeneralOption) {
      return ADMIN_GENERAL_OPTION_ID;
    }
    return ADMIN_ALL_OPTION_ID;
  }, [adminGeneralOption, adminScope, hasAdminAccess, selectValueRaw, tenantId]);
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
  const mirrorAllLabel = t("topbar.mirrorAll");
  const handleTenantSelect = (nextValue) => {
    const nextId = nextValue || null;
    if (switchTimerRef.current) {
      clearTimeout(switchTimerRef.current);
      switchTimerRef.current = null;
    }
    setSwitchLocked(true);
    switchTimerRef.current = setTimeout(() => {
      if (hasAdminAccess) {
        if (nextId === ADMIN_ALL_OPTION_ID) {
          setAdminScope(ADMIN_SCOPE_ALL);
          persistAdminScope(ADMIN_SCOPE_ALL);
          setStoredMirrorOwnerId(null);
          switchContext({
            nextTenantId: null,
            nextOwnerClientId: null,
            nextMirrorMode: "self",
          });
          return;
        }
        if (nextId === ADMIN_GENERAL_OPTION_ID) {
          setAdminScope(ADMIN_SCOPE_EURO);
          persistAdminScope(ADMIN_SCOPE_EURO);
          setStoredMirrorOwnerId(null);
          switchContext({
            nextTenantId: homeClientId ?? null,
            nextOwnerClientId: null,
            nextMirrorMode: "self",
          });
          return;
        }
        setAdminScope(ADMIN_SCOPE_ALL);
        persistAdminScope(ADMIN_SCOPE_ALL);
        setStoredMirrorOwnerId(null);
        switchContext({
          nextTenantId: nextId,
          nextOwnerClientId: null,
          nextMirrorMode: "self",
        });
        return;
      }
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

  useEffect(() => {
    if (searchDebounceRef.current) {
      clearTimeout(searchDebounceRef.current);
    }
    searchDebounceRef.current = setTimeout(() => {
      setDebouncedQuery(query);
    }, 250);
    return () => {
      if (searchDebounceRef.current) {
        clearTimeout(searchDebounceRef.current);
      }
    };
  }, [query]);

  useEffect(() => () => {
    if (switchTimerRef.current) clearTimeout(switchTimerRef.current);
  }, []);

  const fleetIndex = useMemo(() => {
    if (!searchActive) return [];
    const { rows } = buildFleetState(activeDevices, activePositionsRef.current, { tenantId: activeTenantId });
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
        const rowPlate = sanitizePlate(row?.plate, row?.id);
        if (rowPlate) return rowPlate;
        const deviceRef =
          row?.device ??
          row?.position?.device ??
          deviceByKey.get(String(row?.device?.id ?? row?.device?.deviceId ?? row?.id ?? "")) ??
          deviceByKey.get(String(row?.position?.deviceId ?? row?.id ?? ""));
        const devicePlate = sanitizePlate(resolveDevicePlate(deviceRef), row?.id);
        if (devicePlate) return devicePlate;
        const deviceKey =
          getDeviceKey(deviceRef) ??
          row?.position?.deviceId ??
          row?.device?.deviceId ??
          row?.device?.id ??
          null;
        const mappedPlate = sanitizePlate(plateByDeviceKey.get(String(deviceKey ?? "")), row?.id);
        if (mappedPlate) return mappedPlate;
        const vehicleId =
          deviceRef?.vehicleId ??
          row?.position?.vehicleId ??
          row?.device?.vehicleId ??
          row?.position?.vehicle?.id ??
          row?.device?.vehicle?.id ??
          null;
        const vehicle = vehicleId ? vehicleById.get(String(vehicleId)) : null;
        return sanitizePlate(resolveVehiclePlate(vehicle), row?.id);
      })(),
      vehicleLabel: (() => {
        const deviceRef =
          row?.device ??
          row?.position?.device ??
          deviceByKey.get(String(row?.device?.id ?? row?.device?.deviceId ?? row?.id ?? "")) ??
          deviceByKey.get(String(row?.position?.deviceId ?? row?.id ?? ""));
        const vehicleId =
          deviceRef?.vehicleId ??
          row?.position?.vehicleId ??
          row?.device?.vehicleId ??
          row?.position?.vehicle?.id ??
          row?.device?.vehicle?.id ??
          null;
        const vehicle = vehicleId ? vehicleById.get(String(vehicleId)) : deviceRef?.vehicle ?? null;
        const { make, model } = resolveVehicleDescriptor(deviceRef, vehicle);
        const label = [make, model].filter(Boolean).join(" / ");
        if (label) return label;
        const safeName = sanitizeName(row?.name, row?.id);
        return safeName || "—";
      })(),
      status: row.status,
    }));
  }, [activeDevices, activeTenantId, deviceByKey, plateByDeviceKey, searchActive, vehicleById]);

  const searchResults = useMemo(() => {
    if (!searchTerm) return [];
    const term = searchTerm.toLowerCase();
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
  }, [fleetIndex, searchTerm]);

  const allClientsLabel = t("topbar.allClients");
  const tenantOptions = useMemo(() => {
    if (hasAdminAccess) {
      const options = [
        { id: ADMIN_ALL_OPTION_ID, label: allClientsLabel },
      ];
      if (adminGeneralOption) {
        options.push(adminGeneralOption);
      }
      options.push(...tenants.map((item) => ({ id: String(item.id ?? ""), label: item.name })));
      return options;
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
  }, [
    adminGeneralOption,
    allClientsLabel,
    hasAdminAccess,
    isMirrorSelectable,
    mirrorAllLabel,
    mirroredTenants,
    ownedTenants,
    tenants,
  ]);

  const selectedTenantLabel = useMemo(() => {
    const selected = tenantOptions.find((option) => String(option.id) === String(selectValue));
    if (selected) return selected.label;
    if (!tenantId && hasAdminAccess) {
      if (adminScope === ADMIN_SCOPE_EURO && adminGeneralOption) {
        return adminGeneralOption.label;
      }
      return allClientsLabel;
    }
    return tenant?.name ?? allClientsLabel;
  }, [
    adminGeneralOption,
    adminScope,
    allClientsLabel,
    hasAdminAccess,
    selectValue,
    tenant?.name,
    tenantId,
    tenantOptions,
  ]);
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

  const logoStyle =
    theme === "dark"
      ? { filter: "brightness(0) invert(1)" }
      : { filter: "brightness(0)" };

  return (
    <header className="sticky top-0 z-[9998] border-b border-border bg-surface backdrop-blur">
      <div className="flex w-full items-center gap-4 px-4 py-3 md:px-6 lg:px-8">
        <div className="flex flex-1 items-center gap-3">
          <button type="button" className="btn md:hidden" onClick={toggleSidebar} aria-label={t("topbar.openMenu")}>
            <Menu size={18} />
          </button>

          <div>
            <div className="text-sm font-medium leading-none text-text">
              <img
                src="https://eurosolucoes.tech/wp-content/uploads/2024/10/logo-3-2048x595.png"
                alt="Euro Soluções Tecnológicas"
                className="h-8 max-h-8 w-auto object-contain"
                style={logoStyle}
                loading="lazy"
                referrerPolicy="no-referrer"
              />
            </div>
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

          {focused && query.trim() ? (
            <div className="absolute left-0 right-0 top-full z-[9999] mt-2 overflow-hidden rounded-xl border border-border bg-surface shadow-soft">
              {searchResults.length ? (
                <ul>
                  {searchResults.map((item) => {
                    const plateLabel = item.plate ? item.plate : t("topbar.noPlate");
                    const nameLabel = item.vehicleLabel ? item.vehicleLabel : "";
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
          ) : focused ? (
            <div className="absolute left-0 right-0 top-full z-[9999] mt-2 overflow-hidden rounded-xl border border-border bg-surface shadow-soft">
              <div className="px-4 py-3 text-sm text-sub">
                Digite para buscar veículos…
              </div>
            </div>
          ) : null}
        </form>

        <div className="flex items-center gap-2">
          <div className="hidden items-center md:flex">
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
