import { PERMISSION_REGISTRY } from "./registry";

const PERMISSION_LEVELS = new Set(["none", "view", "full"]);

export function normalizePermissionLevel(level) {
  if (typeof level !== "string") return "none";
  const normalized = level.trim().toLowerCase();
  return PERMISSION_LEVELS.has(normalized) ? normalized : "none";
}

export function normalizePermissionPayload(permissions = {}) {
  const normalized = {};
  Object.entries(permissions || {}).forEach(([menuKey, pages]) => {
    const nextPages = {};
    Object.entries(pages || {}).forEach(([pageKey, value]) => {
      if (typeof value === "string") {
        nextPages[pageKey] = normalizePermissionLevel(value);
        return;
      }
      if (value && typeof value === "object") {
        const subpages = {};
        Object.entries(value.subpages || {}).forEach(([subKey, subValue]) => {
          subpages[subKey] = normalizePermissionLevel(subValue);
        });
        nextPages[pageKey] = {
          ...value,
          level: normalizePermissionLevel(value.level),
          subpages,
        };
      }
    });
    normalized[menuKey] = nextPages;
  });
  return normalized;
}

export function buildPermissionEditorState(permissions = {}, registry = PERMISSION_REGISTRY) {
  const base = normalizePermissionPayload(permissions);
  const next = {};

  registry.forEach((menu) => {
    const menuPermissions = base[menu.menuKey] || {};
    const pages = {};
    menu.pages.forEach((page) => {
      const current = menuPermissions[page.pageKey];
      if (page.subpages?.length) {
        const currentObject =
          current && typeof current === "object" && !Array.isArray(current) ? current : {};
        const level = normalizePermissionLevel(
          typeof current === "string" ? current : currentObject.level,
        );
        const subpages = {};
        page.subpages.forEach((subpage) => {
          const subLevel = normalizePermissionLevel(currentObject.subpages?.[subpage.subKey]);
          subpages[subpage.subKey] = subLevel;
        });
        pages[page.pageKey] = { level, subpages };
      } else {
        pages[page.pageKey] = normalizePermissionLevel(current);
      }
    });
    next[menu.menuKey] = pages;
  });

  return next;
}
