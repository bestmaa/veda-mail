import { describe, expect, it } from "vitest";

import { MailSearchUnsupportedError } from "@/domain/mail/mail-search";
import { parseMailSearch } from "@/domain/mail/mail-search-parser";
import { id } from "@/domain/shared/brand";
import {
  imapSearchPlan,
  intersectImapSearchResults,
} from "@/infrastructure/providers/imap-smtp/imap-search-plan";
import { stalwartSearchFilter } from "@/infrastructure/providers/stalwart-jmap/stalwart-search-filter";

describe("provider search compilers", () => {
  it("compiles every portable predicate into one bounded JMAP AND filter", () => {
    const query = parseMailSearch(
      'from:ada@example.com to:team@example.com cc:lead@example.com ' +
      'subject:"release plan" body:rollback "exact phrase" ' +
      "after:2026-07-01 before:2026-08-01 larger:10K smaller:2M " +
      "has:attachment is:unread is:starred",
    );

    expect(stalwartSearchFilter(id.mailbox("inbox"), query)).toEqual({
      conditions: [
        { inMailbox: "inbox" },
        { from: "ada@example.com" },
        { to: "team@example.com" },
        { cc: "lead@example.com" },
        { subject: '"release plan"' },
        { body: "rollback" },
        { text: '"exact phrase"' },
        { after: "2026-07-01T00:00:00.000Z" },
        { before: "2026-08-01T00:00:00.000Z" },
        { minSize: 10_241 },
        { maxSize: 2_097_152 },
        { hasAttachment: true },
        { notKeyword: "$seen" },
        { hasKeyword: "$flagged" },
      ],
      operator: "AND",
    });
  });

  it("keeps a simple mailbox query minimal", () => {
    expect(stalwartSearchFilter(id.mailbox("inbox"))).toEqual({
      inMailbox: "inbox",
    });
    expect(imapSearchPlan()).toEqual([{ all: true }]);
  });

  it("packs unique IMAP keys and splits repeated criteria for intersection", () => {
    const plan = imapSearchPlan(parseMailSearch(
      'from:ada@example.com from:grace@example.com "alpha" "beta" ' +
      "after:2026-07-01 before:2026-08-01 larger:10K smaller:2M " +
      "is:unread is:starred",
    ));

    expect(plan).toEqual([
      {
        before: "2026-08-01",
        flagged: true,
        from: "ada@example.com",
        larger: 10_240,
        seen: false,
        since: "2026-07-01",
        smaller: 2_097_152,
        text: "alpha",
      },
      { from: "grace@example.com", text: "beta" },
    ]);
    expect(intersectImapSearchResults([
      [1, 2, 3, 5],
      [2, 3, 4],
      [3, 5],
    ])).toEqual([3]);
  });

  it("reports the unsupported IMAP attachment predicate", () => {
    expect(() => imapSearchPlan(parseMailSearch("has:attachment")))
      .toThrowError(MailSearchUnsupportedError);
  });

  it("fails closed if a mailbox selector reaches a provider compiler", () => {
    const unresolved = parseMailSearch("in:inbox");

    expect(() => imapSearchPlan(unresolved)).toThrow("in:");
    expect(() => stalwartSearchFilter(id.mailbox("inbox"), unresolved))
      .toThrow("in:");
  });

  it("escapes an exact JMAP phrase without changing its text", () => {
    expect(stalwartSearchFilter(
      id.mailbox("inbox"),
      parseMailSearch('subject:"say \\"hello\\""'),
    )).toMatchObject({
      conditions: [{ inMailbox: "inbox" }, { subject: '"say \\"hello\\""' }],
    });
  });
});
