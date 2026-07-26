import * as OTPAuth from "otpauth";
import { describe, expect, it } from "vitest";

import { id } from "@/domain/shared/brand";
import { twoFactorEnrollmentStore } from "@/server/auth/two-factor-enrollment";

describe("two-factor enrollment", () => {
  it("creates a scannable secret and verifies its current TOTP code", async () => {
    const connectionId = id.connection(crypto.randomUUID());
    const enrollment = await twoFactorEnrollmentStore.create(
      connectionId,
      "member@example.com",
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

    expect(enrollment.qrDataUrl).toMatch(/^data:image\/png;base64,/);
    expect(
      twoFactorEnrollmentStore.verify(connectionId, totp.generate()),
    ).toMatchObject({ otpUrl: expect.stringMatching(/^otpauth:\/\/totp\//) });
  });

  it("rejects an incorrect authenticator code", async () => {
    const connectionId = id.connection(crypto.randomUUID());
    await twoFactorEnrollmentStore.create(
      connectionId,
      "member@example.com",
      "Veda Mail",
    );

    expect(twoFactorEnrollmentStore.verify(connectionId, "000000")).toBeNull();
    twoFactorEnrollmentStore.remove(connectionId);
  });
});
