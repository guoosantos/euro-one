import { useMemo } from "react";

import { isAdminGeneralClientName } from "../admin-general";
import { useTenant } from "../tenant-context.jsx";

export default function useAdminGeneralAccess() {
  const { role, user, tenant, tenants, homeClient } = useTenant();

  const sessionClient = useMemo(() => {
    if (homeClient) return homeClient;
    if (!user?.clientId) return tenant || null;
    const list = Array.isArray(tenants) ? tenants : [];
    return list.find((entry) => String(entry.id) === String(user.clientId)) || tenant || null;
  }, [homeClient, tenant, tenants, user?.clientId]);

  const isAdminGeneral = role === "admin" && isAdminGeneralClientName(sessionClient?.name);

  return useMemo(
    () => ({
      isAdminGeneral,
      sessionClient,
    }),
    [isAdminGeneral, sessionClient],
  );
}
