import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as SnoozeWorkerStoreModule from "@/server/snooze/snooze-worker-store";

const mocks = vi.hoisted(() => ({ clearGateway: vi.fn(), settle: vi.fn() }));
vi.mock("@/server/mail/gateway-cache", () => ({ clearGateway: mocks.clearGateway }));
vi.mock("@/server/snooze/snooze-worker-store", async (importOriginal) => ({
  ...await importOriginal<typeof SnoozeWorkerStoreModule>(),
  settleSnoozeJob: mocks.settle,
}));

import type { SnoozeProviderPlan } from "@/domain/mail/snooze";
import type { SnoozeOperationPort } from "@/server/snooze/snooze-operation.port";
import { SnoozeProviderError } from "@/server/snooze/snooze-operation.port";
import type { SnoozeClaim } from "@/server/snooze/snooze-worker-store";
import { runSnoozeJob } from "@/server/snooze/snooze-worker";

const mailbox = { id: "snoozed", kind: "jmap", name: "Snoozed · abc" } as const;
const plan = { emailId: "email", expectedState: null, inboxMailboxId: "inbox",
  kind: "jmap", originalMailboxIds: ["inbox"], snoozedMailboxId: null,
  snoozedMailboxName: mailbox.name, sourceMailboxId: "inbox" } satisfies SnoozeProviderPlan;
const claim = (): SnoozeClaim => ({
  job: { attemptCount: 1, connection: { config: { secret: "password" },
    createdAt: "2026-08-04T00:00:00.000Z", displayName: "Mail",
    id: "11111111-1111-4111-8111-111111111111", providerId: "mock" },
    createdAt: "2026-08-04T00:00:00.000Z", from: [],
    id: "22222222-2222-4222-8222-222222222222", lastError: null,
    leaseExpiresAt: null,
    leaseId: "x".repeat(43), messageId: "message", nextAttemptAt: "2026-08-04T00:00:00.000Z",
    phase: "hide", plan, sourceMailboxId: "inbox", state: "hiding",
    subject: "Subject", updatedAt: "2026-08-04T00:00:00.000Z", version: 1,
    wakeAt: "2026-08-05T00:00:00.000Z" }, leaseId: "x".repeat(43),
  mailbox, ownerKey: "owner", phase: "hide",
});
const port = (overrides: Partial<SnoozeOperationPort> = {}): SnoozeOperationPort => ({
  getAccountScope: vi.fn(), getCapability: vi.fn(),
  hide: vi.fn().mockResolvedValue({ ownedMailbox: mailbox, plan }),
  inspect: vi.fn().mockResolvedValue({ ownedMailbox: mailbox, plan, state: "visible" }),
  mailboxIntent: vi.fn(), preflight: vi.fn(), restore: vi.fn(), ...overrides,
});

beforeEach(() => Object.values(mocks).forEach((mock) => mock.mockReset()));
describe("snooze worker", () => {
  it("reconciles before hide and durably settles the updated locator", async () => {
    const operations = port(); const current = claim();
    await runSnoozeJob(current, operations);
    expect(operations.inspect).toHaveBeenCalledBefore(operations.hide as never);
    expect(mocks.settle).toHaveBeenCalledWith(current, {
      kind: "snoozed", mailbox, plan,
    });
    expect(mocks.clearGateway).toHaveBeenCalledWith(current.job.connection?.id);
  });

  it("does not create an uncertain state on authentication failure", async () => {
    const current = claim();
    await runSnoozeJob(current, port({ inspect: vi.fn().mockRejectedValue(
      new SnoozeProviderError("authentication"),
    ) }));
    expect(mocks.settle).toHaveBeenCalledWith(current, {
      error: "Sign in to retry this snooze.", kind: "needs-auth",
    });
    expect(JSON.stringify(mocks.settle.mock.calls)).not.toContain("uncertain");
  });
});
