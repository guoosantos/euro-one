export function matchesTenant(entity, tenantId) {
  if (tenantId === null || tenantId === undefined) return true;
  const normalizedTenant = String(tenantId);
  if (!entity || typeof entity !== "object") return false;

  const candidates = [
    entity.tenantId,
    entity.tenant?.id,
    entity.tenant?.tenantId,
    entity.groupId,
    entity.group?.id,
    entity.group?.groupId,
    entity.clientId,
    entity.client?.id,
    entity.customerId,
    entity.accountId,
    entity.device?.clientId,
    entity.vehicle?.clientId,
    entity.vehicle?.client?.id,
    entity.attributes?.tenantId,
    entity.attributes?.groupId,
    entity.attributes?.clientId,
  ].filter((value) => value !== undefined && value !== null);

  if (!candidates.length) return false;

  return candidates.some((value) => String(value) === normalizedTenant);
}
