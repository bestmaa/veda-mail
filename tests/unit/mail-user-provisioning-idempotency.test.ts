import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AdminMailUserCreateResult } from "@/domain/admin/mail-user";
import { ApiError } from "@/transport/http/api-error";

const mocks = vi.hoisted(() => ({ createUser: vi.fn() }));

vi.mock("@/server/mail-users/mail-user-administration", () => ({
  createAdminMailUser: mocks.createUser,
}));

import { mailUserIdempotencyFilePath } from "@/server/mail-users/mail-user-idempotency-file";
import {
  MAIL_USER_IDEMPOTENCY_TTL_MS,
  mailUserIdempotencyStore,
} from "@/server/mail-users/mail-user-idempotency-store";
import {
  mailUserProvisioningFingerprint,
  provisionAdminMailUser,
} from "@/server/mail-users/mail-user-provisioning";

const originalDataDirectory = process.env["VEDA_MAIL_DATA_DIR"];
let temporaryDirectory = "";

const result: AdminMailUserCreateResult = {
  outcome: "created",
  user: {
    aliases: [],
    createdAt: "2026-07-31T00:00:00.000Z",
    displayName: "Ada",
    email: "ada@example.com",
    id: "account-1",
    locale: null,
    maxDiskQuota: null,
    timeZone: null,
    usedDiskQuota: 0,
  },
};
const intent = {
  displayName: "Ada",
  email: "ada@example.com",
  password: "Exact Password 123",
};
const secret = "installation-session-secret";
const revision = "mail-service-revision";

beforeEach(async () => {
  temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "veda-user-idem-"));
  process.env["VEDA_MAIL_DATA_DIR"] = temporaryDirectory;
  mailUserIdempotencyStore.clearMemoryForTests();
  vi.clearAllMocks();
});

afterEach(async () => {
  vi.useRealTimers();
  mailUserIdempotencyStore.clearMemoryForTests();
  if (originalDataDirectory === undefined) delete process.env["VEDA_MAIL_DATA_DIR"];
  else process.env["VEDA_MAIL_DATA_DIR"] = originalDataDirectory;
  await rm(temporaryDirectory, { force: true, recursive: true });
});

describe("mailbox provisioning idempotency", () => {
  it("coalesces concurrent calls and durably replays the safe result", async () => {
    const deferred = Promise.withResolvers<AdminMailUserCreateResult>();
    mocks.createUser.mockReturnValue(deferred.promise);
    const key = "16161616-1616-4616-8616-161616161616";

    const first = provisionAdminMailUser(key, intent, secret, revision);
    await vi.waitFor(() => expect(mocks.createUser).toHaveBeenCalledOnce());
    const concurrent = provisionAdminMailUser(key, intent, secret, revision);
    deferred.resolve(result);

    await expect(Promise.all([first, concurrent])).resolves.toEqual([
      result,
      { ...result, replayed: true },
    ]);
    expect(mocks.createUser).toHaveBeenCalledOnce();
    expect(mocks.createUser).toHaveBeenCalledWith(intent, revision);

    mailUserIdempotencyStore.clearMemoryForTests();
    mocks.createUser.mockClear();
    await expect(
      provisionAdminMailUser(key, intent, secret, revision),
    ).resolves.toEqual({ ...result, replayed: true });
    expect(mocks.createUser).not.toHaveBeenCalled();

    const contents = await readFile(mailUserIdempotencyFilePath(), "utf8");
    expect(contents).not.toContain(intent.password);
    expect(contents).not.toContain(secret);
    expect((await stat(mailUserIdempotencyFilePath())).mode & 0o777).toBe(0o600);
  });

  it("replays across password re-entry but rejects changed public intent or profile", async () => {
    mocks.createUser.mockResolvedValue(result);
    const key = "26262626-2626-4626-8626-262626262626";
    await provisionAdminMailUser(key, intent, secret, revision);

    await expect(
      provisionAdminMailUser(
        key,
        { ...intent, password: "Different Password 456" },
        secret,
        revision,
      ),
    ).resolves.toEqual({ ...result, replayed: true });
    await expect(
      provisionAdminMailUser(
        key,
        { ...intent, displayName: "Grace" },
        secret,
        revision,
      ),
    ).rejects.toMatchObject({ code: "MAIL_USER_IDEMPOTENCY_CONFLICT" });
    await expect(
      provisionAdminMailUser(key, intent, secret, "new-profile-revision"),
    ).rejects.toMatchObject({ code: "MAIL_USER_IDEMPOTENCY_CONFLICT" });
    expect(mocks.createUser).toHaveBeenCalledOnce();
  });

  it("never reissues an orphaned durable pending operation", async () => {
    const deferred = Promise.withResolvers<AdminMailUserCreateResult>();
    mocks.createUser.mockReturnValue(deferred.promise);
    const key = "36363636-3636-4636-8636-363636363636";
    const first = provisionAdminMailUser(key, intent, secret, revision);
    await vi.waitFor(() => expect(mocks.createUser).toHaveBeenCalledOnce());

    mailUserIdempotencyStore.clearMemoryForTests();
    await expect(
      provisionAdminMailUser(key, intent, secret, revision),
    ).rejects.toMatchObject({ code: "MAIL_USER_CREATE_OUTCOME_UNKNOWN" });
    expect(mocks.createUser).toHaveBeenCalledOnce();

    deferred.resolve(result);
    await expect(first).resolves.toEqual(result);
  });

  it("preserves uncertain outcomes but permits retry after a definite failure", async () => {
    const uncertainKey = "46464646-4646-4646-8646-464646464646";
    mocks.createUser.mockRejectedValueOnce(
      new ApiError("safe", "MAIL_USER_CREATE_OUTCOME_UNKNOWN", 503),
    );
    await expect(
      provisionAdminMailUser(uncertainKey, intent, secret, revision),
    ).rejects.toMatchObject({ code: "MAIL_USER_CREATE_OUTCOME_UNKNOWN" });
    await expect(
      provisionAdminMailUser(uncertainKey, intent, secret, revision),
    ).rejects.toMatchObject({ code: "MAIL_USER_CREATE_OUTCOME_UNKNOWN" });
    expect(mocks.createUser).toHaveBeenCalledOnce();

    const retryKey = "56565656-5656-4656-8656-565656565656";
    mocks.createUser.mockRejectedValueOnce(
      new ApiError("safe", "MAIL_USER_ALREADY_EXISTS", 409),
    );
    await expect(
      provisionAdminMailUser(retryKey, intent, secret, revision),
    ).rejects.toMatchObject({ code: "MAIL_USER_ALREADY_EXISTS" });
    mocks.createUser.mockResolvedValueOnce(result);
    await expect(
      provisionAdminMailUser(retryKey, intent, secret, revision),
    ).resolves.toEqual(result);
  });

  it("uses a keyed non-secret digest without a password verifier", () => {
    const fingerprint = mailUserProvisioningFingerprint(intent, secret, revision);
    expect(fingerprint).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(fingerprint).not.toContain(intent.password);
    expect(
      mailUserProvisioningFingerprint(intent, "different-secret", revision),
    ).not.toBe(fingerprint);
    expect(
      mailUserProvisioningFingerprint(
        { ...intent, password: "Different Password 456" },
        secret,
        revision,
      ),
    ).toBe(fingerprint);
  });

  it("durably removes expired metadata during the next provisioning access", async () => {
    vi.useFakeTimers();
    const startedAt = Date.parse("2026-07-31T00:00:00.000Z");
    vi.setSystemTime(startedAt);
    mocks.createUser.mockResolvedValue(result);
    const expiredKey = "66666666-6666-4666-8666-666666666666";
    const liveKey = "76767676-7676-4676-8676-767676767676";

    await provisionAdminMailUser(expiredKey, intent, secret, revision);
    vi.setSystemTime(startedAt + 60 * 60 * 1_000);
    await provisionAdminMailUser(liveKey, intent, secret, revision);
    vi.setSystemTime(startedAt + MAIL_USER_IDEMPOTENCY_TTL_MS + 1);
    await provisionAdminMailUser(liveKey, intent, secret, revision);

    const ledger = JSON.parse(
      await readFile(mailUserIdempotencyFilePath(), "utf8"),
    ) as { readonly entries: Readonly<Record<string, unknown>> };
    expect(ledger.entries[expiredKey]).toBeUndefined();
    expect(ledger.entries[liveKey]).toBeDefined();
    expect(mocks.createUser).toHaveBeenCalledTimes(2);
  });
});
