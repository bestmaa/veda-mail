import "server-only";

import type { MailAccount } from "@/domain/mail/mail";
import type { MailServiceProfile } from "@/domain/provider/provider";

export const anonymousMemberSession = {
  account: null,
  authenticated: false,
  service: null,
} as const;

export const memberSessionResponse = (
  account: MailAccount,
  profile: Pick<MailServiceProfile, "displayName" | "providerId">,
) => ({
  account,
  authenticated: true,
  service: {
    displayName: profile.displayName,
    providerId: profile.providerId,
  },
});

export const memberCookieOptions = {
  httpOnly: true,
  path: "/",
  sameSite: "lax",
  secure: process.env.NODE_ENV === "production",
} as const;
