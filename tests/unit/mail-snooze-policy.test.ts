import { describe, expect, it } from "vitest";
import { id } from "@/domain/shared/brand";
import {
  isCurrentSnoozeRequest,
  mailboxCanSnooze,
  snoozeOutcome,
} from "@/presentation/features/mail-workspace/mail-snooze-policy";

describe("mail snooze UI policy", () => {
  it("allows normal mailboxes but rejects lifecycle and the exact owned mailbox", () => {
    const inbox = { id: id.mailbox("inbox"), role: "inbox" as const };
    expect(mailboxCanSnooze(inbox, id.mailbox("snoozed"), true)).toBe(true);
    expect(mailboxCanSnooze({ ...inbox, role: "sent" }, null, true)).toBe(false);
    expect(mailboxCanSnooze({ ...inbox, id: id.mailbox("snoozed"), role: "custom" }, id.mailbox("snoozed"), true)).toBe(false);
    expect(mailboxCanSnooze({ ...inbox, id: id.mailbox("same-name-only"), role: "custom" }, id.mailbox("snoozed"), true)).toBe(true);
    expect(mailboxCanSnooze(inbox, null, false)).toBe(false);
  });

  it("separates partial outcomes for optimistic commit and rollback", () => {
    const accepted = id.message("accepted"); const rejected = id.message("rejected");
    expect(snoozeOutcome([
      { errorCode: null, messageId: accepted, snoozeId: "job-1", status: "accepted" },
      { errorCode: "DENIED", messageId: rejected, snoozeId: null, status: "rejected" },
    ])).toEqual({ accepted: [accepted], rejected: [rejected] });
  });

  it("rejects delayed responses after scope or operation changes", () => {
    expect(isCurrentSnoozeRequest("scope-a", "scope-a", 4, 4)).toBe(true);
    expect(isCurrentSnoozeRequest("scope-b", "scope-a", 4, 4)).toBe(false);
    expect(isCurrentSnoozeRequest("scope-a", "scope-a", 5, 4)).toBe(false);
  });
});
