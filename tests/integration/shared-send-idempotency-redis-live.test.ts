import { createClient } from "redis";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { id } from "@/domain/shared/brand";
import { connectionStore } from "@/server/connections/connection-store";
import { sharedSendIdempotencyStore } from
  "@/server/mail/shared-send-idempotency-store";
import { resetSharedStateRedisClientForTests } from
  "@/server/shared-state/shared-state-redis";

const redisUrl = process.env["VEDA_MAIL_TEST_REDIS_URL"];
const prefix = `veda-mail:test:send-idempotency:${crypto.randomUUID()}`;
const originals = {
  key: process.env["VEDA_MAIL_JOB_KEY"],
  prefix: process.env["VEDA_MAIL_STATE_REDIS_PREFIX"],
  url: process.env["VEDA_MAIL_STATE_REDIS_URL"],
};
const receipt = {
  deliveryNoticeId: "55555555-5555-4555-8555-555555555555",
  deliveryStatus: "accepted" as const,
  id: id.message("shared-receipt"), rejectedRecipients: [],
  submittedAt: "2026-08-12T14:00:00.000Z",
};

describe.skipIf(!redisUrl)("live shared send idempotency", () => {
  const inspector = createClient({ url: redisUrl! });
  const cleanup = async () => {
    const keys = await inspector.keys(`${prefix}:*`);
    if (keys.length > 0) await inspector.del(keys);
  };
  beforeAll(async () => {
    process.env["VEDA_MAIL_JOB_KEY"] = Buffer.alloc(32, 41).toString("base64");
    process.env["VEDA_MAIL_STATE_REDIS_PREFIX"] = prefix;
    process.env["VEDA_MAIL_STATE_REDIS_URL"] = redisUrl;
    await inspector.connect(); await cleanup();
  });
  afterAll(async () => {
    resetSharedStateRedisClientForTests(); await cleanup(); inspector.destroy();
    for (const [name, value] of Object.entries(originals)) {
      const key = name === "key" ? "VEDA_MAIL_JOB_KEY"
        : name === "prefix" ? "VEDA_MAIL_STATE_REDIS_PREFIX"
          : "VEDA_MAIL_STATE_REDIS_URL";
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });

  const createConnection = () => connectionStore.createAsync({
    config: { email: "member@example.com", password: "private-password" },
    displayName: "Shared mailbox", providerId: id.provider("mock"),
  }, "profile-revision", { clientLabel: "Redis replica", ownerKey: "o".repeat(43) });

  it("admits one owner and shares its encrypted completion", async () => {
    const connection = await createConnection();
    const draftId = id.draft("11111111-1111-4111-8111-111111111111");
    const fingerprint = "a".repeat(64);
    const begun = await Promise.all(Array.from({ length: 4 }, () =>
      connectionStore.beginSendIfActiveAsync(connection, draftId, fingerprint)));
    const owners = begun.filter((item) => item.kind === "owner");
    const pending = begun.filter((item) => item.kind === "pending");
    expect(owners).toHaveLength(1); expect(pending).toHaveLength(3);
    resetSharedStateRedisClientForTests();
    await expect(sharedSendIdempotencyStore.complete(connection.id, draftId,
      owners[0]!.token, receipt)).resolves.toEqual(receipt);
    await expect(Promise.all(pending.map((item) => item.outcome)))
      .resolves.toEqual(Array(3).fill({ kind: "completed", receipt }));
    resetSharedStateRedisClientForTests();
    await expect(connectionStore.beginSendIfActiveAsync(connection, draftId, fingerprint))
      .resolves.toEqual({ kind: "replay", receipt });
    await expect(connectionStore.beginSendIfActiveAsync(connection, draftId, "b".repeat(64)))
      .resolves.toEqual({ kind: "conflict" });

    const keys = await inspector.keys(`${prefix}:job:send-idempotency:*`);
    const values = await Promise.all(keys.filter((key) => key.includes(":owner:"))
      .map((key) => inspector.get(key)));
    const surface = JSON.stringify({ keys, values });
    expect(surface).not.toContain(connection.id);
    expect(surface).not.toContain(draftId);
    expect(surface).not.toContain("private-password");
    expect(surface).not.toContain(receipt.id);
  });

  it("rejects stale tokens, clears revoked work, and fails closed on tampering", async () => {
    const connection = await createConnection();
    const firstDraft = id.draft("22222222-2222-4222-8222-222222222222");
    const first = await sharedSendIdempotencyStore.begin(connection.id, firstDraft,
      "c".repeat(64), Date.now() + 60_000);
    expect(first.kind).toBe("owner");
    if (first.kind !== "owner") throw new Error("Expected owner claim.");
    await expect(sharedSendIdempotencyStore.fail(connection.id, firstDraft, first.token))
      .resolves.toBe(true);
    const second = await sharedSendIdempotencyStore.begin(connection.id, firstDraft,
      "c".repeat(64), Date.now() + 60_000);
    expect(second.kind).toBe("owner");
    await expect(sharedSendIdempotencyStore.complete(connection.id, firstDraft,
      first.token, receipt)).resolves.toBeNull();

    const pendingDraft = id.draft("33333333-3333-4333-8333-333333333333");
    const pendingOwner = await sharedSendIdempotencyStore.begin(connection.id,
      pendingDraft, "d".repeat(64), Date.now() + 60_000);
    const waiter = await sharedSendIdempotencyStore.begin(connection.id,
      pendingDraft, "d".repeat(64), Date.now() + 60_000);
    expect(pendingOwner.kind).toBe("owner"); expect(waiter.kind).toBe("pending");
    await connectionStore.removeAsync(connection.id);
    if (waiter.kind !== "pending") throw new Error("Expected pending waiter.");
    await expect(waiter.outcome).resolves.toEqual({ kind: "orphaned" });

    const tampered = await createConnection();
    const tamperedDraft = id.draft("44444444-4444-4444-8444-444444444444");
    const beforeKeys = new Set(await inspector.keys(
      `${prefix}:job:send-idempotency:owner:*`));
    await sharedSendIdempotencyStore.begin(tampered.id, tamperedDraft,
      "e".repeat(64), Date.now() + 60_000);
    const recordKey = (await inspector.keys(
      `${prefix}:job:send-idempotency:owner:*`))
      .find((key) => !beforeKeys.has(key));
    expect(recordKey).toBeDefined();
    const envelope = JSON.parse((await inspector.get(recordKey!))!);
    envelope.tag = `${envelope.tag.startsWith("A") ? "B" : "A"}${
      envelope.tag.slice(1)
    }`;
    await inspector.set(recordKey!, JSON.stringify(envelope), { PX: 60_000 });
    resetSharedStateRedisClientForTests();
    await expect(sharedSendIdempotencyStore.begin(tampered.id, tamperedDraft,
      "e".repeat(64), Date.now() + 60_000)).rejects.toThrow();
  });
});
