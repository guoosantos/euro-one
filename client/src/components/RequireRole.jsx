import React from "react";
import { Navigate } from "react-router-dom";

import { useTenant } from "../lib/tenant-context.jsx";

export function RequireRole({ roles, children }) {
  const { user, loading, initialising } = useTenant();
  const allowed = !roles?.length || roles.includes(user?.role);

  if (loading || initialising) {
    return (
      <div className="flex min-h-[320px] items-center justify-center text-white/70">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" aria-label="Carregando" />
      </div>
    );
  }

  if (!allowed) {
    return <Navigate to="/dashboard" replace />;
  }

  return children;
}

export default RequireRole;
