import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { ScheduleMessageInput } from "@/domain/mail/scheduled-send";
import { id } from "@/domain/shared/brand";
import { scheduledJobFilePath } from "@/server/scheduled-send/scheduled-send-file";
import { scheduledSendStore } from "@/server/scheduled-send/scheduled-send-store";
import {
  claimNextScheduledJob,
  recoverInterruptedScheduledJobs,
  settleScheduledJob,
} from "@/server/scheduled-send/scheduled-send-worker-store";

const originalDirectory = process.env["VEDA_MAIL_DATA_DIR"];
const originalKey = process.env["VEDA_MAIL_JOB_KEY"];
let directory = "";

const owner = { email: "Member@Example.com", providerId: id.provider("mock") };
const scheduledAt = () => new Date(Date.now() + 60_000).toISOString();
const input = (overrides: Partial<ScheduleMessageInput> = {}): ScheduleMessageInput => ({
  connection: {
    config: { secret: "provider-password", username: "Member@Example.com" },
    createdAt: "2026-08-02T00:00:00.000Z",
    displayName: "Test provider",
    id: id.connection("11111111-1111-4111-8111-111111111111"),
    providerId: id.provider("mock"),
  },
  owner,
  request: {
    bcc: [],
    body: "Private scheduled body",
    cc: [],
    draftId: id.draft("22222222-2222-4222-8222-222222222222"),
    expectedDraftRevision: "provider-revision-1",
    providerDraftId: id.providerDraft("provider-draft-1"),
    subject: "Private subject",
    to: [{ email: "recipient@example.com", name: null }],
  },
  scheduledAt: scheduledAt(),
  ...overrides,
});

beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "veda-scheduled-"));
  process.env["VEDA_MAIL_DATA_DIR"] = directory;
  process.env["VEDA_MAIL_JOB_KEY"] = Buffer.alloc(32, 7).toString("base64");
});

afterEach(async () => {
  if (originalDirectory === undefined) delete process.env["VEDA_MAIL_DATA_DIR"];
  else process.env["VEDA_MAIL_DATA_DIR"] = originalDirectory;
  if (originalKey === undefined) delete process.env["VEDA_MAIL_JOB_KEY"];
  else process.env["VEDA_MAIL_JOB_KEY"] = originalKey;
  await rm(directory, { force: true, recursive: true });
});

describe("encrypted scheduled-send store", () => {
  it("encrypts credentials and content while returning a safe owner view", async () => {
    const book = await scheduledSendStore.schedule(input());
    const [contents, stats] = await Promise.all([
      readFile(scheduledJobFilePath(), "utf8"),
      stat(scheduledJobFilePath()),
    ]);

    expect(book.messages).toEqual([
      expect.objectContaining({
        recipientCount: 1,
        status: "pending",
        subject: "Private subject",
      }),
    ]);
    expect(stats.mode & 0o777).toBe(0o600);
    expect(contents).not.toMatch(
      /(?:provider-password|Member@Example\.com|Private subject|Private scheduled body|recipient@example\.com)/u,
    );
    await expect(scheduledSendStore.list({
      email: "other@example.com",
      providerId: id.provider("mock"),
    })).resolves.toEqual({ messages: [], revision: null, version: 1 });
  });

  it("prevents duplicate drafts and supports reschedule plus cancellation", async () => {
    const created = await scheduledSendStore.schedule(input());
    await expect(scheduledSendStore.schedule(input())).rejects.toMatchObject({
      code: "SCHEDULED_MESSAGE_CONFLICT",
    });
    const messageId = created.messages[0]!.id;
    const later = new Date(Date.now() + 120_000).toISOString();
    const rescheduled = await scheduledSendStore.reschedule(owner, messageId, later);
    expect(rescheduled.messages[0]).toMatchObject({
      attemptCount: 0,
      scheduledAt: later,
      status: "pending",
    });
    await scheduledSendStore.cancel(owner, messageId);
    await expect(scheduledSendStore.list(owner)).resolves.toEqual({
      messages: [], revision: null, version: 1,
    });
  });

  it("durably claims, retries, completes, and recovers interrupted jobs", async () => {
    const due = new Date(Date.now() + 6_000).toISOString();
    await scheduledSendStore.schedule(input({ scheduledAt: due }));
    const claim = await claimNextScheduledJob(new Date(Date.now() + 7_000));
    expect(claim?.job).toMatchObject({ attemptCount: 1, state: "sending" });
    await expect(scheduledSendStore.cancel(
      owner,
      id.scheduledMessage(claim!.job.id),
    )).rejects.toMatchObject({ code: "SCHEDULED_MESSAGE_BUSY" });

    const recovered = await recoverInterruptedScheduledJobs();
    expect(recovered).toBe(1);
    await expect(scheduledSendStore.list(owner)).resolves.toMatchObject({
      messages: [{ status: "uncertain" }],
    });

    await expect(scheduledSendStore.reschedule(
      owner,
      id.scheduledMessage(claim!.job.id),
      new Date(Date.now() + 8_000).toISOString(),
    )).rejects.toMatchObject({ code: "SCHEDULED_MESSAGE_BUSY" });
  });

  it("persists retry state and removes only the matching accepted lease", async () => {
    const due = new Date(Date.now() + 6_000).toISOString();
    await scheduledSendStore.schedule(input({ scheduledAt: due }));
    const first = await claimNextScheduledJob(new Date(Date.now() + 7_000));
    const retryAt = new Date(Date.now() + 30_000).toISOString();
    await expect(settleScheduledJob(first!, {
      error: "The provider is temporarily unavailable.", kind: "retry", retryAt,
    })).resolves.toBe(true);
    await expect(scheduledSendStore.list(owner)).resolves.toMatchObject({
      messages: [{ attemptCount: 1, status: "retrying" }],
    });
    const second = await claimNextScheduledJob(new Date(Date.now() + 31_000));
    expect(second?.leaseId).not.toBe(first?.leaseId);
    await expect(settleScheduledJob(first!, { kind: "complete" })).resolves.toBe(false);
    await expect(settleScheduledJob(second!, { kind: "complete" })).resolves.toBe(true);
    await expect(scheduledSendStore.list(owner)).resolves.toMatchObject({
      messages: [],
    });
  });

  it("fails closed when the deployment key is missing or wrong", async () => {
    delete process.env["VEDA_MAIL_JOB_KEY"];
    await expect(scheduledSendStore.list(owner)).rejects.toMatchObject({
      code: "SCHEDULED_SEND_UNAVAILABLE",
      status: 503,
    });
    process.env["VEDA_MAIL_JOB_KEY"] = Buffer.alloc(32, 8).toString("base64");
    await scheduledSendStore.schedule(input());
    process.env["VEDA_MAIL_JOB_KEY"] = Buffer.alloc(32, 9).toString("base64");
    await expect(scheduledSendStore.list(owner)).rejects.toMatchObject({
      code: "SCHEDULED_SEND_UNAVAILABLE",
    });
  });
});
