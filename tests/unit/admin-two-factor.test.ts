import * as OTPAuth from "otpauth";
import { describe, expect, it } from "vitest";

import {
  adminTwoFactorEnrollmentStore,
  verifyAdminSecondFactor,
  withoutRecoveryCode,
} from "@/server/auth/admin-two-factor";

describe("administrator two-factor authentication", () => {
  it("encrypts the TOTP secret and verifies authenticator codes", async () => {
    const enrollment = await adminTwoFactorEnrollmentStore.create(
      7,
      "owner",
      "Veda Mail",
    );
    const totp = new OTPAuth.TOTP({
      algorithm: "SHA1",
      digits: 6,
      period: 30,
      secret: OTPAuth.Secret.fromBase32(
        enrollment.secret.replaceAll(" ", ""),
      ),
    });
    const sessionSecret = crypto.randomUUID() + crypto.randomUUID();
    const confirmed = adminTwoFactorEnrollmentStore.confirm(
      7,
      "owner",
      totp.generate(),
      sessionSecret,
    );

    expect(confirmed).not.toBeNull();
    expect(confirmed?.twoFactor.otpUrl.ciphertext).not.toContain("otpauth");
    expect(confirmed?.recoveryCodes).toHaveLength(10);
    expect(
      verifyAdminSecondFactor(
        totp.generate(),
        confirmed!.twoFactor,
        sessionSecret,
      ),
    ).toEqual({ recoveryCodeIndex: null, valid: true });
  });

  it("accepts each backup code once when it is consumed", async () => {
    const enrollment = await adminTwoFactorEnrollmentStore.create(
      8,
      "owner",
      "Veda Mail",
    );
    const totp = new OTPAuth.TOTP({
      algorithm: "SHA1",
      digits: 6,
      period: 30,
      secret: OTPAuth.Secret.fromBase32(
        enrollment.secret.replaceAll(" ", ""),
      ),
    });
    const sessionSecret = crypto.randomUUID() + crypto.randomUUID();
    const confirmed = adminTwoFactorEnrollmentStore.confirm(
      8,
      "owner",
      totp.generate(),
      sessionSecret,
    )!;
    const code = confirmed.recoveryCodes[0]!;
    const result = verifyAdminSecondFactor(
      code,
      confirmed.twoFactor,
      sessionSecret,
    );

    expect(result).toEqual({ recoveryCodeIndex: 0, valid: true });
    const consumed = withoutRecoveryCode(confirmed.twoFactor, 0);
    expect(
      verifyAdminSecondFactor(code, consumed, sessionSecret).valid,
    ).toBe(false);
    expect(
      verifyAdminSecondFactor(
        "not-a-real-code",
        confirmed.twoFactor,
        sessionSecret,
      ).valid,
    ).toBe(false);
  });
});
