import "server-only";

import type { InstallationRecord } from "@/domain/installation/installation";
import {
  verifyAdminSecondFactor,
  withoutRecoveryCode,
} from "@/server/auth/admin-two-factor";
import { installationStore } from "@/server/installation/installation.store";
import { verifyAdminPasswordDigest } from "@/server/installation/password-hash";
import { ApiError } from "@/transport/http/api-error";

export interface AdminStepUpInput {
  readonly currentPassword: string;
  readonly otpCode?: string;
}

export interface AdminStepUpResult {
  readonly installation: InstallationRecord;
  readonly sessionRotated: boolean;
}

export const verifyAdminStepUp = async (
  input: AdminStepUpInput,
): Promise<AdminStepUpResult> => {
  const installation = await installationStore.get();
  if (!installation) {
    throw new ApiError("Complete setup first.", "SETUP_REQUIRED", 503);
  }
  if (
    !(await verifyAdminPasswordDigest(
      input.currentPassword,
      installation.owner.password,
    ))
  ) {
    throw new ApiError(
      "Administrator verification failed.",
      "ADMIN_STEP_UP_REJECTED",
      401,
    );
  }
  const twoFactor = installation.owner.twoFactor;
  if (!twoFactor) {
    return { installation, sessionRotated: false };
  }
  if (!input.otpCode) {
    throw new ApiError(
      "Enter an authenticator or backup code.",
      "ADMIN_SECOND_FACTOR_REQUIRED",
      401,
    );
  }
  const result = verifyAdminSecondFactor(
    input.otpCode,
    twoFactor,
    installation.sessionSecret,
  );
  if (!result.valid) {
    throw new ApiError(
      "Administrator verification failed.",
      "ADMIN_STEP_UP_REJECTED",
      401,
    );
  }
  if (result.recoveryCodeIndex === null) {
    return { installation, sessionRotated: false };
  }
  const updated = await installationStore.updateOwner(
    installation.owner.authVersion,
    {
      password: installation.owner.password,
      twoFactor: withoutRecoveryCode(
        twoFactor,
        result.recoveryCodeIndex,
      ),
      username: installation.owner.username,
    },
  );
  return { installation: updated, sessionRotated: true };
};
