import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as ScheduledDeliveryModule from "@/server/scheduled-send/scheduled-send-delivery";

const mocks = vi.hoisted(() => ({
  claimNextScheduledJob: vi.fn(),
  deliverScheduledJob: vi.fn(),
  recoverInterruptedScheduledJobs: vi.fn(),
  settleScheduledJob: vi.fn(),
}));

vi.mock("@/server/scheduled-send/scheduled-send-delivery", async (importOriginal) => {
  const original = await importOriginal<typeof ScheduledDeliveryModule>();
  return { ...original, deliverScheduledJob: mocks.deliverScheduledJob };
});
vi.mock("@/server/scheduled-send/scheduled-send-worker-store", () => ({
  claimNextScheduledJob: mocks.claimNextScheduledJob,
  recoverInterruptedScheduledJobs: mocks.recoverInterruptedScheduledJobs,
  settleScheduledJob: mocks.settleScheduledJob,
}));

import { DraftConflictError } from "@/domain/mail/draft-errors";
import { id } from "@/domain/shared/brand";
import type { ScheduledJobClaim } from "@/server/scheduled-send/scheduled-send-worker-store";
import { runScheduledJob } from "@/server/scheduled-send/scheduled-send-worker";

const claim = (attemptCount = 1): ScheduledJobClaim => ({
  job: {
    attemptCount,
    connection: {
      config: {}, createdAt: "2026-08-02T00:00:00.000Z",
      displayName: "Mock", id: "11111111-1111-4111-8111-111111111111",
      providerId: "mock",
    },
    createdAt: "2026-08-02T00:00:00.000Z",
    id: "22222222-2222-4222-8222-222222222222",
    lastError: null, leaseId: "lease-value-that-is-long-enough-1234567890",
    nextAttemptAt: "2026-08-02T01:00:00.000Z",
    request: {
      bcc: [], body: "Body", cc: [],
      draftId: id.draft("33333333-3333-4333-8333-333333333333"),
      expectedDraftRevision: "revision-1", providerDraftId: id.providerDraft("draft-1"),
      subject: "Subject", to: [{ email: "to@example.com", name: null }],
    },
    scheduledAt: "2026-08-02T01:00:00.000Z", state: "sending",
    updatedAt: "2026-08-02T01:00:00.000Z", version: 1,
  },
  leaseId: "lease-value-that-is-long-enough-1234567890",
  ownerKey: "owner-key",
});
const now = new Date("2026-08-02T02:00:00.000Z");

beforeEach(() => {
  Object.values(mocks).forEach((mock) => mock.mockReset());
  mocks.settleScheduledJob.mockResolvedValue(true);
});

describe("scheduled-send worker outcomes", () => {
  it("removes a provider-accepted job", async () => {
    mocks.deliverScheduledJob.mockResolvedValue({
      deliveryStatus: "accepted", id: "sent", rejectedRecipients: [],
      submittedAt: now.toISOString(),
    });
    const current = claim();
    await runScheduledJob(current, undefined, now);
    expect(mocks.settleScheduledJob).toHaveBeenCalledWith(current, {
      kind: "complete",
    });
  });

  it("never retries an ambiguous provider outcome", async () => {
    mocks.deliverScheduledJob.mockResolvedValue({
      deliveryStatus: "uncertain", id: "maybe-sent", rejectedRecipients: [],
      submittedAt: now.toISOString(),
    });
    const current = claim();
    await runScheduledJob(current, undefined, now);
    expect(mocks.settleScheduledJob).toHaveBeenCalledWith(current, {
      error: "The provider could not confirm whether delivery completed.",
      kind: "uncertain",
    });
  });

  it("retries temporary failures with bounded backoff", async () => {
    mocks.deliverScheduledJob.mockRejectedValue(new Error("secret provider detail"));
    const current = claim();
    await runScheduledJob(current, undefined, now);
    expect(mocks.settleScheduledJob).toHaveBeenCalledWith(current, {
      error: "The provider is temporarily unavailable.",
      kind: "retry",
      retryAt: "2026-08-02T02:00:30.000Z",
    });
  });

  it("dead-letters terminal and exhausted failures", async () => {
    mocks.deliverScheduledJob.mockRejectedValueOnce(new DraftConflictError());
    const stale = claim();
    await runScheduledJob(stale, undefined, now);
    expect(mocks.settleScheduledJob).toHaveBeenLastCalledWith(stale, {
      error: "The saved draft changed before its scheduled send.",
      kind: "failed",
    });
    mocks.deliverScheduledJob.mockRejectedValueOnce(new Error("outage"));
    const exhausted = claim(6);
    await runScheduledJob(exhausted, undefined, now);
    expect(mocks.settleScheduledJob).toHaveBeenLastCalledWith(exhausted, {
      error: "The provider is temporarily unavailable.",
      kind: "failed",
    });
  });
});
