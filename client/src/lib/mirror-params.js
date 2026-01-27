export function resolveMirrorClientParams({ params, tenantId, mirrorContextMode } = {}) {
  const baseParams = params && typeof params === "object" ? { ...params } : {};

  if (mirrorContextMode === "target") {
    if (Object.prototype.hasOwnProperty.call(baseParams, "clientId")) {
      delete baseParams.clientId;
    }
    if (Object.prototype.hasOwnProperty.call(baseParams, "tenantId")) {
      delete baseParams.tenantId;
    }
    if (Object.prototype.hasOwnProperty.call(baseParams, "ownerClientId")) {
      delete baseParams.ownerClientId;
    }
    return Object.keys(baseParams).length ? baseParams : undefined;
  }

  if (
    tenantId !== null &&
    tenantId !== undefined &&
    !baseParams.clientId &&
    !baseParams.tenantId &&
    !baseParams.ownerClientId
  ) {
    baseParams.clientId = tenantId;
  }

  return Object.keys(baseParams).length ? baseParams : undefined;
}

export function resolveMirrorOwnerClientId({ mirrorModeEnabled, mirrorOwnerClientId, mirrorContextMode } = {}) {
  if (!mirrorOwnerClientId) return null;
  if (mirrorModeEnabled === false) return null;
  if (mirrorContextMode && mirrorContextMode !== "target") return null;
  return String(mirrorOwnerClientId);
}

export function resolveMirrorHeaders({ mirrorModeEnabled, mirrorOwnerClientId, mirrorContextMode } = {}) {
  const ownerClientId = resolveMirrorOwnerClientId({ mirrorModeEnabled, mirrorOwnerClientId, mirrorContextMode });
  if (!ownerClientId) return undefined;
  return { "X-Owner-Client-Id": ownerClientId };
}

export default resolveMirrorClientParams;
