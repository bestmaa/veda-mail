import { describe, expect, it } from "vitest";

import { MAX_MAIL_RULES } from "@/domain/mail/rule";
import {
  parseMailRule,
  parseMailRuleBook,
  parseMailRulePutOperation,
} from "@/server/rules/rule-schema";

const baseRule = () => ({
  actions: [{ kind: "star" }],
  conditions: [{ kind: "subject", operator: "contains", value: "Release" }],
  createdAt: "2026-08-04T10:00:00.000Z",
  enabled: true,
  id: "A3E7315D-4E23-46D0-838D-A45E96A6283D",
  match: "all",
  name: " Release updates ",
  stopProcessing: false,
  updatedAt: "2026-08-04T10:00:00.000Z",
});

describe("mail rule schema", () => {
  it("creates canonical NFKC records and header names", () => {
    const parsed = parseMailRule({
      ...baseRule(),
      conditions: [{
        kind: "header",
        name: "X-ＦＯＯ",
        operator: "contains",
        value: " ＡＢＣ ",
      }],
    });

    expect(parsed.id).toBe("a3e7315d-4e23-46d0-838d-a45e96a6283d");
    expect(parsed.name).toBe("Release updates");
    expect(parsed.conditions).toEqual([{
      kind: "header",
      name: "x-foo",
      operator: "contains",
      value: "ABC",
    }]);
  });

  it.each(["\u0000", "\u202e", "\u2066", "\r\n"])(
    "rejects unsafe rule text %j",
    (unsafe) => {
      expect(() => parseMailRule({ ...baseRule(), name: `Rule${unsafe}` }))
        .toThrow("unsafe characters");
    },
  );

  it("rejects invalid header tokens and unsafe values", () => {
    expect(() => parseMailRule({
      ...baseRule(),
      conditions: [{ kind: "header", name: "X:Injected", operator: "exists" }],
    })).toThrow("Header name is invalid");
    expect(() => parseMailRule({
      ...baseRule(),
      conditions: [{
        kind: "subject",
        operator: "contains",
        value: "x".repeat(257),
      }],
    })).toThrow("too long");
  });

  it("rejects duplicate and conflicting actions and conditions", () => {
    expect(() => parseMailRule({
      ...baseRule(),
      actions: [{ kind: "star" }, { kind: "star" }],
    })).toThrow("actions must be unique");
    expect(() => parseMailRule({
      ...baseRule(),
      actions: [{ kind: "move", mailboxId: "inbox" }, { kind: "discard" }],
      stopProcessing: true,
    })).toThrow("one terminal action");
    expect(() => parseMailRule({
      ...baseRule(),
      actions: [{ kind: "discard" }],
    })).toThrow("must stop later rules");
    expect(() => parseMailRule({
      ...baseRule(),
      conditions: [baseRule().conditions[0], baseRule().conditions[0]],
    })).toThrow("conditions must be unique");
  });

  it("bounds books and validates ordering operations", () => {
    const rules = Array.from({ length: MAX_MAIL_RULES + 1 }, (_, index) => ({
      ...baseRule(),
      id: crypto.randomUUID(),
      name: `Rule ${index}`,
    }));
    expect(() => parseMailRuleBook({ revision: null, rules, version: 1 }))
      .toThrow();
    const ruleId = crypto.randomUUID();
    expect(() => parseMailRulePutOperation({
      expectedRevision: null,
      operation: "reorder",
      ruleIds: [ruleId, ruleId],
    })).toThrow("contains duplicates");
  });

  it("parses a canonical create operation", () => {
    const source = baseRule();
    const definition = {
      actions: source.actions,
      conditions: source.conditions,
      enabled: source.enabled,
      match: source.match,
      name: source.name,
      stopProcessing: source.stopProcessing,
    };
    expect(parseMailRulePutOperation({
      definition,
      expectedRevision: null,
      operation: "create",
    })).toMatchObject({ operation: "create", definition: { name: "Release updates" } });
  });
});
