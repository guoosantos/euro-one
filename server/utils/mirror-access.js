function normalizeId(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === "string" || typeof value === "number") {
    const trimmed = String(value).trim();
    return trimmed ? trimmed : null;
  }
  if (typeof value === "object") {
    const candidate = value.id || value.clientId || value.ownerClientId || value.tenantId;
    if (candidate) {
      const normalized = String(candidate).trim();
      return normalized ? normalized : null;
    }
  }
  return null;
}

function collectIds(source, target) {
  if (!source) return;
  if (Array.isArray(source)) {
    source.forEach((value) => {
      const normalized = normalizeId(value);
      if (normalized) target.add(normalized);
    });
    return;
  }
  const normalized = normalizeId(source);
  if (normalized) {
    target.add(normalized);
  }
}

function extractIdsFromObject(source, target) {
  if (!source || typeof source !== "object") return;
  const keys = [
    "ownerClientIds",
    "mirrorOwnerIds",
    "clientIds",
    "clients",
    "tenantIds",
    "tenants",
    "ownerClientId",
  ];
  keys.forEach((key) => collectIds(source[key], target));
}

function resolveAccessMode(value) {
  if (!value || typeof value !== "object") return null;
  const mode = value.mode || value.access || value.scope;
  return mode ? String(mode).trim().toLowerCase() : null;
}

export function resolveAllowedMirrorOwnerIds(user) {
  if (!user || user.role === "admin") return null;

  const ids = new Set();
  let allowAll = false;
  let hasExplicitMirrorAccess = false;

  const mirrorAccess = user.attributes?.mirrorAccess;
  const userAccess = user.attributes?.userAccess;

  if (mirrorAccess !== undefined && mirrorAccess !== null) {
    if (typeof mirrorAccess === "object" && !Array.isArray(mirrorAccess)) {
      if (Object.keys(mirrorAccess).length > 0) {
        hasExplicitMirrorAccess = true;
      }
    } else {
      hasExplicitMirrorAccess = true;
    }
  }

  if (mirrorAccess === true || mirrorAccess === "all") {
    allowAll = true;
  }

  if (mirrorAccess && typeof mirrorAccess === "object") {
    const mode = resolveAccessMode(mirrorAccess);
    if (mode === "all") allowAll = true;
    if (mirrorAccess.allowAll === true || mirrorAccess.all === true) {
      allowAll = true;
    }
    extractIdsFromObject(mirrorAccess, ids);
  } else if (Array.isArray(mirrorAccess)) {
    collectIds(mirrorAccess, ids);
  }

  if (userAccess && typeof userAccess === "object") {
    if (Object.prototype.hasOwnProperty.call(userAccess, "mirrorAccess")) {
      const mirrorAccessValue = userAccess.mirrorAccess;
      if (mirrorAccessValue && typeof mirrorAccessValue === "object" && !Array.isArray(mirrorAccessValue)) {
        if (Object.keys(mirrorAccessValue).length > 0) {
          hasExplicitMirrorAccess = true;
        }
      } else if (mirrorAccessValue !== undefined && mirrorAccessValue !== null) {
        hasExplicitMirrorAccess = true;
      }
    }
    if (
      userAccess.ownerClientIds ||
      userAccess.mirrorOwnerIds ||
      userAccess.ownerClientId
    ) {
      hasExplicitMirrorAccess = true;
    }
    extractIdsFromObject(userAccess, ids);
    if (userAccess.mirrorAccess && typeof userAccess.mirrorAccess === "object") {
      const mode = resolveAccessMode(userAccess.mirrorAccess);
      if (mode === "all") allowAll = true;
      extractIdsFromObject(userAccess.mirrorAccess, ids);
    }
  }

  if (allowAll) return null;
  if (!hasExplicitMirrorAccess && ids.size === 0) return null;
  return Array.from(ids.values());
}

export default {
  resolveAllowedMirrorOwnerIds,
};
