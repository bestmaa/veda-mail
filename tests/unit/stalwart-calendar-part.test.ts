import { describe, expect, it } from "vitest";

import {
  collectStalwartCalendarParts,
  findStalwartCalendarPart,
} from "@/infrastructure/providers/stalwart-jmap/stalwart-calendar-part";

describe("Stalwart calendar body-part discovery", () => {
  it("discovers dispositionless and inline calendar leaves", () => {
    const structure = {
      subParts: [
        { blobId: "plain", partId: "1", type: "text/plain" },
        {
          blobId: "calendar-one",
          name: "../meeting.ics",
          partId: "2",
          size: 123,
          type: "TEXT/CALENDAR; charset=utf-8",
        },
        {
          blobId: "calendar-two",
          disposition: "inline",
          partId: "3.1",
          type: "text/calendar",
        },
      ],
      type: "multipart/mixed",
    };

    const parts = collectStalwartCalendarParts("account", "message", structure);

    expect(parts).toMatchObject([
      { blobId: "calendar-one", name: "_meeting.ics", size: 123 },
      { blobId: "calendar-two", name: "invite.ics", size: null },
    ]);
    expect(JSON.stringify(parts.map(({ id, name, size }) => ({ id, name, size }))))
      .not.toContain("calendar-one");
    expect(findStalwartCalendarPart(
      "account", "message", structure, parts[0]!.id,
    )?.blobId).toBe("calendar-one");
  });

  it("binds identifiers to account, message, blob, and metadata", () => {
    const structure = {
      blobId: "calendar",
      partId: "1",
      size: 4,
      type: "text/calendar",
    };
    const value = (account = "account", message = "message", blob = "calendar") =>
      collectStalwartCalendarParts(account, message, {
        ...structure,
        blobId: blob,
      })[0]!.id;

    expect(value("other")).not.toBe(value());
    expect(value("account", "other")).not.toBe(value());
    expect(value("account", "message", "other")).not.toBe(value());
  });

  it("fails closed on duplicate identities and bounded traversal", () => {
    const duplicate = {
      subParts: [
        { blobId: "same", partId: "1", type: "text/calendar" },
        { blobId: "same", partId: "1", type: "text/calendar" },
      ],
      type: "multipart/mixed",
    };
    expect(collectStalwartCalendarParts("a", "m", duplicate)).toEqual([]);

    let deep: Record<string, unknown> = { blobId: "end", type: "text/calendar" };
    for (let index = 0; index < 34; index += 1) {
      deep = { subParts: [deep], type: "multipart/mixed" };
    }
    expect(() => collectStalwartCalendarParts("a", "m", deep)).toThrow(
      /safe traversal limits/,
    );
  });

  it("does not treat containers, remote URLs, or unrelated media as invitations", () => {
    const structure = {
      subParts: [
        {
          blobId: "container",
          subParts: [{ blobId: "text", type: "text/plain" }],
          type: "text/calendar",
        },
        { blobId: "html", type: "text/html" },
        { href: "https://attacker.example/invite.ics", type: "text/calendar" },
      ],
      type: "multipart/mixed",
    };
    expect(collectStalwartCalendarParts("a", "m", structure)).toEqual([]);
  });
});
