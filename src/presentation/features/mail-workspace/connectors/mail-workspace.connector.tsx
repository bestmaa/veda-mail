"use client";

import { useMailWorkspaceModel } from "@/presentation/features/mail-workspace/hooks/use-mail-workspace-model";
import { MailWorkspaceView } from "@/presentation/features/mail-workspace/ui/mail-workspace.view";
import type { BrandingInput } from "@/presentation/shared/branding/branding.view-model";

export const MailWorkspaceConnector = ({
  branding = {},
  canSignOut = true,
  maxAttachmentBytes = 0,
  providerLabel = "Organization mail",
  signOutPath = "/login",
}: {
  readonly branding?: BrandingInput;
  readonly canSignOut?: boolean;
  readonly maxAttachmentBytes?: number | null;
  readonly providerLabel?: string;
  readonly signOutPath?: string;
}) => {
  const viewProps = useMailWorkspaceModel({
    branding,
    canSignOut,
    maxAttachmentBytes,
    providerLabel,
    signOutPath,
  });
  return <MailWorkspaceView {...viewProps} />;
};
