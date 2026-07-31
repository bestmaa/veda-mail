import "server-only";

import type { MailUserAdministrationPort } from "@/application/ports/mail-user-administration.port";
import type {
  AdminMailUserCreateResult,
  MailUserAdministrationErrorCode,
} from "@/domain/admin/mail-user";
import { MailUserAdministrationError } from "@/domain/admin/mail-user";
import type { InstallationRecord } from "@/domain/installation/installation";
import { createStalwartMailUserAdministrator } from "@/infrastructure/providers/stalwart-jmap/stalwart-mail-user-administrator";
import { installationStore } from "@/server/installation/installation.store";
import { mailServiceProfileRevision } from "@/server/mail-service/mail-service-profile-revision";
import { ApiError } from "@/transport/http/api-error";

const providerError = new Map<
  MailUserAdministrationErrorCode,
  readonly [string, string, number]
>([
  ["configuration", ["MAIL_USER_ADMIN_CONFIGURATION", "Mailbox administration is not configured correctly.", 503]],
  ["create-outcome-unknown", ["MAIL_USER_CREATE_OUTCOME_UNKNOWN", "Stalwart could not confirm whether the mailbox was created. Check Stalwart before retrying.", 503]],
  ["domain-disabled", ["MAIL_USER_DOMAIN_DISABLED", "Mailbox creation is disabled for this domain.", 409]],
  ["domain-not-found", ["MAIL_USER_DOMAIN_NOT_FOUND", "The configured mail domain was not found in Stalwart.", 409]],
  ["duplicate", ["MAIL_USER_ALREADY_EXISTS", "That mailbox already exists.", 409]],
  ["external-directory", ["MAIL_USER_EXTERNAL_DIRECTORY", "This Stalwart instance uses an external directory; create the mailbox there.", 409]],
  ["invalid-input", ["MAIL_USER_INVALID_INPUT", "Stalwart rejected the mailbox details.", 400]],
  ["not-found", ["MAIL_USER_NOT_FOUND", "Mailbox user not found.", 404]],
  ["provider-auth", ["MAIL_USER_PROVIDER_AUTH", "Stalwart rejected the management credential.", 503]],
  ["provider-response", ["MAIL_USER_PROVIDER_RESPONSE", "Stalwart returned an invalid management response.", 502]],
  ["provider-unavailable", ["MAIL_USER_PROVIDER_UNAVAILABLE", "Stalwart mailbox administration is temporarily unavailable.", 503]],
]);

export const mapMailUserAdministrationError = (error: unknown): never => {
  if (error instanceof ApiError) throw error;
  if (error instanceof MailUserAdministrationError) {
    const mapped = providerError.get(error.code);
    if (mapped) throw new ApiError(mapped[1], mapped[0], mapped[2]);
  }
  throw error;
};

const currentInstallation = async (): Promise<InstallationRecord> => {
  const installation = await installationStore.get();
  if (!installation) {
    throw new ApiError("Complete setup first.", "SETUP_REQUIRED", 503);
  }
  return installation;
};

const selectedDomain = (
  installation: InstallationRecord,
  requested?: string,
): string => {
  const domain = requested ?? installation.mailProfile.allowedDomains[0];
  if (!domain || !installation.mailProfile.allowedDomains.includes(domain)) {
    throw new ApiError(
      "That domain is not managed by this Veda Mail installation.",
      "MAIL_USER_DOMAIN_FORBIDDEN",
      403,
    );
  }
  return domain;
};

type Resolution =
  | { readonly kind: "available"; readonly administrator: MailUserAdministrationPort }
  | { readonly kind: "unconfigured" | "unsupported" };

const resolve = (installation: InstallationRecord): Resolution => {
  if (installation.mailProfile.providerId !== "stalwart-jmap") {
    return { kind: "unsupported" };
  }
  const apiKey = process.env["VEDA_MAIL_STALWART_MANAGEMENT_API_KEY"]?.trim();
  const expectedOrigin = process.env[
    "VEDA_MAIL_STALWART_MANAGEMENT_ORIGIN"
  ]?.trim();
  if (!apiKey || !expectedOrigin) return { kind: "unconfigured" };
  const baseUrl = installation.mailProfile.config["baseUrl"];
  if (!baseUrl) {
    throw new ApiError(
      "Mailbox administration is not configured correctly.",
      "MAIL_USER_ADMIN_CONFIGURATION",
      503,
    );
  }
  try {
    const configured = new URL(expectedOrigin);
    const provider = new URL(baseUrl);
    if (
      configured.protocol !== "https:" ||
      configured.username ||
      configured.password ||
      configured.search ||
      configured.hash ||
      (configured.pathname !== "/" && configured.pathname !== "") ||
      configured.origin !== provider.origin
    ) {
      throw new Error("The management credential origin does not match.");
    }
    return {
      administrator: createStalwartMailUserAdministrator({
        allowedDomains: installation.mailProfile.allowedDomains,
        apiKey,
        baseUrl,
        expectedOrigin: configured.origin,
      }),
      kind: "available",
    };
  } catch {
    throw new ApiError(
      "Mailbox administration is not configured correctly.",
      "MAIL_USER_ADMIN_CONFIGURATION",
      503,
    );
  }
};

const unavailableReason = (kind: "unconfigured" | "unsupported"): string =>
  kind === "unconfigured"
    ? "Configure the server-side Stalwart management API credential and its bound origin."
    : "The active mail provider does not support mailbox administration.";

export const getAdminMailUsersSnapshot = async (input: {
  readonly cursor?: string;
  readonly domain?: string;
  readonly search?: string;
}) => {
  const installation = await currentInstallation();
  const domain = selectedDomain(installation, input.domain);
  const resolution = resolve(installation);
  const common = {
    adminTwoFactorEnabled: installation.owner.twoFactor !== null,
    allowedDomains: installation.mailProfile.allowedDomains,
  };
  if (resolution.kind !== "available") {
    return {
      ...common,
      creation: { available: false, reason: unavailableReason(resolution.kind) },
      nextCursor: null,
      status: resolution.kind,
      users: [],
    } as const;
  }
  try {
    const [creation, page] = await Promise.all([
      resolution.administrator.getCreationAvailability(domain),
      resolution.administrator.listUsers({
        ...(input.cursor ? { cursor: input.cursor } : {}),
        domain,
        limit: 50,
        ...(input.search ? { query: input.search } : {}),
      }),
    ]);
    return {
      ...common,
      creation: {
        available: creation.available,
        reason: creation.available
          ? null
          : creation.reason === "external-directory"
            ? "Accounts are owned by an external directory; create this mailbox there."
            : "Mailbox creation is disabled for this domain.",
      },
      nextCursor: page.nextCursor ?? null,
      status: "available" as const,
      users: page.items,
    };
  } catch (error) {
    return mapMailUserAdministrationError(error);
  }
};

const requireAdministrator = async (
  domain: string,
  expectedProfileRevision?: string,
) => {
  const installation = await currentInstallation();
  if (
    expectedProfileRevision &&
    mailServiceProfileRevision(installation.mailProfile) !==
      expectedProfileRevision
  ) {
    throw new ApiError(
      "The mail-service configuration changed. Review it and retry.",
      "MAIL_USER_PROFILE_CHANGED",
      409,
    );
  }
  selectedDomain(installation, domain);
  const resolution = resolve(installation);
  if (resolution.kind !== "available") {
    throw new ApiError(
      unavailableReason(resolution.kind),
      resolution.kind === "unconfigured"
        ? "MAIL_USER_ADMIN_UNCONFIGURED"
        : "MAIL_USER_ADMIN_UNSUPPORTED",
      resolution.kind === "unconfigured" ? 503 : 409,
    );
  }
  return resolution.administrator;
};

export const getAdminMailUser = async (domain: string, userId: string) => {
  try {
    return await (await requireAdministrator(domain)).getUser({ domain, userId });
  } catch (error) {
    return mapMailUserAdministrationError(error);
  }
};

export const createAdminMailUser = async (
  input: {
    readonly displayName?: string;
    readonly email: string;
    readonly password: string;
  },
  expectedProfileRevision: string,
): Promise<AdminMailUserCreateResult> => {
  const domain = input.email.slice(input.email.lastIndexOf("@") + 1);
  try {
    return await (
      await requireAdministrator(domain, expectedProfileRevision)
    ).createUser(input);
  } catch (error) {
    return mapMailUserAdministrationError(error);
  }
};
