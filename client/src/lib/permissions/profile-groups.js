function normalizeComparableText(value) {
  return String(value || "")
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

const SERVICE_STOCK_GROUP_KEY = "controle de servicos e estoque";

export function isServiceStockGlobalPermissionGroup(permissionContext) {
  if (!permissionContext || typeof permissionContext !== "object") return false;
  if (permissionContext.permissionGroupIsServiceStockGlobal === true) return true;
  const normalizedName = normalizeComparableText(permissionContext.permissionGroupName);
  const normalizedScope = normalizeComparableText(permissionContext.permissionGroupScope);
  if (!normalizedName || !normalizedScope) return false;
  return normalizedScope === "global" && normalizedName.includes(SERVICE_STOCK_GROUP_KEY);
}
