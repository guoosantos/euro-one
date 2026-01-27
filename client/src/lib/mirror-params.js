export function resolveMirrorClientParams({ params, tenantId, mirrorContextMode, mirrorOwnerClientId } = {}) {
  const baseParams = params && typeof params === "object" ? { ...params } : {};

  if (mirrorOwnerClientId) {
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

export function resolveMirrorOwnerClientId({ mirrorModeEnabled, mirrorOwnerClientId } = {}) {
  if (!mirrorOwnerClientId) return null;
  if (mirrorModeEnabled === false) return null;
  return String(mirrorOwnerClientId);
}

export function resolveMirrorHeaders({ mirrorModeEnabled, mirrorOwnerClientId } = {}) {
  const ownerClientId = resolveMirrorOwnerClientId({ mirrorModeEnabled, mirrorOwnerClientId });
  if (!ownerClientId) return undefined;
  return { "X-Owner-Client-Id": ownerClientId };
}

export default resolveMirrorClientParams;
