import { describe, expect, it } from "vitest";

import { parseWorkspaceQuery } from "@/transport/http/workspace-query";

const request = (query = ""): Request =>
  new Request(`https://mail.example.com/api/v1/mail/workspace${query}`);

describe("workspace query parser", () => {
  it("returns only canonical supported values and trims search", () => {
    expect(parseWorkspaceQuery(request(
      "?mailboxId=inbox-1&cursor=opaque-cursor&search=%20quarterly%20&sort=oldest&preview=hide",
    ))).toEqual({
      cursor: "opaque-cursor",
      mailboxId: "inbox-1",
      search: {
        canonical: "quarterly",
        criteria: [{ field: "text", type: "text", value: "quarterly" }],
      },
      showPreview: false,
      sort: "oldest",
    });
    expect(parseWorkspaceQuery(request("?preview=show&sort=newest"))).toEqual({
      showPreview: true,
      sort: "newest",
    });
    expect(parseWorkspaceQuery(request("?search=%20%20"))).toEqual({});
  });

  it.each(["cursor", "mailboxId", "preview", "sort"])(
    "rejects a present-but-empty %s with the stable query error",
    (name) => {
      expect(() => parseWorkspaceQuery(request(`?${name}=`))).toThrowError(
        expect.objectContaining({ code: "INVALID_MAILBOX_QUERY", status: 400 }),
      );
    },
  );

  it.each(["cursor", "mailboxId", "preview", "search", "sort"])(
    "rejects a repeated %s parameter",
    (name) => {
      expect(() => parseWorkspaceQuery(
        request(`?${name}=first&${name}=second`),
      )).toThrowError(expect.objectContaining({
        code: "INVALID_MAILBOX_QUERY",
        status: 400,
      }));
    },
  );

  it("rejects unsupported parameters and a cursor without its mailbox", () => {
    expect(() => parseWorkspaceQuery(request("?providerToken=secret")))
      .toThrowError(expect.objectContaining({
        code: "INVALID_MAILBOX_QUERY",
        status: 400,
      }));
    expect(() => parseWorkspaceQuery(request("?cursor=opaque")))
      .toThrowError(expect.objectContaining({
        code: "INVALID_MAILBOX_QUERY",
        status: 400,
      }));
  });

  it.each([
    ["preview", "maybe"],
    ["sort", "sender"],
    ["sort", "NEWEST"],
    ["mailboxId", "x".repeat(2_049)],
    ["cursor", "x".repeat(2_049)],
  ])("rejects invalid or oversized %s values", (name, value) => {
    const mailbox = name === "cursor" ? "&mailboxId=inbox" : "";
    expect(() => parseWorkspaceQuery(
      request(`?${name}=${encodeURIComponent(value)}${mailbox}`),
    )).toThrow();
  });

  it("accepts bounded multi-term search and rejects an oversized request", () => {
    const valid = Array.from({ length: 5 }, () => "x".repeat(199)).join(" ");
    expect(parseWorkspaceQuery(request(`?search=${valid}`)).search?.canonical)
      .toBe(valid);
    expect(() => parseWorkspaceQuery(request(`?search=${"x".repeat(1_001)}`)))
      .toThrowError(expect.objectContaining({
        code: "INVALID_MAILBOX_QUERY",
        status: 400,
      }));
  });
});
