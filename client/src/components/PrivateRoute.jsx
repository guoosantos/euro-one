import React from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useTenant } from "../lib/tenant-context";
import Loading from "./Loading.jsx";
import SessionError from "./SessionError.jsx";

export default function PrivateRoute() {
  const { isAuthenticated, initialising, loading, error, apiUnavailable } = useTenant();
  const location = useLocation();

  if (initialising || loading) {
    return <Loading message="Carregando sessão..." onRetry={() => window.location.reload()} />;
  }

  if (error || apiUnavailable) {
    const fallback = apiUnavailable ? new Error("API indisponível. Verifique o backend.") : error;
    return <SessionError error={fallback} />;
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  return <Outlet />;
}
