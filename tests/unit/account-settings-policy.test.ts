import { describe, expect, it } from "vitest";

import { createAccountSettingsPolicy } from "@/presentation/features/mail-workspace/account-settings-policy";
import type { MemberSettingsSnapshot } from "@/transport/client/api-client";

const snapshot = (
  twoFactorEnabled: boolean,
): MemberSettingsSnapshot => ({
  attachmentCapability: { status: "unsupported" },
  capabilities: {
    mail: {
      maxAttachmentBytes: 0,
      maxAttachmentDownloadBytes: 0,
      supportsAttachmentDownload: false,
      supportsDrafts: false,
      supportsPasswordChange: false,
      supportsProfileSettings: false,
      supportsPush: false,
      supportsServerSearch: false,
      supportsThreads: false,
      supportsTwoFactorAuthentication: false,
    },
    passwordChange: false,
    profileSettings: false,
    twoFactorAuthentication: twoFactorEnabled,
  },
  organizationPolicy: {
    memberPasswordChange: false,
    memberProfileEditing: false,
    memberTwoFactorEnrollment: false,
  },
  profile: { displayName: "Member", email: "member@example.com" },
  security: { twoFactorEnabled },
});

describe("account settings organization policy", () => {
  it("explains disabled self-service controls", () => {
    expect(createAccountSettingsPolicy(snapshot(false))).toEqual({
      passwordRestricted: true,
      profileRestricted: true,
      twoFactorDisabledReason:
        "Your organization has disabled new authenticator enrollments.",
    });
  });

  it("keeps the disable path visible for an account with existing 2FA", () => {
    expect(
      createAccountSettingsPolicy(snapshot(true)).twoFactorDisabledReason,
    ).toBeNull();
  });
});
