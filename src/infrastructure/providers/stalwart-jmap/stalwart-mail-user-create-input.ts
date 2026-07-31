import "server-only";

import type { AdminMailUserCreateInput } from "@/application/ports/mail-user-administration.port";
import type { AdminMailUserDetail } from "@/domain/admin/mail-user";
import {
  invalidInput,
  splitManagedEmail,
} from "@/infrastructure/providers/stalwart-jmap/stalwart-mail-user-mapper";

export interface NormalizedMailUserCreateInput {
  readonly displayName: string | null;
  readonly domain: string;
  readonly email: string;
  readonly localPart: string;
  readonly password: string;
}

export const normalizeMailUserCreateInput = (
  input: AdminMailUserCreateInput,
): NormalizedMailUserCreateInput => {
  const { domain, localPart } = splitManagedEmail(input.email);
  const displayName = input.displayName?.trim() ?? "";
  if (
    input.password.length < 1 ||
    input.password.length > 1_000 ||
    displayName.length > 120
  ) {
    throw invalidInput();
  }
  return {
    displayName: displayName || null,
    domain,
    email: `${localPart}@${domain}`,
    localPart,
    password: input.password,
  };
};

export const provisionalMailUser = (
  id: string,
  input: NormalizedMailUserCreateInput,
): AdminMailUserDetail => ({
  aliases: [],
  createdAt: null,
  displayName: input.displayName,
  email: input.email,
  id,
  locale: null,
  maxDiskQuota: null,
  timeZone: null,
  usedDiskQuota: 0,
});
