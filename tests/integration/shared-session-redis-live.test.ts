import { createClient } from "redis";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { id } from "@/domain/shared/brand";
import { adminSessionStore } from "@/server/auth/admin-session-store";
import { connectionStore } from "@/server/connections/connection-store";
import { resetSharedStateRedisClientForTests } from
  "@/server/shared-state/shared-state-redis";

const redisUrl = process.env["VEDA_MAIL_TEST_REDIS_URL"];
const prefix = `veda-mail:test:session:${crypto.randomUUID()}`;
const jobKey = Buffer.alloc(32, 23).toString("base64");
const originalJobKey = process.env["VEDA_MAIL_JOB_KEY"];

describe.skipIf(!redisUrl)("live encrypted shared session repository", () => {
  const inspector = createClient({ url: redisUrl! });
  const deleteTestKeys = async (): Promise<void> => {
    const keys = await inspector.keys(`${prefix}:*`);
    if (keys.length > 0) await inspector.del(keys);
  };

  beforeAll(async () => {
    process.env["VEDA_MAIL_JOB_KEY"] = jobKey;
    process.env["VEDA_MAIL_STATE_REDIS_URL"] = redisUrl;
    process.env["VEDA_MAIL_STATE_REDIS_PREFIX"] = prefix;
    await inspector.connect();
    await deleteTestKeys();
  });

  afterAll(async () => {
    resetSharedStateRedisClientForTests();
    await deleteTestKeys();
    inspector.destroy();
    delete process.env["VEDA_MAIL_STATE_REDIS_URL"];
    delete process.env["VEDA_MAIL_STATE_REDIS_PREFIX"];
    if (originalJobKey === undefined) delete process.env["VEDA_MAIL_JOB_KEY"];
    else process.env["VEDA_MAIL_JOB_KEY"] = originalJobKey;
  });

  it("shares encrypted administrator sessions across client lifecycles", async () => {
    const sessionId = "a".repeat(24);
    await adminSessionStore.createAsync({
      authVersion: 4,
      expiresAt: Date.now() + 60 * 60_000,
      id: sessionId,
    });
    resetSharedStateRedisClientForTests();

    const touched = await Promise.all(Array.from({ length: 4 }, () =>
      adminSessionStore.getAsync(sessionId, 4)));
    expect(touched.every(Boolean)).toBe(true);
    expect((await adminSessionStore.listAsync(4)).map(({ id }) => id))
      .toContain(sessionId);

    const values = await Promise.all(
      (await inspector.keys(`${prefix}:*record*`)).map((key) => inspector.get(key)),
    );
    expect(JSON.stringify(values)).not.toContain(sessionId);
    expect(await adminSessionStore.removeAsync(sessionId)).toBe(true);
    resetSharedStateRedisClientForTests();
    await expect(adminSessionStore.getAsync(sessionId, 4)).resolves.toBeNull();
  });

  it("shares member credentials only as authenticated ciphertext and revokes them", async () => {
    const password = `secret-${crypto.randomUUID()}`;
    const connection = await connectionStore.createAsync({
      config: { email: "member@example.com", password },
      displayName: "Shared mailbox",
      providerId: id.provider("imap-smtp"),
    }, "profile-revision", {
      clientLabel: "Replica A",
      ownerKey: "o".repeat(43),
    });
    resetSharedStateRedisClientForTests();

    const loaded = await connectionStore.getAsync(connection.id);
    expect(loaded?.connection.config["password"]).toBe(password);
    await connectionStore.updateConfigAsync(connection.id, {
      ...loaded!.connection.config,
      password: `${password}-rotated`,
    });
    resetSharedStateRedisClientForTests();
    const ownerSessions = await connectionStore.listForOwnerAsync("o".repeat(43));
    expect(ownerSessions).toHaveLength(1);
    expect(ownerSessions[0]?.connection.config["password"])
      .toBe(`${password}-rotated`);

    const keys = await inspector.keys(`${prefix}:*`);
    const values = await Promise.all(keys.filter((key) => key.includes(":record:"))
      .map((key) => inspector.get(key)));
    const redisSurface = JSON.stringify({ keys, values });
    expect(redisSurface).not.toContain(connection.id);
    expect(redisSurface).not.toContain(password);
    expect(redisSurface).not.toContain("member@example.com");

    await connectionStore.removeAsync(connection.id);
    resetSharedStateRedisClientForTests();
    await expect(connectionStore.getAsync(connection.id)).resolves.toBeNull();
  });

  it("never resurrects a session when touch races remote revocation", async () => {
    const sessionId = "r".repeat(24);
    await adminSessionStore.createAsync({
      authVersion: 6,
      expiresAt: Date.now() + 60 * 60_000,
      id: sessionId,
    });
    await Promise.allSettled([
      adminSessionStore.getAsync(sessionId, 6),
      adminSessionStore.removeAsync(sessionId),
    ]);
    resetSharedStateRedisClientForTests();
    await expect(adminSessionStore.getAsync(sessionId, 6)).resolves.toBeNull();
  });

  it("fails closed when authenticated session ciphertext is modified", async () => {
    const sessionId = "t".repeat(24);
    await adminSessionStore.createAsync({
      authVersion: 9,
      expiresAt: Date.now() + 60 * 60_000,
      id: sessionId,
    });
    const [recordKey] = await inspector.keys(`${prefix}:session:administrator:record:*`);
    expect(recordKey).toBeDefined();
    const envelope = JSON.parse((await inspector.get(recordKey!))!);
    const replacement = envelope.ciphertext.endsWith("A") ? "B" : "A";
    envelope.ciphertext = `${envelope.ciphertext.slice(0, -1)}${replacement}`;
    await inspector.set(recordKey!, JSON.stringify(envelope), { PX: 60_000 });
    resetSharedStateRedisClientForTests();
    await expect(adminSessionStore.getAsync(sessionId, 9)).rejects.toThrow();
    await inspector.del(recordKey!);
  });
});
