import { redirect } from "next/navigation";

import { SetupWizardConnector } from "@/presentation/features/setup/connectors/setup-wizard.connector";
import { installationStore } from "@/server/installation/installation.store";

export const dynamic = "force-dynamic";

export default async function SetupPage() {
  if (await installationStore.isInstalled()) {
    redirect("/admin");
  }
  return <SetupWizardConnector />;
}
