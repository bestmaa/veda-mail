import type {
  BrandingSnapshot,
  InstallationRecord,
} from "@/domain/installation/installation";
import { DEFAULT_PUBLIC_REPOSITORY_URL } from "@/domain/installation/installation";

export const installationBrandingSnapshot = (
  installation: InstallationRecord | null,
): BrandingSnapshot => ({
  accentColor: installation?.organization.accentColor ?? "#ff6b57",
  logoUrl: installation?.organization.logoFileName
    ? "/api/v1/branding/logo"
    : null,
  organizationName:
    installation?.organization.organizationName ?? "Your organization",
  primaryColor: installation?.organization.primaryColor ?? "#27276f",
  productName: installation?.organization.productName ?? "Veda Mail",
  publicRepositoryUrl:
    installation?.organization.publicRepositoryUrl ??
    DEFAULT_PUBLIC_REPOSITORY_URL,
});
