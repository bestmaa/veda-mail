import { describe, expect, it, vi } from "vitest";

import { DraftConflictError } from "@/domain/mail/draft-errors";
import { id } from "@/domain/shared/brand";
import type { ScheduledJobClaim } from "@/server/scheduled-send/scheduled-send-worker-store";
import {
  isTerminalScheduledSendError,
  scheduledJobConnection,
  scheduledJobSendInput,
} from "@/server/scheduled-send/scheduled-send-delivery";

const claim = (): ScheduledJobClaim => ({
  job: {
    attemptCount: 1,
    connection: {
      config: { secret: "password", username: "member@example.com" },
      createdAt: "2026-08-02T00:00:00.000Z",
      displayName: "Provider",
      id: "11111111-1111-4111-8111-111111111111",
      providerId: "mock",
    },
    createdAt: "2026-08-02T00:00:00.000Z",
    id: "22222222-2222-4222-8222-222222222222",
    lastError: null,
    leaseId: "x".repeat(43),
    nextAttemptAt: "2026-08-02T01:00:00.000Z",
    purpose: "scheduled",
    request: {
      bcc: [], body: "Body", cc: [],
      draftId: id.draft("33333333-3333-4333-8333-333333333333"),
      expectedDraftRevision: "revision-1",
      providerDraftId: id.providerDraft("provider-draft"),
      subject: "Subject",
      to: [{ email: "to@example.com", name: null }],
    },
    scheduledAt: "2026-08-02T01:00:00.000Z",
    state: "sending",
    updatedAt: "2026-08-02T01:00:00.000Z",
    version: 1,
  },
  leaseId: "x".repeat(43),
  ownerKey: "owner-key",
});

describe("scheduled-send delivery boundary", () => {
  it("reconstructs only the provider connection and saved-draft send input", () => {
    const value = claim().job;
    expect(scheduledJobConnection(value)).toEqual({
      ...value.connection,
      id: id.connection(value.connection.id),
      providerId: id.provider("mock"),
    });
    expect(scheduledJobSendInput(value)).toEqual({
      bcc: [], body: "Body", cc: [],
      providerDraft: {
        composeId: id.draft("33333333-3333-4333-8333-333333333333"),
        expectedRevision: "revision-1",
        id: id.providerDraft("provider-draft"),
      },
      subject: "Subject",
      to: [{ email: "to@example.com", name: null }],
    });
  });

  it("classifies stale drafts as terminal without logging provider errors", () => {
    expect(isTerminalScheduledSendError(new DraftConflictError())).toBe(true);
    expect(isTerminalScheduledSendError(new Error("temporary outage"))).toBe(false);
    const logger = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(logger).not.toHaveBeenCalled();
    logger.mockRestore();
  });
});
