import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createClient } from "redis";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { AdminMailUserCreateResult } from "@/domain/admin/mail-user";
import { mailUserIdempotencyFilePath } from
  "@/server/mail-users/mail-user-idempotency-file";
import { mailUserIdempotencyStore } from
  "@/server/mail-users/mail-user-idempotency-store";
import { sharedRecordRepository } from
  "@/server/shared-state/shared-record-repository";
import { resetSharedStateRedisClientForTests } from
  "@/server/shared-state/shared-state-redis";

const redisUrl = process.env["VEDA_MAIL_TEST_REDIS_URL"];
const prefix = `veda-mail:test:mail-user-idempotency:${crypto.randomUUID()}`;
const kind = "mail-user-idempotency" as const;
const fingerprint = "A".repeat(43);
const migratedKey = "11111111-1111-4111-8111-111111111111";
const sharedKey = "22222222-2222-4222-8222-222222222222";
const uncertainKey = "33333333-3333-4333-8333-333333333333";
const retryKey = "44444444-4444-4444-8444-444444444444";
const lostKey = "55555555-5555-4555-8555-555555555555";
const privateEmail = "private-provisioned@example.com";
const result: AdminMailUserCreateResult = {
  outcome: "created",
  user: {
    aliases: [],
    createdAt: "2026-08-13T00:00:00.000Z",
    displayName: "Private User",
    email: privateEmail,
    id: "private-provider-id",
    locale: null,
    maxDiskQuota: null,
    timeZone: null,
    usedDiskQuota: 0,
  },
};

describe.skipIf(!redisUrl)("live shared mailbox provisioning idempotency", () => {
  const inspector = createClient({ url: redisUrl! });
  let directory = "";
  const clear = async () => {
    const keys = await inspector.keys(`${prefix}:*`);
    if (keys.length > 0) await inspector.del(keys);
  };

  beforeAll(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), "veda-shared-user-idem-"));
    process.env["VEDA_MAIL_DATA_DIR"] = directory;
    process.env["VEDA_MAIL_JOB_KEY"] = Buffer.alloc(32, 61).toString("base64");
    const begun = await mailUserIdempotencyStore.begin(migratedKey, fingerprint);
    if (begun.kind !== "owner") throw new Error("Expected local owner.");
    await mailUserIdempotencyStore.complete(
      migratedKey, fingerprint, begun.token, result,
    );
    process.env["VEDA_MAIL_STATE_REDIS_URL"] = redisUrl;
    process.env["VEDA_MAIL_STATE_REDIS_PREFIX"] = prefix;
    await inspector.connect();
    await clear();
  });

  afterAll(async () => {
    mailUserIdempotencyStore.clearMemoryForTests();
    resetSharedStateRedisClientForTests();
    await clear();
    inspector.destroy();
    await rm(directory, { force: true, recursive: true });
    delete process.env["VEDA_MAIL_DATA_DIR"];
    delete process.env["VEDA_MAIL_JOB_KEY"];
    delete process.env["VEDA_MAIL_STATE_REDIS_URL"];
    delete process.env["VEDA_MAIL_STATE_REDIS_PREFIX"];
  });

  it("migrates ciphertext and coalesces a cross-replica claim", async () => {
    const replay = await mailUserIdempotencyStore.begin(migratedKey, fingerprint);
    expect(replay).toEqual({ kind: "replay", result });
    const archive = `${mailUserIdempotencyFilePath()}.migrated-to-redis`;
    expect(await readFile(archive, "utf8")).toContain(privateEmail);
    await expect(stat(mailUserIdempotencyFilePath()))
      .rejects.toMatchObject({ code: "ENOENT" });

    const first = await mailUserIdempotencyStore.begin(sharedKey, fingerprint);
    expect(first.kind).toBe("owner");
    mailUserIdempotencyStore.clearMemoryForTests();
    resetSharedStateRedisClientForTests();
    const second = await mailUserIdempotencyStore.begin(sharedKey, fingerprint);
    expect(second.kind).toBe("pending");
    if (first.kind !== "owner" || second.kind !== "pending") {
      throw new Error("Expected owner and pending claims.");
    }
    await mailUserIdempotencyStore.complete(
      sharedKey, fingerprint, first.token, result,
    );
    await expect(second.outcome).resolves.toEqual({ kind: "completed", result });
    await expect(mailUserIdempotencyStore.begin(sharedKey, fingerprint))
      .resolves.toEqual({ kind: "replay", result });

    const uncertain = await mailUserIdempotencyStore.begin(uncertainKey, fingerprint);
    if (uncertain.kind !== "owner") throw new Error("Expected uncertain owner.");
    await mailUserIdempotencyStore.fail(
      uncertainKey, fingerprint, uncertain.token, new Error("unknown"), true,
    );
    await expect(mailUserIdempotencyStore.begin(uncertainKey, fingerprint))
      .resolves.toEqual({ kind: "orphaned" });
    const retry = await mailUserIdempotencyStore.begin(retryKey, fingerprint);
    if (retry.kind !== "owner") throw new Error("Expected retry owner.");
    await mailUserIdempotencyStore.fail(
      retryKey, fingerprint, retry.token, new Error("definite"), false,
    );
    await expect(mailUserIdempotencyStore.begin(retryKey, fingerprint))
      .resolves.toMatchObject({ kind: "owner" });
    const lost = await mailUserIdempotencyStore.begin(lostKey, fingerprint);
    if (lost.kind !== "owner") throw new Error("Expected lost owner.");
    await mailUserIdempotencyStore.fail(
      lostKey, fingerprint, lost.token, new Error("lost"), false,
    );
    await expect(mailUserIdempotencyStore.complete(
      lostKey, fingerprint, lost.token, result,
    )).rejects.toMatchObject({ code: "MAIL_USER_CREATE_OUTCOME_UNKNOWN" });

    const keys = await inspector.keys(`${prefix}:*`);
    const surface = JSON.stringify({ keys, values: await inspector.mGet(keys) });
    for (const plaintext of [
      privateEmail, "private-provider-id", fingerprint, first.token,
      "displayName", "completed",
    ]) expect(surface).not.toContain(plaintext);

    const serialized = await sharedRecordRepository.get(kind);
    const recordKey = keys.find((key) => key.endsWith(":value"))!;
    await inspector.set(recordKey, "x".repeat(3 * 1_024 * 1_024 + 1));
    mailUserIdempotencyStore.clearMemoryForTests();
    resetSharedStateRedisClientForTests();
    await expect(mailUserIdempotencyStore.begin(sharedKey, fingerprint))
      .rejects.toThrow();
    await inspector.set(recordKey, serialized!);

    process.env["VEDA_MAIL_JOB_KEY"] = Buffer.alloc(32, 62).toString("base64");
    mailUserIdempotencyStore.clearMemoryForTests();
    resetSharedStateRedisClientForTests();
    await expect(mailUserIdempotencyStore.begin(sharedKey, fingerprint))
      .rejects.toThrow();
    process.env["VEDA_MAIL_JOB_KEY"] = Buffer.alloc(32, 61).toString("base64");

    const tampered = JSON.parse(serialized!);
    tampered.tag = `${tampered.tag.startsWith("A") ? "B" : "A"}${tampered.tag.slice(1)}`;
    await inspector.set(recordKey, JSON.stringify(tampered));
    mailUserIdempotencyStore.clearMemoryForTests();
    resetSharedStateRedisClientForTests();
    await expect(mailUserIdempotencyStore.begin(sharedKey, fingerprint))
      .rejects.toThrow();
  });
});
