import { createClient } from "redis";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { SendReceipt } from "@/domain/mail/mail";
import { id } from "@/domain/shared/brand";
import { connectionStore } from "@/server/connections/connection-store";
import { sharedDeliveryNoticeStore } from
  "@/server/mail/shared-delivery-notice-store";
import { resetSharedStateRedisClientForTests } from
  "@/server/shared-state/shared-state-redis";

const redisUrl = process.env["VEDA_MAIL_TEST_REDIS_URL"];
const prefix = `veda-mail:test:delivery-notice:${crypto.randomUUID()}`;
const originals = {
  key: process.env["VEDA_MAIL_JOB_KEY"],
  prefix: process.env["VEDA_MAIL_STATE_REDIS_PREFIX"],
  url: process.env["VEDA_MAIL_STATE_REDIS_URL"],
};
const receipt = (
  deliveryNoticeId: string,
  recipient: string,
): SendReceipt => ({
  deliveryNoticeId,
  deliveryStatus: "partial",
  id: id.message(`message-${deliveryNoticeId}`),
  rejectedRecipients: [recipient],
  submittedAt: "2026-08-12T15:00:00.000Z",
});

describe.skipIf(!redisUrl)("live shared delivery notices", () => {
  const inspector = createClient({ url: redisUrl! });
  const cleanup = async () => {
    const keys = await inspector.keys(`${prefix}:*`);
    if (keys.length > 0) await inspector.del(keys);
  };
  beforeAll(async () => {
    process.env["VEDA_MAIL_JOB_KEY"] = Buffer.alloc(32, 53).toString("base64");
    process.env["VEDA_MAIL_STATE_REDIS_PREFIX"] = prefix;
    process.env["VEDA_MAIL_STATE_REDIS_URL"] = redisUrl;
    await inspector.connect();
    await cleanup();
  });
  afterAll(async () => {
    resetSharedStateRedisClientForTests();
    await cleanup();
    inspector.destroy();
    for (const [name, value] of Object.entries(originals)) {
      const key = name === "key" ? "VEDA_MAIL_JOB_KEY"
        : name === "prefix" ? "VEDA_MAIL_STATE_REDIS_PREFIX"
          : "VEDA_MAIL_STATE_REDIS_URL";
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  const createConnection = () => connectionStore.createAsync({
    config: { email: "member@example.com", password: "private-password" },
    displayName: "Shared mailbox",
    providerId: id.provider("mock"),
  }, "profile-revision", {
    clientLabel: "Redis replica",
    ownerKey: "n".repeat(43),
  });

  it("shares concurrent lifecycle operations without Redis plaintext", async () => {
    const connection = await createConnection();
    const first = receipt(
      "11111111-1111-4111-8111-111111111111",
      "rejected-one@example.com",
    );
    const second = receipt(
      "22222222-2222-4222-8222-222222222222",
      "rejected-two@example.com",
    );
    await expect(Promise.all([
      connectionStore.appendDeliveryNoticeIfActiveAsync(connection, first),
      connectionStore.appendDeliveryNoticeIfActiveAsync(connection, second),
      connectionStore.appendDeliveryNoticeIfActiveAsync(connection, first),
    ])).resolves.toEqual([true, true, true]);

    resetSharedStateRedisClientForTests();
    await expect(sharedDeliveryNoticeStore.list(connection.id)).resolves.toEqual([
      {
        deliveryNoticeId: first.deliveryNoticeId,
        kind: "partial",
        rejectedRecipients: first.rejectedRecipients,
        submittedAt: first.submittedAt,
      },
      {
        deliveryNoticeId: second.deliveryNoticeId,
        kind: "partial",
        rejectedRecipients: second.rejectedRecipients,
        submittedAt: second.submittedAt,
      },
    ]);

    const keys = await inspector.keys(`${prefix}:job:delivery-notice:*`);
    const values = await Promise.all(keys.filter((key) => key.includes(":owner:"))
      .map((key) => inspector.get(key)));
    const surface = JSON.stringify({ keys, values });
    expect(surface).not.toContain(connection.id);
    expect(surface).not.toContain("private-password");
    expect(surface).not.toContain("rejected-one@example.com");
    expect(surface).not.toContain(first.deliveryNoticeId);

    await sharedDeliveryNoticeStore.dismiss(connection.id, first.deliveryNoticeId!);
    resetSharedStateRedisClientForTests();
    await expect(sharedDeliveryNoticeStore.list(connection.id)).resolves.toEqual([
      expect.objectContaining({ deliveryNoticeId: second.deliveryNoticeId }),
    ]);
    await connectionStore.removeAsync(connection.id);
    await expect(sharedDeliveryNoticeStore.list(connection.id)).resolves.toEqual([]);
  });

  it("fails closed when an encrypted bucket is tampered with", async () => {
    const connection = await createConnection();
    const beforeKeys = new Set(await inspector.keys(
      `${prefix}:job:delivery-notice:owner:*`,
    ));
    await sharedDeliveryNoticeStore.append(
      connection.id,
      receipt(
        "33333333-3333-4333-8333-333333333333",
        "tamper-target@example.com",
      ),
      Date.now() + 60_000,
    );
    const recordKey = (await inspector.keys(
      `${prefix}:job:delivery-notice:owner:*`,
    )).find((key) => !beforeKeys.has(key));
    expect(recordKey).toBeDefined();
    const envelope = JSON.parse((await inspector.get(recordKey!))!);
    envelope.tag = `${envelope.tag.startsWith("A") ? "B" : "A"}${
      envelope.tag.slice(1)
    }`;
    await inspector.set(recordKey!, JSON.stringify(envelope), { PX: 60_000 });
    resetSharedStateRedisClientForTests();
    await expect(sharedDeliveryNoticeStore.list(connection.id)).rejects.toThrow();
  });
});
