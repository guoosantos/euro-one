function normalizeComparableText(value) {
  return String(value || "")
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

const SERVICE_STOCK_GROUP_KEY = "controle de servicos e estoque";

function resolvePermissionGroupScope(permissionGroup) {
  const attributes =
    permissionGroup && typeof permissionGroup.attributes === "object" && permissionGroup.attributes
      ? permissionGroup.attributes
      : {};
  const explicitScope = String(attributes.scope || "").trim();
  if (explicitScope) return explicitScope;
  if (attributes.isGlobal === true) return "global";
  return null;
}

function isServiceStockGlobalPermissionGroup(permissionGroupName, permissionGroupScope) {
  const normalizedName = normalizeComparableText(permissionGroupName);
  const normalizedScope = normalizeComparableText(permissionGroupScope);
  if (!normalizedName || !normalizedScope) return false;
  return normalizedScope === "global" && normalizedName.includes(SERVICE_STOCK_GROUP_KEY);
}

export function buildPermissionGroupMeta(permissionGroup) {
  if (!permissionGroup || typeof permissionGroup !== "object") {
    return {
      permissionGroupName: null,
      permissionGroupScope: null,
      permissionGroupIsServiceStockGlobal: false,
    };
  }

  const permissionGroupName =
    typeof permissionGroup.name === "string" && permissionGroup.name.trim()
      ? permissionGroup.name.trim()
      : null;
  const permissionGroupScope = resolvePermissionGroupScope(permissionGroup);

  return {
    permissionGroupName,
    permissionGroupScope,
    permissionGroupIsServiceStockGlobal: isServiceStockGlobalPermissionGroup(
      permissionGroupName,
      permissionGroupScope,
    ),
  };
}
