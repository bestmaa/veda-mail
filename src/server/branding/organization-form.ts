import "server-only";

import {
  DEFAULT_PUBLIC_REPOSITORY_URL,
  type OrganizationBranding,
} from "@/domain/installation/installation";
import {
  brandLogoFileName,
  normalizeLogoUpload,
} from "@/server/branding/logo-store";
import { organizationBrandingInputSchema } from "@/server/installation/installation.schema";
import { ApiError } from "@/transport/http/api-error";

export interface ParsedOrganizationForm {
  readonly logo: Buffer | null | undefined;
  readonly organization: OrganizationBranding;
}

const requiredText = (form: FormData, name: string): string => {
  const value = form.get(name);
  if (typeof value !== "string") {
    throw new ApiError(`${name} is required.`, "INVALID_FORM", 400);
  }
  return value;
};

const optionalText = (form: FormData, name: string): string | undefined => {
  const value = form.get(name);
  return typeof value === "string" ? value : undefined;
};

export const parseOrganizationForm = async (
  form: FormData,
  current?: OrganizationBranding,
): Promise<ParsedOrganizationForm> => {
  const uploadedLogo = await normalizeLogoUpload(form.get("logo"));
  const removeLogo = optionalText(form, "removeLogo") === "true";
  if (uploadedLogo && removeLogo) {
    throw new ApiError(
      "Choose a new logo or remove the current one, not both.",
      "INVALID_LOGO_CHANGE",
      400,
    );
  }
  const repositoryValue =
    optionalText(form, "publicRepositoryUrl") ??
    current?.publicRepositoryUrl ??
    DEFAULT_PUBLIC_REPOSITORY_URL;
  const logo =
    uploadedLogo ?? (removeLogo ? null : undefined);
  return {
    logo,
    organization: organizationBrandingInputSchema.parse({
      accentColor: requiredText(form, "accentColor"),
      logoFileName: uploadedLogo
        ? brandLogoFileName(uploadedLogo)
        : removeLogo
          ? null
          : (current?.logoFileName ?? null),
      organizationName: requiredText(form, "organizationName"),
      primaryColor: requiredText(form, "primaryColor"),
      productName: requiredText(form, "productName"),
      publicRepositoryUrl: repositoryValue || null,
    }),
  };
};
