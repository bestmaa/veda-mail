import { describe, expect, it } from "vitest";

import type { MailLabel } from "@/domain/mail/label";
import type { Mailbox } from "@/domain/mail/mailbox";
import type { MailRule } from "@/domain/mail/rule";
import { DEFAULT_MESSAGE_LIST_PREFERENCES } from "@/domain/mail/message-list-preferences";
import { id } from "@/domain/shared/brand";
import {
  createSettingsPortabilityBundle,
  parseSettingsPortabilityBundle,
  resolvePortableRules,
} from "@/server/portability/settings-portability";

const rights = {
  mayAddItems: true,
  mayCreateChild: true,
  mayDelete: true,
  mayRemoveItems: true,
  mayRename: true,
  maySetKeywords: true,
};
const mailbox = (
  value: string,
  name: string,
  role: Mailbox["role"],
  parentId: Mailbox["parentId"] = null,
): Mailbox => ({
  color: "#64748b",
  id: id.mailbox(value),
  name,
  parentId,
  rights,
  role,
  sortOrder: 0,
  total: 0,
  unread: 0,
});
const label = (value: string, name: string): MailLabel => ({
  color: "#4f46e5",
  id: id.label(value),
  name,
});
const storedRule = (actions: MailRule["actions"]): MailRule => ({
  actions,
  conditions: [{ kind: "subject", operator: "contains", value: "invoice" }],
  createdAt: "2026-08-12T00:00:00.000Z",
  enabled: true,
  id: "11111111-1111-4111-8111-111111111111",
  match: "all",
  name: "File invoices",
  stopProcessing: true,
  updatedAt: "2026-08-12T00:00:00.000Z",
});

describe("settings portability", () => {
  it("exports provider identifiers as mailbox roles, paths, and label names", () => {
    const inbox = mailbox("provider-inbox", "Inbox", "inbox");
    const projects = mailbox("provider-projects", "Projects", "custom");
    const invoices = mailbox(
      "provider-invoices", "Invoices", "custom", projects.id,
    );
    const work = label("veda-label-aaaaaaaaaaaaaaaaaaaaaaaaaa", "Work");
    const bundle = createSettingsPortabilityBundle({
      exportedAt: "2026-08-12T00:00:00.000Z",
      labels: [work],
      mailboxes: [inbox, projects, invoices],
      preferences: DEFAULT_MESSAGE_LIST_PREFERENCES,
      rules: [storedRule([
        { kind: "move", mailboxId: inbox.id },
        { kind: "label", labelId: work.id },
      ]), storedRule([{ kind: "move", mailboxId: invoices.id }])],
    });
    expect(bundle.rules[0]?.actions).toEqual([
      { kind: "move", target: { role: "inbox", type: "role" } },
      { kind: "label", name: "Work" },
    ]);
    expect(bundle.rules[1]?.actions).toEqual([
      { kind: "move", target: { path: ["Projects", "Invoices"], type: "path" } },
    ]);
    expect(JSON.stringify(bundle)).not.toContain("provider-inbox");
    expect(JSON.stringify(bundle)).not.toContain(work.id);
  });

  it("resolves portable targets against a different provider identity", () => {
    const inbox = mailbox("new-inbox", "INBOX", "inbox");
    const projects = mailbox("new-projects", "Projects", "custom");
    const invoices = mailbox("new-invoices", "Invoices", "custom", projects.id);
    const work = label("veda-label-bbbbbbbbbbbbbbbbbbbbbbbbbb", "work");
    const definitions = resolvePortableRules({
      labels: [work],
      mailboxes: [inbox, projects, invoices],
      rules: [{
        actions: [
          { kind: "move", target: { role: "inbox", type: "role" } },
          { kind: "label", name: "WORK" },
        ],
        conditions: [{ kind: "subject", operator: "contains", value: "invoice" }],
        enabled: true,
        match: "all",
        name: "Portable",
        stopProcessing: true,
      }, {
        actions: [{
          kind: "move",
          target: { path: ["projects", "invoices"], type: "path" },
        }],
        conditions: [{ kind: "subject", operator: "is", value: "paid" }],
        enabled: false,
        match: "any",
        name: "Nested",
        stopProcessing: true,
      }],
    });
    expect(definitions[0]?.actions).toEqual([
      { kind: "move", mailboxId: inbox.id },
      { kind: "label", labelId: work.id },
    ]);
    expect(definitions[1]?.actions).toEqual([
      { kind: "move", mailboxId: invoices.id },
    ]);
  });

  it("keeps custom paths separate from standard-role mailbox names", () => {
    const standardInbox = mailbox("standard-inbox", "Inbox", "inbox");
    const customInbox = mailbox("custom-inbox", "Inbox", "custom");
    const [definition] = resolvePortableRules({
      labels: [],
      mailboxes: [standardInbox, customInbox],
      rules: [{
        actions: [{ kind: "move", target: { path: ["Inbox"], type: "path" } }],
        conditions: [{ kind: "subject", operator: "is", value: "custom" }],
        enabled: true, match: "all", name: "Custom inbox", stopProcessing: true,
      }],
    });
    expect(definition?.actions).toEqual([
      { kind: "move", mailboxId: customInbox.id },
    ]);
  });

  it("fails closed for missing, ambiguous, unwritable, and malformed targets", () => {
    const inbox = mailbox("inbox-one", "Inbox", "inbox");
    expect(() => resolvePortableRules({
      labels: [],
      mailboxes: [inbox],
      rules: [{
        actions: [{ kind: "label", name: "Missing" }],
        conditions: [{ kind: "subject", operator: "is", value: "x" }],
        enabled: true, match: "all", name: "Missing", stopProcessing: false,
      }],
    })).toThrow(expect.objectContaining({ code: "SETTINGS_IMPORT_TARGET_MISSING" }));
    expect(() => resolvePortableRules({
      labels: [],
      mailboxes: [inbox, mailbox("inbox-two", "Inbox 2", "inbox")],
      rules: [{
        actions: [{ kind: "move", target: { role: "inbox", type: "role" } }],
        conditions: [{ kind: "subject", operator: "is", value: "x" }],
        enabled: true, match: "all", name: "Ambiguous", stopProcessing: true,
      }],
    })).toThrow(expect.objectContaining({ code: "SETTINGS_IMPORT_TARGET_AMBIGUOUS" }));
    expect(() => parseSettingsPortabilityBundle({
      exportedAt: "not-a-date",
      format: "other/settings",
      preferences: DEFAULT_MESSAGE_LIST_PREFERENCES,
      rules: [],
      version: 1,
    })).toThrow();
  });
});
