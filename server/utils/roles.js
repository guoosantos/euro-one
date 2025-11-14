export function mapTraccarUserToRole(user) {
  if (!user) return "user";
  if (user.administrator || user.administratorId === 0) {
    return "admin";
  }
  const attrRole = user?.attributes?.role;
  if (attrRole) {
    return String(attrRole);
  }
  if (user.userLimit && user.userLimit > 0) {
    return "manager";
  }
  if (user.deviceLimit && user.deviceLimit > 0) {
    return "manager";
  }
  return "driver";
}

export function canManageClients(role) {
  return role === "admin";
}

export function canManageUsers(role) {
  return role === "admin" || role === "manager";
}

export function canManageResources(role) {
  return role === "admin" || role === "manager";
}

export function buildUserPayload(traccarUser) {
  if (!traccarUser) return null;
  const role = mapTraccarUserToRole(traccarUser);
  return {
    id: traccarUser.id,
    name: traccarUser.name,
    email: traccarUser.email || traccarUser.login,
    phone: traccarUser.phone,
    readonly: Boolean(traccarUser.readonly),
    disabled: Boolean(traccarUser.disabled),
    deviceLimit: traccarUser.deviceLimit,
    userLimit: traccarUser.userLimit,
    attributes: traccarUser.attributes || {},
    role,
  };
}
