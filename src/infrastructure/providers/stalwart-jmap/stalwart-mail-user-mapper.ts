import "server-only";

import {
  MailUserAdministrationError,
  type AdminMailUserDetail,
  type AdminMailUserSummary,
} from "@/domain/admin/mail-user";
import type { StalwartUserAccount } from "@/infrastructure/providers/stalwart-jmap/stalwart-management-schema";

export interface ResolvedStalwartDomain {
  readonly directoryId: string | null;
  readonly id: string;
  readonly isEnabled: boolean;
  readonly name: string;
}

export const SAFE_ACCOUNT_PROPERTIES = [
  "@type",
  "id",
  "name",
  "domainId",
  "emailAddress",
  "createdAt",
  "usedDiskQuota",
  "quotas",
  "aliases",
  "description",
  "locale",
  "timeZone",
] as const;

export const normalizeMailDomain = (value: string): string =>
  value.trim().replace(/\.$/u, "").toLowerCase();

export const splitManagedEmail = (
  value: string,
): { readonly domain: string; readonly localPart: string } => {
  if (value.length > 320 || value.trim() !== value) {
    throw invalidInput();
  }
  const separator = value.lastIndexOf("@");
  const localPart = value.slice(0, separator);
  const domain = normalizeMailDomain(value.slice(separator + 1));
  if (
    separator < 1 ||
    localPart.length > 64 ||
    domain.length < 1 ||
    domain.length > 253 ||
    [...localPart].some(invalidLocalPartCharacter)
  ) {
    throw invalidInput();
  }
  return { domain, localPart };
};

export const invalidInput = (): MailUserAdministrationError =>
  new MailUserAdministrationError(
    "invalid-input",
    "The mailbox administration input is invalid.",
  );

export const validStalwartId = (value: string): boolean =>
  value.length > 0 && value.length <= 512 && value.trim() === value;

export const isStalwartUserRecord = (value: unknown): boolean =>
  typeof value === "object" &&
  value !== null &&
  "@type" in value &&
  value["@type"] === "User";

const invalidLocalPartCharacter = (character: string): boolean => {
  const code = character.charCodeAt(0);
  return character === "@" || /\s/u.test(character) || code < 32 || code === 127;
};

const aliasesForDomain = (
  account: StalwartUserAccount,
  domain: ResolvedStalwartDomain,
): readonly string[] => [
  ...new Set(
    (account.aliases ?? [])
      .filter(
        (alias) => alias.enabled !== false && alias.domainId === domain.id,
      )
      .map((alias) => `${alias.name}@${domain.name}`),
  ),
].sort((left, right) => left.localeCompare(right));

const assertAccountDomain = (
  account: StalwartUserAccount,
  domain: ResolvedStalwartDomain,
): void => {
  const emailDomain = splitManagedEmail(account.emailAddress).domain;
  if (account.domainId !== domain.id || emailDomain !== domain.name) {
    throw new MailUserAdministrationError(
      "provider-response",
      "The mail provider returned an invalid mailbox record.",
    );
  }
};

export const mapStalwartUserSummary = (
  account: StalwartUserAccount,
  domain: ResolvedStalwartDomain,
): AdminMailUserSummary => {
  assertAccountDomain(account, domain);
  const displayName = account.description?.trim() ?? "";
  return {
    aliases: aliasesForDomain(account, domain),
    createdAt: account.createdAt ?? null,
    displayName: displayName.length > 0 ? displayName : null,
    email: account.emailAddress,
    id: account.id,
    maxDiskQuota: account.quotas?.["maxDiskQuota"] ?? null,
    usedDiskQuota: account.usedDiskQuota ?? 0,
  };
};

export const mapStalwartUserDetail = (
  account: StalwartUserAccount,
  domain: ResolvedStalwartDomain,
): AdminMailUserDetail => ({
  ...mapStalwartUserSummary(account, domain),
  locale: account.locale ?? null,
  timeZone: account.timeZone ?? null,
});
