import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { SnoozePreflightResult } from "@/domain/mail/snooze";
import { id } from "@/domain/shared/brand";
import { snoozeFilePath } from "@/server/snooze/snooze-file";
import { snoozeOwnerKey } from "@/server/snooze/snooze-crypto";
import { assertWakeAt, snoozeStore } from "@/server/snooze/snooze-store";
import { readOwnerSnoozes } from "@/server/snooze/snooze-store-access";
import {
  claimNextSnoozeJob,
  recoverInterruptedSnoozes,
  settleSnoozeJob,
} from "@/server/snooze/snooze-worker-store";

const originalDirectory = process.env["VEDA_MAIL_DATA_DIR"];
const originalKey = process.env["VEDA_MAIL_JOB_KEY"];
let directory = "";
const owner = { email: "Member@Example.com", providerId: id.provider("mock") };
const connection = {
  config: { secret: "provider-password", username: "Member@Example.com" },
  createdAt: "2026-08-04T00:00:00.000Z", displayName: "Mail",
  id: id.connection("11111111-1111-4111-8111-111111111111"),
  providerId: id.provider("mock"),
};
const mailbox = { id: "snoozed-mailbox", kind: "jmap", name: "Snoozed · abc" } as const;
const preflight: SnoozePreflightResult = {
  from: ["sender@example.com"], subject: "Private subject",
  plan: { emailId: "email-1", expectedState: "state-1", inboxMailboxId: "inbox",
    kind: "jmap", originalMailboxIds: ["inbox"],
    snoozedMailboxId: null, snoozedMailboxName: mailbox.name,
    sourceMailboxId: "inbox" },
};
const item = () => ({ messageId: id.message("message-1"),
  sourceMailboxId: id.mailbox("inbox"),
  wakeAt: new Date(Date.now() + 60_000).toISOString() });
const admit = async () => {
  await snoozeStore.ensureMailboxIntent(owner, mailbox);
  return snoozeStore.admit({ connection, item: item(),
    operationId: "22222222-2222-4222-8222-222222222222", owner, preflight });
};

beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "veda-snooze-"));
  process.env["VEDA_MAIL_DATA_DIR"] = directory;
  process.env["VEDA_MAIL_JOB_KEY"] = Buffer.alloc(32, 12).toString("base64");
});
afterEach(async () => {
  if (originalDirectory === undefined) delete process.env["VEDA_MAIL_DATA_DIR"];
  else process.env["VEDA_MAIL_DATA_DIR"] = originalDirectory;
  if (originalKey === undefined) delete process.env["VEDA_MAIL_JOB_KEY"];
  else process.env["VEDA_MAIL_JOB_KEY"] = originalKey;
  await rm(directory, { force: true, recursive: true });
});

describe("encrypted snooze store", () => {
  it("bounds wake times before any durable mutation", () => {
    expect(() => assertWakeAt(new Date(Date.now() + 1_000).toISOString()))
      .toThrow();
    expect(() => assertWakeAt(new Date(Date.now() + 367 * 86_400_000).toISOString()))
      .toThrow();
  });
  it("persists intent and secrets only inside owner-bound ciphertext", async () => {
    await admit();
    const [contents, stats] = await Promise.all([
      readFile(snoozeFilePath(), "utf8"), stat(snoozeFilePath()),
    ]);
    expect(stats.mode & 0o777).toBe(0o600);
    expect(contents).not.toMatch(/provider-password|Member@Example|Private subject|email-1/u);
    expect(contents).toContain(snoozeOwnerKey(owner));
    await expect(snoozeStore.list(owner)).resolves.toMatchObject({
      messages: [{ status: "hiding", subject: "Private subject" }],
      snoozedMailboxId: "snoozed-mailbox",
    });
    await expect(snoozeStore.list({ email: "other@example.com",
      providerId: owner.providerId })).resolves.toMatchObject({ messages: [] });
  });

  it("reconciles interrupted leases without an uncertain state", async () => {
    await admit();
    expect((await claimNextSnoozeJob())?.job.state).toBe("hiding");
    await expect(recoverInterruptedSnoozes()).resolves.toBe(1);
    const book = await snoozeStore.list(owner);
    expect(book.messages[0]?.status).toBe("retry-hide");
    expect(JSON.stringify(book)).not.toContain("uncertain");
  });

  it("uses lease CAS, clears terminal credentials, and retains mailbox ownership", async () => {
    await admit();
    const first = await claimNextSnoozeJob();
    await expect(settleSnoozeJob(first!, { error: "Sign in", kind: "needs-auth" }))
      .resolves.toBe(true);
    expect((await readOwnerSnoozes(owner)).book?.jobs[0]?.connection).toBeNull();
    await snoozeStore.retry(owner, first!.job.id, connection);
    const second = await claimNextSnoozeJob();
    expect(second?.leaseId).not.toBe(first?.leaseId);
    await expect(settleSnoozeJob(first!, { kind: "complete" })).resolves.toBe(false);
    await expect(settleSnoozeJob(second!, { error: "Terminal", kind: "failed" }))
      .resolves.toBe(true);
    expect((await readOwnerSnoozes(owner)).book?.jobs[0]?.connection).toBeNull();
    await snoozeStore.retry(owner, second!.job.id, connection);
    const third = await claimNextSnoozeJob();
    await expect(settleSnoozeJob(third!, { kind: "complete", mailbox })).resolves.toBe(true);
    await expect(snoozeStore.list(owner)).resolves.toMatchObject({
      messages: [], snoozedMailboxId: "snoozed-mailbox",
    });
  });

  it("fails closed with a wrong restore key", async () => {
    await admit();
    process.env["VEDA_MAIL_JOB_KEY"] = Buffer.alloc(32, 13).toString("base64");
    await expect(snoozeStore.list(owner)).rejects.toThrow();
  });
});
