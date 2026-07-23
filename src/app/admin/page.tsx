import { redirect } from "next/navigation";

import { AdminLoginConnector } from "@/presentation/features/admin-login/connectors/admin-login.connector";
import { AdminDashboardConnector } from "@/presentation/features/admin-dashboard/connectors/admin-dashboard.connector";
import { hasAdminAccess } from "@/server/auth/admin-session";
import { installationStore } from "@/server/installation/installation.store";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  if (!(await installationStore.isInstalled())) {
    redirect("/setup");
  }
  const branding = await installationStore.getBranding();
  return (await hasAdminAccess()) ? (
    <AdminDashboardConnector branding={branding} />
  ) : (
    <AdminLoginConnector branding={branding} successPath="/admin" />
  );
}
