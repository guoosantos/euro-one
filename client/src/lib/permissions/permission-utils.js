import { PERMISSION_REGISTRY } from "./registry";

const PERMISSION_LEVELS = new Set(["none", "view", "read", "full"]);
export function normalizePermissionLevel(level) {
  if (typeof level !== "string") return "none";
  const normalized = level.trim().toLowerCase();
  if (normalized === "view") return "read";
  return PERMISSION_LEVELS.has(normalized) ? normalized : "none";
}

function normalizeAccess(level) {
  const normalized = normalizePermissionLevel(level);
  if (normalized === "full") return "full";
  if (normalized === "read" || normalized === "view") return "read";
  return null;
}

function normalizeEntry(value) {
  if (typeof value === "string") {
    const level = normalizePermissionLevel(value);
    if (level === "none") return { visible: false, access: null };
    return { visible: true, access: level === "full" ? "full" : "read" };
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    if (Object.prototype.hasOwnProperty.call(value, "visible")) {
      const visible = Boolean(value.visible);
      const access = normalizeAccess(value.access);
      if (access === null && String(value.access || "").trim().toLowerCase() === "none") {
        return { visible: false, access: null };
      }
      return { visible, access: visible ? access || "read" : null };
    }
    const legacyLevel = normalizePermissionLevel(value.level);
    if (legacyLevel === "none") {
      return { visible: false, access: null };
    }
    return { visible: true, access: legacyLevel === "full" ? "full" : "read" };
  }
  return { visible: false, access: null };
}

function normalizeSubpages(subpages = {}) {
  const result = {};
  Object.entries(subpages || {}).forEach(([subKey, subValue]) => {
    result[subKey] = normalizeEntry(subValue);
  });
  return result;
}

export function normalizePermissionPayload(permissions = {}, registry = PERMISSION_REGISTRY) {
  const normalized = {};
  Object.entries(permissions || {}).forEach(([menuKey, pages]) => {
    const nextPages = {};
    Object.entries(pages || {}).forEach(([pageKey, value]) => {
      if (value && typeof value === "object" && !Array.isArray(value) && value.subpages) {
        const baseEntry = normalizeEntry(value);
        const subpages = normalizeSubpages(value.subpages || {});
        if (!baseEntry.visible) {
          Object.keys(subpages).forEach((subKey) => {
            subpages[subKey] = { visible: false, access: null };
          });
        }
        nextPages[pageKey] = { ...baseEntry, subpages };
        return;
      }
      nextPages[pageKey] = normalizeEntry(value);
    });
    normalized[menuKey] = nextPages;
  });

  if (registry) {
    registry.forEach((menu) => {
      const pages = normalized[menu.menuKey] || {};
      menu.pages.forEach((page) => {
        const entry = pages[page.pageKey] || { visible: false, access: null };
        if (page.subpages?.length) {
          const subpages = normalizeSubpages(entry.subpages || {});
          if (!entry.visible) {
            page.subpages.forEach((subpage) => {
              subpages[subpage.subKey] = { visible: false, access: null };
            });
          }
          pages[page.pageKey] = { ...entry, subpages };
        } else {
          pages[page.pageKey] = entry;
        }
      });
      normalized[menu.menuKey] = pages;
    });
  }

  return normalized;
}

export function buildPermissionEditorState(permissions = {}, registry = PERMISSION_REGISTRY) {
  const base = normalizePermissionPayload(permissions, registry);
  const next = {};

  registry.forEach((menu) => {
    const menuPermissions = base[menu.menuKey] || {};
    const pages = {};
    menu.pages.forEach((page) => {
      const current = menuPermissions[page.pageKey];
      const baseEntry = normalizeEntry(current);
      if (page.subpages?.length) {
        const subpages = normalizeSubpages(current?.subpages || {});
        if (!baseEntry.visible) {
          page.subpages.forEach((subpage) => {
            subpages[subpage.subKey] = { visible: false, access: null };
          });
        }
        pages[page.pageKey] = { ...baseEntry, subpages };
      } else {
        pages[page.pageKey] = baseEntry;
      }
    });
    next[menu.menuKey] = pages;
  });

  return next;
}
