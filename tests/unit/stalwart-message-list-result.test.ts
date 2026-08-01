import { describe, expect, it } from "vitest";

import { assertStalwartMessageListResult } from "@/infrastructure/providers/stalwart-jmap/stalwart-message-list-result";

const query = {
  accountId: "account-a",
  ids: ["message-a", "message-b"],
  position: 50,
  queryState: "query-state",
  total: 100,
};
const emails = {
  accountId: "account-a",
  list: [{ id: "message-a" }, { id: "message-b" }],
  state: "email-state",
};

describe("Stalwart message-list result validation", () => {
  it("accepts the exact account, position, bounded IDs, and response order", () => {
    expect(() => assertStalwartMessageListResult(
      "account-a", 50, 50, query, emails,
    )).not.toThrow();
  });

  it.each([
    ["cross-account query", { ...query, accountId: "account-b" }, emails],
    ["cross-account get", query, { ...emails, accountId: "account-b" }],
    ["wrong position", { ...query, position: 0 }, emails],
    ["duplicate IDs", { ...query, ids: ["message-a", "message-a"] }, emails],
    ["missing object", query, { ...emails, list: [emails.list[0]!] }],
    ["reordered objects", query, { ...emails, list: emails.list.toReversed() }],
  ])("rejects %s", (_name, invalidQuery, invalidEmails) => {
    expect(() => assertStalwartMessageListResult(
      "account-a", 50, 50, invalidQuery, invalidEmails,
    )).toThrow("inconsistent message list");
  });
});
