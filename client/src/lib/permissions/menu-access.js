import { PERMISSION_REGISTRY } from "./registry";
import { resolvePermissionEntry } from "./permission-gate";
import { normalizePermissionPayload } from "./permission-utils";

const PRESENTATION_ATTRIBUTE_KEYS = [
  "presentationPermissions",
  "presentation",
  "apresentacao",
  "apresentacaoPermissions",
  "menuPresentation",
  "menuPermissions",
  "presentationMenu",
  "menuConfig",
  "modules",
  "modulePermissions",
];

const KNOWN_PERMISSION_KEYS = (() => {
  const keys = new Set();
  PERMISSION_REGISTRY.forEach((menu) => {
    if (menu?.menuKey) keys.add(normalizeKey(menu.menuKey));
    (menu?.pages || []).forEach((page) => {
      if (page?.pageKey) keys.add(normalizeKey(page.pageKey));
      (page?.subpages || []).forEach((sub) => {
        if (sub?.subKey) keys.add(normalizeKey(sub.subKey));
      });
    });
  });
  return keys;
})();

function normalizeKey(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeFlagValue(value) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value > 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "on", "yes", "sim"].includes(normalized)) return true;
    if (["false", "0", "off", "no", "nao", "não"].includes(normalized)) return false;
  }
  return null;
}

function extractPresentationPermissions(attributes) {
  if (!attributes || typeof attributes !== "object") return null;
  for (const key of PRESENTATION_ATTRIBUTE_KEYS) {
    const candidate = attributes[key];
    if (!candidate || typeof candidate !== "object") continue;
    if (Array.isArray(candidate)) continue;
    return candidate;
  }
  return null;
}

function normalizePresentationPermissions(attributes) {
  const payload = extractPresentationPermissions(attributes);
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  return normalizePermissionPayload(payload, PERMISSION_REGISTRY);
}

function buildPermissionCandidates(permission) {
  if (!permission) return [];
  const menuKey = normalizeKey(permission.menuKey);
  const pageKey = normalizeKey(permission.pageKey);
  const subKey = normalizeKey(permission.subKey);
  const candidates = [];
  if (menuKey && pageKey && subKey) {
    candidates.push(`${menuKey}.${pageKey}.${subKey}`);
    candidates.push(`${menuKey}:${pageKey}:${subKey}`);
    candidates.push(`${menuKey}/${pageKey}/${subKey}`);
  }
  if (menuKey && pageKey) {
    candidates.push(`${menuKey}.${pageKey}`);
    candidates.push(`${menuKey}:${pageKey}`);
    candidates.push(`${menuKey}/${pageKey}`);
  }
  if (menuKey) candidates.push(menuKey);
  if (pageKey) candidates.push(pageKey);
  if (subKey) candidates.push(subKey);
  return candidates;
}

function hasKnownKeys(setOrMap) {
  if (!setOrMap) return false;
  const keys = Array.isArray(setOrMap) ? setOrMap : Object.keys(setOrMap);
  return keys.some((key) => KNOWN_PERMISSION_KEYS.has(normalizeKey(key)));
}

function resolveAllowlistDecision(allowlist, candidates) {
  if (!allowlist || !allowlist.size) return null;
  if (!hasKnownKeys(Array.from(allowlist))) return null;
  if (candidates.some((candidate) => allowlist.has(candidate))) return true;
  return false;
}

function resolveMapDecision(map, candidates) {
  if (!map || typeof map !== "object") return null;
  if (!hasKnownKeys(map)) return null;
  for (const candidate of candidates) {
    if (Object.prototype.hasOwnProperty.call(map, candidate)) {
      return normalizeFlagValue(map[candidate]);
    }
  }
  return null;
}

function normalizeFlagHints(raw) {
  if (!raw) return { allowlist: null, map: null };
  if (Array.isArray(raw)) {
    const normalized = new Set(raw.map(normalizeKey).filter(Boolean));
    return { allowlist: normalized.size ? normalized : null, map: null };
  }
  if (typeof raw === "object") {
    const map = {};
    Object.entries(raw).forEach(([key, value]) => {
      const normalizedKey = normalizeKey(key);
      if (!normalizedKey) return;
      map[normalizedKey] = value;
    });
    return Object.keys(map).length ? { allowlist: null, map } : { allowlist: null, map: null };
  }
  return { allowlist: null, map: null };
}

function resolveTenantModuleHints(attributes) {
  if (!attributes || typeof attributes !== "object") return { allowlist: null, map: null };
  const raw = attributes.modules ?? attributes.modulePermissions ?? null;
  return normalizeFlagHints(raw);
}

function resolveUserClaimHints(user) {
  const attributes = user?.attributes || {};
  const raw =
    user?.claims ??
    attributes.claims ??
    attributes.capabilities ??
    user?.capabilities ??
    null;
  return normalizeFlagHints(raw);
}

export function buildMenuAccessContext({ tenant, user } = {}) {
  const presentationPermissions = normalizePresentationPermissions(tenant?.attributes);
  const tenantHints = resolveTenantModuleHints(tenant?.attributes);
  const userHints = resolveUserClaimHints(user);
  return {
    presentationPermissions,
    tenantAllowlist: tenantHints.allowlist,
    tenantMap: tenantHints.map,
    userAllowlist: userHints.allowlist,
    userMap: userHints.map,
  };
}

export function canShowMenuItem({ permission, context } = {}) {
  if (!permission) return true;
  const candidates = buildPermissionCandidates(permission);
  if (!candidates.length) return true;

  if (context?.presentationPermissions) {
    const entry = resolvePermissionEntry(
      context.presentationPermissions,
      permission.menuKey,
      permission.pageKey,
      permission.subKey,
    );
    if (!entry?.visible) return false;
  }

  const tenantMapDecision = resolveMapDecision(context?.tenantMap, candidates);
  if (tenantMapDecision === false) return false;

  const tenantAllowDecision = resolveAllowlistDecision(context?.tenantAllowlist, candidates);
  if (tenantAllowDecision === false) return false;

  const userMapDecision = resolveMapDecision(context?.userMap, candidates);
  if (userMapDecision === false) return false;

  const userAllowDecision = resolveAllowlistDecision(context?.userAllowlist, candidates);
  if (userAllowDecision === false) return false;

  return true;
}

export default canShowMenuItem;
