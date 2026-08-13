import "server-only";

import { randomBytes } from "node:crypto";

import type {
  InstallationRecord,
  OrganizationBranding,
  PasswordDigest,
} from "@/domain/installation/installation";
import type { MailServiceProfileInput } from "@/domain/provider/provider";
import { installationRecordSchema } from "@/server/installation/installation.schema";
import { mailServiceProfileInputSchema } from "@/server/mail-service/mail-service-profile.schema";

export const createInstallationRecord = (draft: {
  mailProfile: MailServiceProfileInput;
  organization: OrganizationBranding;
  owner: { password: PasswordDigest; username: string };
}): InstallationRecord => {
  const now = new Date().toISOString();
  return installationRecordSchema.parse({
    installedAt: now,
    mailProfile: {
      ...mailServiceProfileInputSchema.parse(draft.mailProfile),
      createdAt: now,
      updatedAt: now,
      version: 1,
    },
    organization: draft.organization,
    owner: {
      authVersion: 1,
      password: draft.owner.password,
      twoFactor: null,
      updatedAt: now,
      username: draft.owner.username,
    },
    sessionSecret: randomBytes(48).toString("base64url"),
    updatedAt: now,
    version: 1,
  });
};
