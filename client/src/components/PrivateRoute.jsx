import React from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useTenant } from "../lib/tenant-context";

export default function PrivateRoute() {
  const { isAuthenticated, initialising, loading } = useTenant();
  const location = useLocation();

  if (initialising || loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg text-text">
        <div className="flex flex-col items-center gap-4 text-center">
          <div className="h-10 w-10 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <p className="text-sm opacity-80">Carregando sessão…</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  return <Outlet />;
}
