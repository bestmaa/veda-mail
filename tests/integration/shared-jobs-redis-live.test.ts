import { access, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createClient } from "redis";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { ScheduleMessageInput } from "@/domain/mail/scheduled-send";
import { id } from "@/domain/shared/brand";
import { scheduledSendStore } from "@/server/scheduled-send/scheduled-send-store";
import { scheduledJobFilePath } from "@/server/scheduled-send/scheduled-send-file";
import {
  claimNextScheduledJob,
  recoverInterruptedScheduledJobs,
  SCHEDULED_JOB_LEASE_MS,
  settleScheduledJob,
} from "@/server/scheduled-send/scheduled-send-worker-store";
import { resetSharedStateRedisClientForTests } from
  "@/server/shared-state/shared-state-redis";
import { snoozeStore } from "@/server/snooze/snooze-store";
import {
  claimNextSnoozeJob,
  recoverInterruptedSnoozes,
  settleSnoozeJob,
  SNOOZE_JOB_LEASE_MS,
} from "@/server/snooze/snooze-worker-store";

const redisUrl = process.env["VEDA_MAIL_TEST_REDIS_URL"];
const prefix = `veda-mail:test:jobs:${crypto.randomUUID()}`;
const originalDirectory = process.env["VEDA_MAIL_DATA_DIR"];
const originalJobKey = process.env["VEDA_MAIL_JOB_KEY"];
const originalRedisUrl = process.env["VEDA_MAIL_STATE_REDIS_URL"];
const originalRedisPrefix = process.env["VEDA_MAIL_STATE_REDIS_PREFIX"];
let directory = "";

const owner = { email: "member@example.com", providerId: id.provider("mock") };
const input = (): ScheduleMessageInput => ({
  connection: {
    config: { password: "redis-private-password", username: owner.email },
    createdAt: "2026-08-12T00:00:00.000Z",
    displayName: "Shared provider",
    id: id.connection("11111111-1111-4111-8111-111111111111"),
    providerId: owner.providerId,
  },
  owner,
  request: {
    bcc: [], body: "Redis private body", cc: [],
    draftId: id.draft("22222222-2222-4222-8222-222222222222"),
    expectedDraftRevision: "revision-1",
    providerDraftId: id.providerDraft("provider-draft-redis"),
    subject: "Redis private subject",
    to: [{ email: "recipient@example.com", name: null }],
  },
  scheduledAt: new Date(Date.now() + 6_000).toISOString(),
});

describe.skipIf(!redisUrl)("live encrypted shared job repository", () => {
  const inspector = createClient({ url: redisUrl! });
  const deleteTestKeys = async (): Promise<void> => {
    const keys = await inspector.keys(`${prefix}:*`);
    if (keys.length > 0) await inspector.del(keys);
  };

  beforeAll(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), "veda-shared-jobs-"));
    process.env["VEDA_MAIL_DATA_DIR"] = directory;
    process.env["VEDA_MAIL_JOB_KEY"] = Buffer.alloc(32, 31).toString("base64");
    process.env["VEDA_MAIL_STATE_REDIS_PREFIX"] = prefix;
    delete process.env["VEDA_MAIL_STATE_REDIS_URL"];
    await inspector.connect();
    await deleteTestKeys();
  });

  afterAll(async () => {
    resetSharedStateRedisClientForTests();
    await deleteTestKeys();
    inspector.destroy();
    await rm(directory, { force: true, recursive: true });
    if (originalDirectory === undefined) delete process.env["VEDA_MAIL_DATA_DIR"];
    else process.env["VEDA_MAIL_DATA_DIR"] = originalDirectory;
    if (originalJobKey === undefined) delete process.env["VEDA_MAIL_JOB_KEY"];
    else process.env["VEDA_MAIL_JOB_KEY"] = originalJobKey;
    if (originalRedisUrl === undefined) delete process.env["VEDA_MAIL_STATE_REDIS_URL"];
    else process.env["VEDA_MAIL_STATE_REDIS_URL"] = originalRedisUrl;
    if (originalRedisPrefix === undefined) delete process.env["VEDA_MAIL_STATE_REDIS_PREFIX"];
    else process.env["VEDA_MAIL_STATE_REDIS_PREFIX"] = originalRedisPrefix;
  });

  it("migrates local ciphertext and shares one claim across client lifecycles", async () => {
    const created = await scheduledSendStore.schedule(input());
    process.env["VEDA_MAIL_STATE_REDIS_URL"] = redisUrl;

    await expect(scheduledSendStore.list(owner)).resolves.toMatchObject({
      messages: [{ id: created.createdMessage.id, status: "pending" }],
    });
    await expect(access(scheduledJobFilePath())).rejects.toMatchObject({ code: "ENOENT" });
    await expect(access(`${scheduledJobFilePath()}.migrated-to-redis`)).resolves.toBeUndefined();
    resetSharedStateRedisClientForTests();
    const due = new Date(Date.now() + 7_000);
    const claims = await Promise.all(Array.from({ length: 4 }, () =>
      claimNextScheduledJob(due)));
    const accepted = claims.filter(Boolean);
    expect(accepted).toHaveLength(1);

    const redisKeys = await inspector.keys(`${prefix}:job:scheduled-send:*`);
    const redisValues = await Promise.all(redisKeys.filter((key) => key.includes(":owner:"))
      .map((key) => inspector.get(key)));
    const surface = JSON.stringify({ redisKeys, redisValues });
    expect(surface).not.toContain("redis-private-password");
    expect(surface).not.toContain("Redis private body");
    expect(surface).not.toContain("recipient@example.com");

    const claim = accepted[0]!;
    await expect(recoverInterruptedScheduledJobs(due)).resolves.toBe(0);
    await expect(recoverInterruptedScheduledJobs(new Date(
      due.getTime() + SCHEDULED_JOB_LEASE_MS + 1,
    ))).resolves.toBe(1);
    await expect(settleScheduledJob(claim, { kind: "complete" })).resolves.toBe(false);
    await expect(scheduledSendStore.list(owner)).resolves.toMatchObject({
      messages: [{ status: "uncertain" }],
    });
  });

  it("coordinates snooze leases and only recovers them after expiry", async () => {
    const snoozeOwner = { accountScope: "a".repeat(43), ...owner };
    const mailbox = { id: "snoozed", kind: "jmap", name: "Snoozed · shared" } as const;
    await snoozeStore.ensureMailboxIntent(snoozeOwner, mailbox);
    await snoozeStore.admit({
      connection: {
        config: { password: "snooze-private-password" },
        createdAt: "2026-08-12T00:00:00.000Z", displayName: "Shared provider",
        id: id.connection("33333333-3333-4333-8333-333333333333"),
        providerId: owner.providerId,
      },
      item: {
        messageId: id.message("shared-message"), sourceMailboxId: id.mailbox("inbox"),
        wakeAt: new Date(Date.now() + 60_000).toISOString(),
      },
      operationId: "44444444-4444-4444-8444-444444444444",
      owner: snoozeOwner,
      preflight: {
        from: ["sender@example.com"],
        plan: {
          emailId: "email-shared", expectedState: "state-1", inboxMailboxId: "inbox",
          kind: "jmap", originalMailboxIds: ["inbox"], snoozedMailboxId: null,
          snoozedMailboxName: mailbox.name, sourceMailboxId: "inbox",
        },
        subject: "Snooze private subject",
      },
    });
    resetSharedStateRedisClientForTests();
    const claimedAt = new Date();
    const claims = await Promise.all(Array.from({ length: 4 }, () =>
      claimNextSnoozeJob(claimedAt)));
    const accepted = claims.filter(Boolean);
    expect(accepted).toHaveLength(1);
    const claim = accepted[0]!;
    await expect(recoverInterruptedSnoozes(claimedAt)).resolves.toBe(0);
    const expiredAt = new Date(claimedAt.getTime() + SNOOZE_JOB_LEASE_MS + 1);
    await expect(recoverInterruptedSnoozes(expiredAt)).resolves.toBe(1);
    await expect(settleSnoozeJob(claim, { kind: "complete" })).resolves.toBe(false);
    const reclaimed = await claimNextSnoozeJob(expiredAt);
    expect(reclaimed?.job.state).toBe("hiding");
    expect(reclaimed?.leaseId).not.toBe(claim.leaseId);

    const redisKeys = await inspector.keys(`${prefix}:job:snooze:*`);
    const redisValues = await Promise.all(redisKeys.filter((key) => key.includes(":owner:"))
      .map((key) => inspector.get(key)));
    const surface = JSON.stringify({ redisKeys, redisValues });
    expect(surface).not.toContain("snooze-private-password");
    expect(surface).not.toContain("Snooze private subject");
    expect(surface).not.toContain("sender@example.com");
  });
});
