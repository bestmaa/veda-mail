import { describe, expect, it } from "vitest";

import type { MailRule, MailRuleMessageFacts } from "@/domain/mail/rule";
import { id } from "@/domain/shared/brand";
import {
  evaluateMailRules,
  mailRuleConditionMatches,
} from "@/server/rules/rule-evaluator";

const rule = (overrides: Partial<MailRule> = {}): MailRule => ({
  actions: [{ kind: "star" }],
  conditions: [{ kind: "subject", operator: "contains", value: "release" }],
  createdAt: "2026-08-04T10:00:00.000Z",
  enabled: true,
  id: crypto.randomUUID(),
  match: "all",
  name: "Rule",
  stopProcessing: false,
  updatedAt: "2026-08-04T10:00:00.000Z",
  ...overrides,
});

const facts: MailRuleMessageFacts = {
  cc: ["Lead@Example.com"],
  from: ["Ada <ada@example.com>"],
  hasAttachment: true,
  headers: { "x-project": ["Veda Mail"], "x-empty": [] },
  id: id.message("message-1"),
  recipient: ["team@vedaconcepts.com"],
  size: 20_000,
  subject: "August RELEASE plan",
  to: ["Team <team@vedaconcepts.com>"],
};

describe("mail rule evaluator", () => {
  it("matches every portable condition with explicit boundaries", () => {
    expect(mailRuleConditionMatches(
      { field: "from", kind: "address", operator: "domain", value: "example.com" },
      facts,
    )).toBe(true);
    expect(mailRuleConditionMatches(
      { field: "to", kind: "address", operator: "contains", value: "TEAM@" },
      facts,
    )).toBe(true);
    expect(mailRuleConditionMatches(
      { kind: "header", name: "X-Project", operator: "is", value: "veda mail" },
      facts,
    )).toBe(true);
    expect(mailRuleConditionMatches(
      { kind: "header", name: "x-empty", operator: "exists" },
      facts,
    )).toBe(true);
    expect(mailRuleConditionMatches(
      { bytes: 20_000, kind: "size", operator: "over" }, facts,
    )).toBe(false);
    expect(mailRuleConditionMatches(
      { bytes: 20_001, kind: "size", operator: "under" }, facts,
    )).toBe(true);
  });

  it("implements ALL/ANY and ignores disabled rules", () => {
    const all = rule({ conditions: [
      { kind: "subject", operator: "contains", value: "release" },
      { kind: "subject", operator: "contains", value: "missing" },
    ] });
    const any = rule({ ...all, id: crypto.randomUUID(), match: "any" });
    const disabled = rule({ enabled: false, id: crypto.randomUUID() });

    expect(evaluateMailRules([all, any, disabled], facts).matchedRuleIds)
      .toEqual([any.id]);
  });

  it("deduplicates non-terminal actions and lets the first terminal rule win", () => {
    const first = rule({ actions: [
      { kind: "star" },
      { kind: "label", labelId: id.label("veda-label-aaaaaaaaaaaaaaaaaaaaaaaaaa") },
    ] });
    const duplicate = rule({ actions: [{ kind: "star" }], id: crypto.randomUUID() });
    const terminal = rule({
      actions: [
        { kind: "move", mailboxId: id.mailbox("archive") },
        { kind: "mark-read" },
      ],
      id: crypto.randomUUID(),
      stopProcessing: true,
    });
    const unreachable = rule({ actions: [{ kind: "discard" }], id: crypto.randomUUID() });

    const result = evaluateMailRules([first, duplicate, terminal, unreachable], facts);
    expect(result.matchedRuleIds).toEqual([first.id, duplicate.id, terminal.id]);
    expect(result.stoppedByRuleId).toBe(terminal.id);
    expect(result.actions.map(({ action }) => action.kind))
      .toEqual(["label", "star", "mark-read", "move"]);
  });

  it("honors an explicit non-terminal stop", () => {
    const first = rule({ stopProcessing: true });
    const second = rule({ id: crypto.randomUUID() });
    const result = evaluateMailRules([first, second], facts);
    expect(result.matchedRuleIds).toEqual([first.id]);
    expect(result.stoppedByRuleId).toBe(first.id);
  });
});
