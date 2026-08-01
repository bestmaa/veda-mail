import { beforeEach, describe, expect, it, vi } from "vitest";

const revocation = vi.hoisted(() => ({ publish: vi.fn() }));
vi.mock(
  "@/presentation/features/mail-workspace/member-session-revocation",
  () => ({ publishMemberSessionRevocation: revocation.publish }),
);

import {
  MEMBER_SESSION_RECOVERY_PURGE_ERROR,
  purgeInvalidatedSessionRecovery,
  purgeMemberSessionRecovery,
} from "@/presentation/features/mail-workspace/member-session-recovery";

beforeEach(() => revocation.publish.mockReset());

describe("member session recovery purge", () => {
  it("purges only the exact supplied session scope", async () => {
    const purgeScope = vi.fn().mockResolvedValue(undefined);

    await purgeMemberSessionRecovery("scope-a", { purgeScope });

    expect(purgeScope).toHaveBeenCalledOnce();
    expect(purgeScope).toHaveBeenCalledWith("scope-a");
  });

  it("fails closed when no exact scope is available", async () => {
    const purgeScope = vi.fn().mockResolvedValue(undefined);

    await expect(purgeMemberSessionRecovery("", { purgeScope })).rejects
      .toThrow(MEMBER_SESSION_RECOVERY_PURGE_ERROR);
    expect(purgeScope).not.toHaveBeenCalled();
  });

  it("allows sign-out when this browser has no recovery storage", async () => {
    await expect(purgeMemberSessionRecovery("scope-a", null)).resolves
      .toBeUndefined();
  });

  it("purges durable recovery when the pointer adapter is unavailable", async () => {
    const purgeScope = vi.fn().mockResolvedValue(undefined);

    await purgeMemberSessionRecovery("scope-a", null, { purgeScope });

    expect(purgeScope).toHaveBeenCalledOnce();
    expect(purgeScope).toHaveBeenCalledWith("scope-a");
  });

  it("retries durable purge after pointer cleanup becomes unavailable", async () => {
    const pointerPurge = vi.fn().mockRejectedValue(new Error("blocked"));
    const durablePurge = vi.fn().mockResolvedValue(undefined);

    await purgeMemberSessionRecovery(
      "scope-a",
      { purgeScope: pointerPurge },
      { purgeScope: durablePurge },
    );

    expect(pointerPurge).toHaveBeenCalledWith("scope-a");
    expect(durablePurge).toHaveBeenCalledWith("scope-a");
  });

  it("surfaces durable purge failure without leaking its details", async () => {
    const cause = new Error("IndexedDB internal detail");
    const purgeScope = vi.fn().mockRejectedValue(cause);

    const result = purgeMemberSessionRecovery("scope-a", { purgeScope });

    await expect(result).rejects.toMatchObject({
      cause,
      message: MEMBER_SESSION_RECOVERY_PURGE_ERROR,
    });
  });

  it("reports invalidation purge failure through its caller", async () => {
    const onFailure = vi.fn();
    const purgeRecovery = vi.fn().mockRejectedValue(new Error("unavailable"));

    purgeInvalidatedSessionRecovery("scope-a", onFailure, purgeRecovery);
    await Promise.resolve();

    expect(purgeRecovery).toHaveBeenCalledWith("scope-a");
    expect(revocation.publish).toHaveBeenCalledWith("scope-a", "invalidated");
    expect(onFailure).toHaveBeenCalledWith(
      MEMBER_SESSION_RECOVERY_PURGE_ERROR,
    );
  });

  it("does not publish or purge without an exact invalidated scope", () => {
    const purgeRecovery = vi.fn();

    purgeInvalidatedSessionRecovery("", vi.fn(), purgeRecovery);

    expect(revocation.publish).not.toHaveBeenCalled();
    expect(purgeRecovery).not.toHaveBeenCalled();
  });

  it("does not publish when invalidation cleanup cannot start", () => {
    const onFailure = vi.fn();
    const purgeRecovery = vi.fn(() => { throw new Error("blocked"); });

    purgeInvalidatedSessionRecovery("scope-a", onFailure, purgeRecovery);

    expect(revocation.publish).not.toHaveBeenCalled();
    expect(onFailure).toHaveBeenCalledWith(MEMBER_SESSION_RECOVERY_PURGE_ERROR);
  });
});
