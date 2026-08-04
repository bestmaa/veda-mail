import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { MailRule } from "@/domain/mail/rule";
import { id } from "@/domain/shared/brand";
import {
  sieveDeliveryMailboxNames,
  sieveMailboxNames,
} from "@/infrastructure/providers/sieve/sieve-mailbox-names";
import { createOwnedSieveCompiler } from "@/infrastructure/providers/sieve/sieve-owned-compiler";

const originalKey = process.env["VEDA_MAIL_JOB_KEY"];
const rule: MailRule = {
  actions: [{ kind: "move", mailboxId: id.mailbox("child") }],
  conditions: [{ kind: "subject", operator: "contains", value: "invoice" }],
  createdAt: "2026-08-04T00:00:00.000Z",
  enabled: true,
  id: "11111111-1111-4111-8111-111111111111",
  match: "all",
  name: "Invoices",
  stopProcessing: true,
  updatedAt: "2026-08-04T00:00:00.000Z",
};

beforeEach(() => {
  process.env["VEDA_MAIL_JOB_KEY"] = Buffer.alloc(32, 9).toString("base64");
});

afterEach(() => {
  if (originalKey === undefined) delete process.env["VEDA_MAIL_JOB_KEY"];
  else process.env["VEDA_MAIL_JOB_KEY"] = originalKey;
});

describe("owned Sieve compiler", () => {
  it("signs the exact generated script and rejects tampering", () => {
    const compiler = createOwnedSieveCompiler({ child: "Projects/Invoices" });
    const script = compiler.compile([rule]);
    expect(script.content).toContain('fileinto "Projects/Invoices";');
    expect(compiler.verifyOwnership(script.content)).toBe(true);
    expect(compiler.verifyOwnership(script.content.replace("invoice", "payroll")))
      .toBe(false);
    expect(compiler.verifyOwnership(`# copied\r\n${script.content}`)).toBe(false);
  });

  it("resolves nested mailbox names and rejects hierarchy cycles", () => {
    const base = {
      color: "#000000", rights: { mayCreateChild: true, mayDelete: true,
        mayRename: true }, role: "custom" as const, sortOrder: 0,
      total: 0, unread: 0,
    };
    const parent = { ...base, id: id.mailbox("parent"), name: "Projects",
      parentId: null };
    const child = { ...base, id: id.mailbox("child"), name: "Invoices",
      parentId: parent.id };
    expect(sieveMailboxNames([parent, child])).toMatchObject({
      child: "Projects/Invoices", parent: "Projects",
    });
    expect(() => sieveMailboxNames([
      { ...parent, parentId: child.id }, child,
    ])).toThrow("cycle");
    expect(sieveDeliveryMailboxNames([
      parent,
      { ...child, rights: { ...child.rights, mayAddItems: true } },
      { ...parent, id: id.mailbox("sent"), name: "Sent", role: "sent",
        rights: { ...parent.rights, mayAddItems: true } },
    ])).toEqual({ child: "Projects/Invoices" });
  });
});
