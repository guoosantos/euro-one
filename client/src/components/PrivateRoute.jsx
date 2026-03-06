import React from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { BOOTSTRAP_STATUS, useTenant } from "../lib/tenant-context";
import Loading from "./Loading.jsx";
import SessionError from "./SessionError.jsx";

export default function PrivateRoute() {
  const {
    isAuthenticated,
    initialising,
    loading,
    error,
    apiUnavailable,
    bootstrapStatus,
    bootstrapError,
  } = useTenant();
  const location = useLocation();
  const bootstrapLoading = bootstrapStatus === BOOTSTRAP_STATUS.loading;
  const bootstrapFailed = bootstrapStatus === BOOTSTRAP_STATUS.failed;

  if (initialising || loading || bootstrapLoading) {
    return <Loading message="Carregando sessão..." onRetry={() => window.location.reload()} />;
  }

  if (bootstrapFailed) {
    return <SessionError error={bootstrapError || error} />;
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
