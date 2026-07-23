import { redirect } from "next/navigation";

import { AdminLoginConnector } from "@/presentation/features/admin-login/connectors/admin-login.connector";
import { hasAdminAccess } from "@/server/auth/admin-session";
import { installationStore } from "@/server/installation/installation.store";

export const dynamic = "force-dynamic";

export default async function AdminLoginPage() {
  if (!(await installationStore.isInstalled())) {
    redirect("/setup");
  }
  if (await hasAdminAccess()) {
    redirect("/admin");
  }
  return (
    <AdminLoginConnector
      branding={await installationStore.getBranding()}
      successPath="/admin"
    />
  );
}
