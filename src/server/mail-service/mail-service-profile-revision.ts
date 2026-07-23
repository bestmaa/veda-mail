import "server-only";

import { createHash } from "node:crypto";

import type { MailServiceProfile } from "@/domain/provider/provider";

export const mailServiceProfileRevision = (
  profile: MailServiceProfile,
): string => {
  const payload = JSON.stringify([
    profile.version,
    profile.updatedAt,
    profile.providerId,
    profile.displayName,
    [...profile.allowedDomains].sort(),
    Object.entries(profile.config).sort(([left], [right]) =>
      left.localeCompare(right),
    ),
  ]);
  return createHash("sha256").update(payload).digest("base64url");
};
