"use client";

import { useMemberLoginModel } from "@/presentation/features/member-login/hooks/use-member-login-model";
import { MemberLoginView } from "@/presentation/features/member-login/ui/member-login.view";
import { SetupRequiredView } from "@/presentation/features/member-login/ui/setup-required.view";
import type { BrandingInput } from "@/presentation/shared/branding/branding.view-model";

interface MemberLoginConnectorProps {
  readonly adminHref?: string;
  readonly branding?: BrandingInput;
  readonly isConfigured?: boolean;
  readonly providerLabel?: string;
  readonly successPath?: string;
}

export const MemberLoginConnector = ({
  adminHref = "/admin",
  branding = {},
  isConfigured = true,
  providerLabel = "your organization mail service",
  successPath = "/",
}: MemberLoginConnectorProps) => {
  const viewProps = useMemberLoginModel(
    adminHref,
    branding,
    providerLabel,
    successPath,
  );
  return isConfigured ? (
    <MemberLoginView {...viewProps} />
  ) : (
    <SetupRequiredView adminHref="/setup" />
  );
};
