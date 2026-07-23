"use client";

import { useAdminOrganizationModel } from "@/presentation/features/admin-organization/hooks/use-admin-organization-model";
import { AdminOrganizationView } from "@/presentation/features/admin-organization/ui/admin-organization.view";

export const AdminOrganizationConnector = () => {
  const model = useAdminOrganizationModel();
  return <AdminOrganizationView {...model} />;
};
