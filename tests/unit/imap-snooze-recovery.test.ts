import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("@/infrastructure/providers/imap-smtp/imap-client", () => ({
  withImapClient: async (_config: unknown, task: (client: unknown) => unknown) =>
    task(state.client),
}));

import type { SnoozeProviderPlan } from "@/domain/mail/snooze";
import { ImapSnoozeAdapter } from "@/infrastructure/providers/imap-smtp/imap-snooze-adapter";
import { imapMessageAccountScope } from "@/infrastructure/providers/imap-smtp/imap-codec";
import { resolveImapSnoozedPath } from "@/infrastructure/providers/imap-smtp/imap-snooze-plan";

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
  beforeEach(() => { state.client = null; });

  it("fails closed when the exact mailbox path has another OBJECTID", async () => {
    const client = {
      capabilities: new Set(["OBJECTID"]), list: async () => [mailbox(plan().snoozedMailbox)],
      mailboxOpen: async () => ({ mailboxId: "foreign", uidValidity: BigInt(1) }),
    };
    await expect(resolveImapSnoozedPath(client as never, plan()))
      .rejects.toThrow("identity changed");
  });

  it("finishes a lost restore response by finding and cleaning the marker", async () => {
    let current = "";
    const flagsRemove = vi.fn(async () => true);
    state.client = {
      capabilities: new Set(["MOVE", "OBJECTID", "UIDPLUS"]),
      fetchOne: async () => ({ flags: new Set<string>(), uid: 55 }),
      list: async () => [mailbox(plan().snoozedMailbox), mailbox("Inbox")],
      mailboxOpen: async (path: string) => {
        current = path;
        return { mailboxId: path === "Inbox" ? "inbox" : "owned",
          uidValidity: BigInt(1) };
      },
      messageFlagsRemove: flagsRemove,
      search: async () => current === "Inbox" ? [55] : [],
    };
    await expect(new ImapSnoozeAdapter(config).restore(plan())).resolves.toBeTruthy();
    expect(flagsRemove).toHaveBeenCalledWith(55, ["veda-snooze-test"], { uid: true });
  });
});
