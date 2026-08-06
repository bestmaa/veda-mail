"use client";

import { useAdminDashboardModel } from "@/presentation/features/admin-dashboard/hooks/use-admin-dashboard-model";
import { AdminDashboardView } from "@/presentation/features/admin-dashboard/ui/admin-dashboard.view";
import { AdminMailServiceConnector } from "@/presentation/features/admin-mail-service/connectors/admin-mail-service.connector";
import { AdminMailUsersConnector } from "@/presentation/features/admin-mail-users/connectors/admin-mail-users.connector";
import { AdminOrganizationConnector } from "@/presentation/features/admin-organization/connectors/admin-organization.connector";
import { AdminSecurityConnector } from "@/presentation/features/admin-security/connectors/admin-security.connector";
import { AdminCapabilitiesConnector } from "@/presentation/features/admin-capabilities/connectors/admin-capabilities.connector";
import { AdminMailPolicyConnector } from "@/presentation/features/admin-mail-policy/connectors/admin-mail-policy.connector";
import type { BrandingInput } from "@/presentation/shared/branding/branding.view-model";

export const AdminDashboardConnector = ({
  branding = {},
}: {
  readonly branding?: BrandingInput;
}) => {
  const model = useAdminDashboardModel(branding);
  const content =
    model.activeSection === "capabilities" ? (
      <div className="space-y-10">
        <AdminCapabilitiesConnector />
        <AdminMailPolicyConnector />
      </div>
    ) : model.activeSection === "mail" ? (
      <AdminMailServiceConnector />
    ) : model.activeSection === "users" ? (
      <AdminMailUsersConnector />
    ) : model.activeSection === "security" ? (
      <AdminSecurityConnector />
    ) : (
      <AdminOrganizationConnector />
    );
  return (
    <AdminDashboardView model={model}>
      {content}
    </AdminDashboardView>
  );
};
