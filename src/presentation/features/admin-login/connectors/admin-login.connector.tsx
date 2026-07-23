"use client";

import { useAdminLoginModel } from "@/presentation/features/admin-login/hooks/use-admin-login-model";
import { AdminLoginView } from "@/presentation/features/admin-login/ui/admin-login.view";
import type { BrandingInput } from "@/presentation/shared/branding/branding.view-model";

export const AdminLoginConnector = ({
  branding = {},
  successPath = "/admin",
}: {
  readonly branding?: BrandingInput;
  readonly successPath?: string;
}) => {
  const viewProps = useAdminLoginModel(successPath, branding);
  return <AdminLoginView {...viewProps} />;
};
