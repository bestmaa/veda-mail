import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  updateOwner: vi.fn(),
  verifyPassword: vi.fn(),
  verifySecondFactor: vi.fn(),
  withoutRecoveryCode: vi.fn(),
}));

vi.mock("@/server/installation/installation.store", () => ({
  installationStore: {
    get: mocks.get,
    updateOwner: mocks.updateOwner,
  },
}));

vi.mock("@/server/installation/password-hash", () => ({
  verifyAdminPasswordDigest: mocks.verifyPassword,
}));

vi.mock("@/server/auth/admin-two-factor", () => ({
  verifyAdminSecondFactor: mocks.verifySecondFactor,
  withoutRecoveryCode: mocks.withoutRecoveryCode,
}));

import { verifyAdminStepUp } from "@/server/auth/admin-step-up";

const installation = (twoFactor: unknown = null) => ({
  owner: {
    authVersion: 4,
    password: { algorithm: "scrypt", digest: "digest", salt: "salt" },
    twoFactor,
    username: "owner",
  },
  sessionSecret: "session-secret",
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.verifyPassword.mockResolvedValue(true);
});

describe("administrator step-up verification", () => {
  it("fails closed when setup is unavailable or the password is wrong", async () => {
    mocks.get.mockResolvedValueOnce(null);
    await expect(
      verifyAdminStepUp({ currentPassword: "password" }),
    ).rejects.toMatchObject({ code: "SETUP_REQUIRED", status: 503 });

    mocks.get.mockResolvedValueOnce(installation());
    mocks.verifyPassword.mockResolvedValueOnce(false);
    await expect(
      verifyAdminStepUp({ currentPassword: "wrong" }),
    ).rejects.toMatchObject({ code: "ADMIN_STEP_UP_REJECTED", status: 401 });
  });

  it("accepts a verified password when two-factor authentication is off", async () => {
    const current = installation();
    mocks.get.mockResolvedValue(current);

    await expect(
      verifyAdminStepUp({ currentPassword: "password" }),
    ).resolves.toEqual({ installation: current, sessionRotated: false });
    expect(mocks.verifySecondFactor).not.toHaveBeenCalled();
  });

  it("requires and verifies the configured second factor", async () => {
    const twoFactor = { recoveryCodes: [] };
    mocks.get.mockResolvedValue(installation(twoFactor));

    await expect(
      verifyAdminStepUp({ currentPassword: "password" }),
    ).rejects.toMatchObject({ code: "ADMIN_SECOND_FACTOR_REQUIRED" });

    mocks.verifySecondFactor.mockReturnValue({
      recoveryCodeIndex: null,
      valid: false,
    });
    await expect(
      verifyAdminStepUp({ currentPassword: "password", otpCode: "123456" }),
    ).rejects.toMatchObject({ code: "ADMIN_STEP_UP_REJECTED" });
  });

  it("consumes a recovery code and reports that the session rotated", async () => {
    const twoFactor = { recoveryCodes: ["stored"] };
    const current = installation(twoFactor);
    const updated = { ...current, owner: { ...current.owner, authVersion: 5 } };
    mocks.get.mockResolvedValue(current);
    mocks.verifySecondFactor.mockReturnValue({
      recoveryCodeIndex: 0,
      valid: true,
    });
    mocks.withoutRecoveryCode.mockReturnValue({ recoveryCodes: [] });
    mocks.updateOwner.mockResolvedValue(updated);

    await expect(
      verifyAdminStepUp({ currentPassword: "password", otpCode: "backup" }),
    ).resolves.toEqual({ installation: updated, sessionRotated: true });
    expect(mocks.updateOwner).toHaveBeenCalledWith(4, {
      password: current.owner.password,
      twoFactor: { recoveryCodes: [] },
      username: "owner",
    });
  });
});
