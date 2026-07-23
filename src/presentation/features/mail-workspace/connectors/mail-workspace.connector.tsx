"use client";

import { useMailWorkspaceModel } from "@/presentation/features/mail-workspace/hooks/use-mail-workspace-model";
import { MailWorkspaceView } from "@/presentation/features/mail-workspace/ui/mail-workspace.view";
import type { BrandingInput } from "@/presentation/shared/branding/branding.view-model";

export const MailWorkspaceConnector = ({
  branding = {},
  canSignOut = true,
  providerLabel = "Organization mail",
  signOutPath = "/login",
}: {
  readonly branding?: BrandingInput;
  readonly canSignOut?: boolean;
  readonly providerLabel?: string;
  readonly signOutPath?: string;
}) => {
  const viewProps = useMailWorkspaceModel({
    branding,
    canSignOut,
    providerLabel,
    signOutPath,
  });
  return <MailWorkspaceView {...viewProps} />;
};
