import "server-only";

import type { MailServiceProfileInput } from "@/domain/provider/provider";
import { parseOrganizationForm } from "@/server/branding/organization-form";
import { mailServiceProfileInputSchema } from "@/server/mail-service/mail-service-profile.schema";
import { setupInputSchema } from "@/server/installation/installation.schema";
import { ApiError } from "@/transport/http/api-error";

export interface ParsedSetupForm {
  readonly adminPassword: string;
  readonly adminUsername: string;
  readonly logo: Buffer | null | undefined;
  readonly mailProfile: MailServiceProfileInput;
  readonly organization: Awaited<
    ReturnType<typeof parseOrganizationForm>
  >["organization"];
  readonly setupToken: string;
}

const requiredText = (form: FormData, name: string): string => {
  const value = form.get(name);
  if (typeof value !== "string") {
    throw new ApiError(`${name} is required.`, "INVALID_FORM", 400);
  }
  return value;
};

const parseJson = (value: string, field: string): unknown => {
  try {
    return JSON.parse(value);
  } catch {
    throw new ApiError(`${field} must be valid JSON.`, "INVALID_FORM", 400);
  }
};

const allowedDomains = (form: FormData): unknown => {
  const values = form
    .getAll("allowedDomains")
    .filter((value): value is string => typeof value === "string");
  if (values.length > 1) {
    return values;
  }
  const raw = values[0] ?? "";
  if (raw.trim().startsWith("[")) {
    return parseJson(raw, "allowedDomains");
  }
  return raw.split(/[\s,]+/).filter(Boolean);
};

export const parseSetupForm = async (
  form: FormData,
): Promise<ParsedSetupForm> => {
  const setup = setupInputSchema.parse({
    accentColor: requiredText(form, "accentColor"),
    adminPassword: requiredText(form, "adminPassword"),
    adminUsername: requiredText(form, "adminUsername"),
    organizationName: requiredText(form, "organizationName"),
    primaryColor: requiredText(form, "primaryColor"),
    productName: requiredText(form, "productName"),
    publicRepositoryUrl:
      typeof form.get("publicRepositoryUrl") === "string"
        ? form.get("publicRepositoryUrl")
        : undefined,
    setupToken: requiredText(form, "setupToken"),
  });
  const branding = await parseOrganizationForm(form);
  const config = parseJson(requiredText(form, "providerConfig"), "providerConfig");
  const mailProfile = mailServiceProfileInputSchema.parse({
    allowedDomains: allowedDomains(form),
    config,
    displayName: requiredText(form, "providerDisplayName"),
    providerId: requiredText(form, "providerId"),
  });
  return {
    adminPassword: setup.adminPassword,
    adminUsername: setup.adminUsername,
    logo: branding.logo,
    mailProfile,
    organization: branding.organization,
    setupToken: setup.setupToken,
  };
};
