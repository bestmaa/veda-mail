import type { MessageStructureObject } from "imapflow";
import { describe, expect, it } from "vitest";

import {
  collectImapCalendarParts,
  findImapCalendarPart,
} from "@/infrastructure/providers/imap-smtp/imap-calendar-part";

const input = (
  structure: MessageStructureObject,
  overrides: Partial<{
    accountScope: string;
    messageId: string;
    uidValidity: bigint;
  }> = {},
) => ({
  accountScope: "account",
  messageId: "message",
  structure,
  uidValidity: BigInt(9),
  ...overrides,
});

describe("IMAP calendar body-part discovery", () => {
  it("discovers dispositionless, inline, and named calendar leaves", () => {
    const structure: MessageStructureObject = {
      childNodes: [
        { part: "1", type: "text/plain" },
        {
          encoding: "base64",
          part: "2",
          parameters: { name: "../meeting.ics" },
          size: 999,
          type: "TEXT/CALENDAR",
        },
        {
          disposition: "inline",
          part: "3.1",
          type: "text/calendar",
        },
      ],
      type: "multipart/mixed",
    };

    const parts = collectImapCalendarParts(input(structure));

    expect(parts).toMatchObject([
      { name: "_meeting.ics", part: "2", size: null, transferEncoding: "base64" },
      { name: "invite.ics", part: "3.1", size: null },
    ]);
    expect(findImapCalendarPart(input(structure), parts[0]!.id)?.part).toBe("2");
  });

  it("binds opaque IDs to account, message, UIDVALIDITY, and section", () => {
    const structure: MessageStructureObject = {
      part: "1",
      type: "text/calendar",
    };
    const value = (overrides = {}) =>
      collectImapCalendarParts(input(structure, overrides))[0]!.id;

    expect(value({ accountScope: "other" })).not.toBe(value());
    expect(value({ messageId: "other" })).not.toBe(value());
    expect(value({ uidValidity: BigInt(10) })).not.toBe(value());
  });

  it("rejects unsafe sections and over-deep provider structures", () => {
    expect(() => collectImapCalendarParts(input({
      part: "1\r\nUID FETCH",
      type: "text/calendar",
    }))).toThrow(/invalid/);

    let deep: MessageStructureObject = { part: "1", type: "text/calendar" };
    for (let index = 0; index < 34; index += 1) {
      deep = { childNodes: [deep], type: "multipart/mixed" };
    }
    expect(() => collectImapCalendarParts(input(deep))).toThrow(
      /safe traversal limits/,
    );
  });

  it("ignores container and unrelated body parts", () => {
    expect(collectImapCalendarParts(input({
      childNodes: [
        {
          childNodes: [{ part: "1.1", type: "text/plain" }],
          part: "1",
          type: "text/calendar",
        },
        { part: "2", type: "text/html" },
      ],
      type: "multipart/mixed",
    }))).toEqual([]);
  });
});
