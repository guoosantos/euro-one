import React from "react";
import { Navigate } from "react-router-dom";

import { useTenant } from "../lib/tenant-context.jsx";
import Loading from "./Loading.jsx";

export function RequireRole({ roles, children }) {
  const { user, loading, initialising } = useTenant();
  const allowed = !roles?.length || roles.includes(user?.role);

  if (loading || initialising) {
    return <Loading message="Carregando..." />;
  }

  if (!allowed) {
    return <Navigate to="/dashboard" replace />;
  }

  return children;
}

export default RequireRole;
