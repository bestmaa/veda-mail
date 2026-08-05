import type { MemberSettingsSnapshot } from "@/transport/client/api-client";

export const createAccountSettingsPolicy = (
  snapshot: MemberSettingsSnapshot | null,
) => ({
  passwordRestricted:
    snapshot?.organizationPolicy.memberPasswordChange === false,
  profileRestricted:
    snapshot?.organizationPolicy.memberProfileEditing === false,
  twoFactorDisabledReason:
    snapshot?.organizationPolicy.memberTwoFactorEnrollment === false &&
    !snapshot.security.twoFactorEnabled
      ? "Your organization has disabled new authenticator enrollments."
      : null,
});
