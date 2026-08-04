import { describe, expect, it } from "vitest";

import {
  classifyImapSnoozeState,
  imapSnoozeSourceExists,
} from "@/infrastructure/providers/imap-smtp/imap-snooze-plan";
import type { SnoozeProviderPlan } from "@/domain/mail/snooze";
import { classifyStalwartSnoozeState } from "@/infrastructure/providers/stalwart-jmap/stalwart-snooze-schema";

describe("provider snooze reconciliation", () => {
  it.each([
    [true, false, "visible"],
    [false, true, "snoozed"],
    [true, true, "visible"],
    [false, false, "deleted"],
  ] as const)("classifies JMAP source=%s target=%s", (source, target, expected) => {
    expect(classifyStalwartSnoozeState(source, target)).toBe(expected);
  });

  it.each([
    [true, false, "visible"],
    [false, true, "snoozed"],
    [false, false, "deleted"],
  ] as const)("classifies IMAP source=%s target=%s", (source, target, expected) => {
    expect(classifyImapSnoozeState(source, target)).toBe(expected);
  });

  it("fails closed for an IMAP duplicate in source and target", () => {
    expect(() => classifyImapSnoozeState(true, true)).toThrow("both source and target");
  });

  it("propagates transient source inspection failures", async () => {
    const client = { mailboxOpen: async () => { throw new TypeError("offline"); } };
    await expect(imapSnoozeSourceExists(client as never, {
      kind: "imap", sourceMailbox: "Inbox",
    } as SnoozeProviderPlan & { kind: "imap" })).rejects.toThrow("offline");
  });

  it("treats a definitive missing source mailbox as absent", async () => {
    const missing = Object.assign(new Error("missing"), {
      serverResponseCode: "NONEXISTENT",
    });
    const client = { mailboxOpen: async () => { throw missing; } };
    await expect(imapSnoozeSourceExists(client as never, {
      kind: "imap", sourceMailbox: "Gone",
    } as SnoozeProviderPlan & { kind: "imap" })).resolves.toBe(false);
  });
});
