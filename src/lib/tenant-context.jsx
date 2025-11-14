import React, { createContext, useContext, useMemo, useState } from "react";
import { tenants } from "../mock/fleet";

const TenantContext = createContext(null);

export function TenantProvider({ children }) {
  const [tenantId, setTenantId] = useState(tenants[0]?.id ?? null);

  const value = useMemo(() => {
    const tenant = tenants.find((item) => item.id === tenantId) ?? null;
    return {
      tenantId,
      setTenantId,
      tenant,
      tenants,
    };
  }, [tenantId]);

  return <TenantContext.Provider value={value}>{children}</TenantContext.Provider>;
}

export function useTenant() {
  const ctx = useContext(TenantContext);
  if (!ctx) {
    throw new Error("useTenant deve ser usado dentro de TenantProvider");
  }
  return ctx;
}
