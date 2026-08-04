import { describe, expect, it } from "vitest";

import type { MailRule } from "@/domain/mail/rule";
import { id } from "@/domain/shared/brand";
import {
  compileMailRulesToSieve,
  SieveRuleCapabilityError,
  SieveRuleCompileError,
} from "@/infrastructure/providers/sieve/sieve-compiler";

const allExtensions = [
  "envelope",
  "fileinto",
  "foreverypart",
  "imap4flags",
  "mime",
  "variables",
];

const rule = (overrides: Partial<MailRule> = {}): MailRule => ({
  actions: [{ kind: "star" }],
  conditions: [{ kind: "subject", operator: "contains", value: "release" }],
  createdAt: "2026-08-04T10:00:00.000Z",
  enabled: true,
  id: "a3e7315d-4e23-46d0-838d-a45e96a6283d",
  match: "all",
  name: "Release",
  stopProcessing: false,
  updatedAt: "2026-08-04T10:00:00.000Z",
  ...overrides,
});

describe("Sieve rules compiler", () => {
  it("emits deterministic CRLF Sieve with safe extension ordering", () => {
    const compiled = compileMailRulesToSieve({
      capabilities: { extensions: [...allExtensions].reverse(), maxScriptBytes: null },
      mailboxNames: { archive: 'Projects "A"\\Q' },
      rules: [rule({
        actions: [
          { kind: "move", mailboxId: id.mailbox("archive") },
          { kind: "label", labelId: id.label("veda-label-aaaaaaaaaaaaaaaaaaaaaaaaaa") },
          { kind: "star" },
          { kind: "mark-read" },
        ],
        conditions: [
          { kind: "subject", operator: "contains", value: "Release" },
          {
            field: "recipient",
            kind: "address",
            operator: "domain",
            value: "vedaconcepts.com",
          },
          { kind: "attachment", value: true },
        ],
        stopProcessing: true,
      })],
    });

    expect(compiled).toContain(
      'require ["envelope", "fileinto", "foreverypart", "imap4flags", "mime", "variables"];\r\n',
    );
    expect(compiled).toContain("set \"veda_attachment_0\" \"0\";\r\nforeverypart {");
    expect(compiled).toContain(
      'header :mime :param "filename" :matches ' +
      '["Content-Type", "Content-Disposition"] "?*"',
    );
    expect(compiled).toContain(
      'if allof(header :contains "subject" "Release", ' +
      'envelope :domain :is "to" "vedaconcepts.com", ' +
      'string :is "${veda_attachment_0}" "1") {',
    );
    expect(compiled).toContain('addflag "veda-label-aaaaaaaaaaaaaaaaaaaaaaaaaa";');
    expect(compiled).toContain('addflag "\\\\Flagged";');
    expect(compiled).toContain('addflag "\\\\Seen";');
    expect(compiled).toContain('fileinto "Projects \\"A\\"\\\\Q";');
    expect(compiled.indexOf("  addflag")).toBeLessThan(
      compiled.indexOf("  fileinto"),
    );
    expect(compiled.endsWith("  stop;\r\n}\r\n")).toBe(true);
    expect(compiled).not.toMatch(/(?<!\r)\n/u);
  });

  it("rejects attachment rules unless every exact MIME capability exists", () => {
    expect(() => compileMailRulesToSieve({
      capabilities: { extensions: ["mime", "variables"], maxScriptBytes: null },
      mailboxNames: {},
      rules: [rule({ conditions: [{ kind: "attachment", value: true }] })],
    })).toThrow(SieveRuleCapabilityError);
    expect(() => compileMailRulesToSieve({
      capabilities: { extensions: ["mime", "variables"], maxScriptBytes: null },
      mailboxNames: {},
      rules: [rule({ conditions: [{ kind: "attachment", value: true }] })],
    })).toThrow("foreverypart");
  });

  it("does not demand capabilities for disabled rules", () => {
    const compiled = compileMailRulesToSieve({
      capabilities: { extensions: [], maxScriptBytes: null },
      mailboxNames: {},
      rules: [rule({
        conditions: [{ kind: "attachment", value: true }],
        enabled: false,
      })],
    });
    expect(compiled).not.toContain("require");
    expect(compiled).not.toContain("foreverypart");
  });

  it("rejects unsafe bypass values, labels, missing mailboxes, and size limits", () => {
    expect(() => compileMailRulesToSieve({
      capabilities: { extensions: ["imap4flags"], maxScriptBytes: null },
      mailboxNames: {},
      rules: [rule({ conditions: [
        { kind: "subject", operator: "contains", value: "safe\r\nstop;" },
      ] })],
    })).toThrow(SieveRuleCompileError);
    expect(() => compileMailRulesToSieve({
      capabilities: { extensions: ["imap4flags"], maxScriptBytes: null },
      mailboxNames: {},
      rules: [rule({ actions: [{ kind: "label", labelId: id.label("unsafe") }] })],
    })).toThrow("Label identifier");
    expect(() => compileMailRulesToSieve({
      capabilities: { extensions: ["fileinto"], maxScriptBytes: null },
      mailboxNames: {},
      rules: [rule({
        actions: [{ kind: "move", mailboxId: id.mailbox("missing") }],
        stopProcessing: true,
      })],
    })).toThrow("mailbox is unavailable");
    expect(() => compileMailRulesToSieve({
      capabilities: { extensions: ["imap4flags"], maxScriptBytes: 10 },
      mailboxNames: {},
      rules: [rule()],
    })).toThrow("too large");
  });
});
