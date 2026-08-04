import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as SnoozeWorkerStoreModule from "@/server/snooze/snooze-worker-store";

const state = vi.hoisted(() => ({
  clearGateway: vi.fn(), client: null as unknown, settle: vi.fn(),
}));
vi.mock("@/infrastructure/providers/imap-smtp/imap-client", () => ({
  withImapClient: async (_config: unknown, task: (client: unknown) => unknown) =>
    task(state.client),
}));
vi.mock("@/server/mail/gateway-cache", () => ({ clearGateway: state.clearGateway }));
vi.mock("@/server/snooze/snooze-worker-store", async (importOriginal) => ({
  ...await importOriginal<typeof SnoozeWorkerStoreModule>(),
  settleSnoozeJob: state.settle,
}));

import type { SnoozeProviderPlan } from "@/domain/mail/snooze";
import { ImapSnoozeAdapter } from "@/infrastructure/providers/imap-smtp/imap-snooze-adapter";
import { imapMessageAccountScope } from "@/infrastructure/providers/imap-smtp/imap-codec";
import { resolveImapSnoozedPath } from "@/infrastructure/providers/imap-smtp/imap-snooze-plan";
import type { SnoozeOperationPort } from "@/server/snooze/snooze-operation.port";
import { runSnoozeJob } from "@/server/snooze/snooze-worker";
import type { SnoozeClaim } from "@/server/snooze/snooze-worker-store";

const config = {
  imapHost: "imap.example.test", imapPort: "993", imapSecurity: "tls",
  secret: "secret", smtpHost: "smtp.example.test", smtpMaxMessageBytes: "1000",
  smtpPort: "465", smtpSecurity: "tls", username: "member@example.test",
} as const;
const mailbox = (path: string) => ({
  flags: new Set<string>(), listed: true, name: path, parentPath: "", path,
});
const plan = (): Extract<SnoozeProviderPlan, { kind: "imap" }> => ({
  accountScope: imapMessageAccountScope(config), destinationMailbox: "Inbox",
  emailObjectId: null, kind: "imap", marker: "veda-snooze-test",
  snoozedMailbox: "Snoozed · Veda Mail abc", snoozedMailboxObjectId: "owned",
  snoozedUid: 7, snoozedUidValidity: "1", sourceMailbox: "Inbox",
  sourceMailboxObjectId: "inbox", sourceUid: 2, sourceUidValidity: "1",
});

describe("IMAP snooze recovery", () => {
  beforeEach(() => {
    state.client = null; state.clearGateway.mockReset(); state.settle.mockReset();
  });

  it("fails closed when the exact mailbox path has another OBJECTID", async () => {
    const client = {
      capabilities: new Set(["OBJECTID"]), list: async () => [mailbox(plan().snoozedMailbox)],
      mailboxOpen: async () => ({ mailboxId: "foreign", uidValidity: BigInt(1) }),
    };
    await expect(resolveImapSnoozedPath(client as never, plan()))
      .rejects.toThrow("identity changed");
  });

  it("fails closed when a stored OBJECTID can no longer be verified", async () => {
    const client = {
      capabilities: new Set<string>(), list: async () => [mailbox(plan().snoozedMailbox)],
    };
    await expect(resolveImapSnoozedPath(client as never, plan()))
      .rejects.toThrow("cannot be verified");
  });

  it("worker cleans a lost-restore marker even after Snoozed disappeared", async () => {
    let current = "";
    const flagsRemove = vi.fn(async () => true);
    state.client = {
      capabilities: new Set(["MOVE", "OBJECTID", "UIDPLUS"]),
      fetchOne: async () => ({ flags: new Set<string>(), uid: 55 }),
      list: async () => [mailbox("Inbox")],
      mailboxOpen: async (path: string) => {
        current = path;
        return { mailboxId: path === "Inbox" ? "inbox" : "owned",
          uidValidity: BigInt(1) };
      },
      messageFlagsRemove: flagsRemove,
      search: async () => current === "Inbox" ? [55] : [],
    };
    const adapter = new ImapSnoozeAdapter(config);
    const port = {
      getAccountScope: () => adapter.getAccountScope(), getCapability: vi.fn(),
      hide: vi.fn(), inspect: (_connection: unknown, value: SnoozeProviderPlan) =>
        adapter.inspect(value as ReturnType<typeof plan>), mailboxIntent: vi.fn(),
      preflight: vi.fn(), restore: (_connection: unknown, value: SnoozeProviderPlan) =>
        adapter.restore(value as ReturnType<typeof plan>),
    } as SnoozeOperationPort;
    const claim = {
      job: { attemptCount: 1, connection: { config, displayName: "Mail",
        id: "11111111-1111-4111-8111-111111111111", providerId: "imap-smtp" },
        phase: "wake", plan: plan() },
      leaseId: "x".repeat(43), mailbox: {
        accountScope: plan().accountScope, id: null, kind: "imap",
        name: plan().snoozedMailbox, objectId: "owned",
      }, ownerKey: "owner", phase: "wake",
    } as unknown as SnoozeClaim;
    await runSnoozeJob(claim, port);
    expect(flagsRemove).toHaveBeenCalledWith(55, ["veda-snooze-test"], { uid: true });
    expect(state.settle).toHaveBeenCalledWith(claim, expect.objectContaining({
      kind: "complete",
    }));
  });
});
