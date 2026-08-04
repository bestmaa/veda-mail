import { describe, expect, it } from "vitest";

import type { MailRule } from "@/domain/mail/rule";
import { previewStalwartRules } from "@/infrastructure/providers/stalwart-jmap/stalwart-rule-preview";
import type { StalwartJmapClient } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.client";

const rule = {
  actions: [{ kind: "star" }], conditions: [{
    kind: "header", name: "x-tenant", operator: "is", value: "north",
  }], createdAt: "2026-08-04T00:00:00.000Z", enabled: true,
  id: "11111111-1111-4111-8111-111111111111", match: "all",
  name: "Tenant", stopProcessing: false,
  updatedAt: "2026-08-04T00:00:00.000Z",
} as const satisfies MailRule;

describe("Stalwart rule preview", () => {
  it("requests bounded dynamic headers and evaluates in query order", async () => {
    let methods: unknown;
    const results = {
      emails: { accountId: "account-1", list: [{
        cc: [], from: [{ email: "sender@example.com" }], hasAttachment: false,
        "header:x-tenant:asText:all": ["north"], id: "m1",
        receivedAt: "2026-08-04T01:00:00.000Z", size: 123,
        subject: "Hello", to: [{ email: "member@example.com" }],
      }], state: "email-state" },
      query: { accountId: "account-1", ids: ["m1"], position: 0,
        queryState: "query-state", total: 1 },
    };
    const client = {
      getSession: async () => ({ primaryAccounts: {
        "urn:ietf:params:jmap:mail": "account-1",
      } }),
      request: async (value: unknown) => { methods = value; return {}; },
      result: (_response: unknown, tag: "emails" | "query", _name: string,
        schema: { parse(value: unknown): unknown }) => schema.parse(results[tag]),
    } as unknown as StalwartJmapClient;
    const preview = await previewStalwartRules(client, { limit: 10, rules: [rule] });
    expect(JSON.stringify(methods)).toContain("header:x-tenant:asText:all");
    expect(preview).toMatchObject([{
      evaluation: { matchedRuleIds: [rule.id] }, messageId: "m1",
    }]);
  });
});
