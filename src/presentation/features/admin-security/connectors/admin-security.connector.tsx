"use client";

import { useAdminSecurityModel } from "@/presentation/features/admin-security/hooks/use-admin-security-model";
import { AdminSecurityView } from "@/presentation/features/admin-security/ui/admin-security.view";

export const AdminSecurityConnector = () => {
  const model = useAdminSecurityModel();
  return <AdminSecurityView {...model} />;
};
