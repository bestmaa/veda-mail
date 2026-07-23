import { redirect } from "next/navigation";

import { MailWorkspaceConnector } from "@/presentation/features/mail-workspace/connectors/mail-workspace.connector";
import { MemberLoginConnector } from "@/presentation/features/member-login/connectors/member-login.connector";
import { getCurrentConnection } from "@/server/connections/connection-session";
import { installationStore } from "@/server/installation/installation.store";
import { mailServiceProfileStore } from "@/server/mail-service/mail-service-profile.store";

export const dynamic = "force-dynamic";

export default async function Home() {
  if (!(await installationStore.isInstalled())) {
    redirect("/setup");
  }
  const branding = await installationStore.getBranding();
  const profile = await mailServiceProfileStore.get();
  if (!profile) {
    return <MemberLoginConnector branding={branding} isConfigured={false} />;
  }
  const connection = await getCurrentConnection().catch(() => null);
  if (!connection) {
    return (
      <MemberLoginConnector
        branding={branding}
        providerLabel={profile.displayName}
      />
    );
  }
  return (
    <MailWorkspaceConnector
      branding={branding}
      providerLabel={profile.displayName}
      signOutPath="/"
    />
  );
}
