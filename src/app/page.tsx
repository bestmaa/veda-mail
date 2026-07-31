import { redirect } from "next/navigation";

import { MailWorkspaceConnector } from "@/presentation/features/mail-workspace/connectors/mail-workspace.connector";
import { MemberLoginConnector } from "@/presentation/features/member-login/connectors/member-login.connector";
import { getCurrentConnection } from "@/server/connections/connection-session";
import { mailSessionScope } from "@/server/connections/mail-session-scope";
import { installationStore } from "@/server/installation/installation.store";
import { mailServiceProfileStore } from "@/server/mail-service/mail-service-profile.store";
import { loadAttachmentCapability } from "@/server/mail/attachment-service";

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
  const { maxAttachmentBytes } = await loadAttachmentCapability(connection);
  return (
    <MailWorkspaceConnector
      branding={branding}
      initialSessionScope={mailSessionScope(connection)}
      maxAttachmentBytes={maxAttachmentBytes}
      providerLabel={profile.displayName}
      signOutPath="/"
    />
  );
}
