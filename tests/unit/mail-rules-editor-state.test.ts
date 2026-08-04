import { describe, expect, it } from "vitest";

import type { MailRule, MailRuleDefinition } from "@/domain/mail/rule";
import {
  appendMailRuleAction,
  definitionFromMailRule,
  replaceMailRuleAction,
} from "@/presentation/features/mail-workspace/mail-rules-editor-state";
import { isCurrentMailRuleRequest } from "@/presentation/features/mail-workspace/mail-rules-request-policy";
import { createMailRulePreviewItems } from "@/presentation/features/mail-workspace/mail-rules-preview";

const definition = (): MailRuleDefinition => ({
  actions: [{ kind: "mark-read" }],
  conditions: [{ kind: "subject", operator: "contains", value: "invoice" }],
  enabled: true, match: "all", name: "Invoices", stopProcessing: false,
});

describe("mail rules editor state", () => {
  it("copies only strict definition fields from a stored rule", () => {
    const rule: MailRule = {
      ...definition(), createdAt: "2026-08-04T00:00:00.000Z",
      id: "29ca093c-d8a8-4e2c-813c-f43fba2f3ad2",
      updatedAt: "2026-08-04T00:00:00.000Z",
    };
    expect(definitionFromMailRule(rule)).toEqual(definition());
    expect(definitionFromMailRule(rule)).not.toHaveProperty("id");
  });

  it("rejects duplicate and mutually exclusive terminal actions", () => {
    const current = appendMailRuleAction(definition(), { kind: "move", mailboxId: "archive" as never });
    expect(current.stopProcessing).toBe(true);
    expect(appendMailRuleAction(current, { kind: "discard" })).toBe(current);
    expect(appendMailRuleAction(definition(), { kind: "mark-read" })).toEqual(definition());
  });

  it("rejects replacing an action with a conflicting terminal action", () => {
    const current: MailRuleDefinition = {
      ...definition(), actions: [{ kind: "move", mailboxId: "archive" as never }, { kind: "star" }], stopProcessing: true,
    };
    expect(replaceMailRuleAction(current, 1, { kind: "discard" })).toBe(current);
  });

  it("rejects stale async results after the mailbox scope changes", () => {
    expect(isCurrentMailRuleRequest("new-scope", "old-scope")).toBe(false);
    expect(isCurrentMailRuleRequest("same-scope", "same-scope")).toBe(true);
    expect(isCurrentMailRuleRequest("", "")).toBe(false);
  });

  it("maps dry-run rule and action identifiers to safe display names", () => {
    const rule: MailRule = { ...definition(), createdAt: "2026-08-04T00:00:00.000Z",
      id: "29ca093c-d8a8-4e2c-813c-f43fba2f3ad2", updatedAt: "2026-08-04T00:00:00.000Z" };
    const items = createMailRulePreviewItems([{ evaluation: {
      actions: [{ action: { kind: "move", mailboxId: "archive" as never }, ruleId: rule.id }],
      matchedRuleIds: [rule.id], stoppedByRuleId: rule.id,
    }, from: ["billing@example.com"], messageId: "message-1" as never,
    receivedAt: "2026-08-04T00:00:00.000Z", subject: "Invoice" }], [rule],
    [{ id: "archive", label: "Archive" }], []);
    expect(items[0]).toMatchObject({ actions: "Move to Archive", matchedRules: "Invoices", subject: "Invoice" });
  });
});
