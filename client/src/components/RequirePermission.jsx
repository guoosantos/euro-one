import React from "react";
import { Navigate } from "react-router-dom";

import { usePermissionGate } from "../lib/permissions/permission-gate.js";

export default function RequirePermission({ permission, fallback = "/home", children }) {
  if (!permission) return children;
  const { hasAccess, loading } = usePermissionGate(permission);
  if (loading) return null;
  if (!hasAccess) {
    return <Navigate to={fallback} replace />;
  }
  return children;
}
