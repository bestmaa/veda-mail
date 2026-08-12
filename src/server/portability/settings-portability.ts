import "server-only";

import type { MailLabel } from "@/domain/mail/label";
import type { Mailbox } from "@/domain/mail/mailbox";
import type { MailRule, MailRuleDefinition } from "@/domain/mail/rule";
import {
  hasDisallowedContentControl,
  hasUnpairedContentSurrogate,
  outgoingContentUtf8Bytes,
} from "@/domain/mail/outgoing-content-policy";
import {
  MAX_SETTINGS_PORTABILITY_BYTES,
  SETTINGS_PORTABILITY_FORMAT,
  SETTINGS_PORTABILITY_VERSION,
  type PortableMailboxTarget,
  type PortableMailRule,
  type PortableMailRuleAction,
  type SettingsPortabilityBundle,
} from "@/domain/member/settings-portability";
import { mailRuleConditionSchema } from "@/server/rules/rule-schema";
import { ApiError } from "@/transport/http/api-error";
import { messageListPreferencesSchema } from "@/transport/http/message-list-preferences.schema";
import { z } from "zod";

const mailboxRoleSchema = z.enum([
  "archive", "drafts", "inbox", "sent", "spam", "trash",
]);
const portableText = z.string().transform((value) => value.normalize("NFKC").trim())
  .pipe(z.string().min(1).max(128)).superRefine((value, context) => {
    if (hasUnpairedContentSurrogate(value) || hasDisallowedContentControl(value) ||
        outgoingContentUtf8Bytes(value) > 512) {
      context.addIssue({ code: "custom", message: "Portable text is unsafe or too long." });
    }
  });
const mailboxTargetSchema = z.discriminatedUnion("type", [
  z.object({ role: mailboxRoleSchema, type: z.literal("role") }).strict(),
  z.object({
    path: z.array(portableText).min(1).max(16),
    type: z.literal("path"),
  }).strict(),
]);
const portableRuleActionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("discard") }).strict(),
  z.object({ kind: z.literal("mark-read") }).strict(),
  z.object({ kind: z.literal("star") }).strict(),
  z.object({ kind: z.literal("label"), name: portableText }).strict(),
  z.object({ kind: z.literal("move"), target: mailboxTargetSchema }).strict(),
]);
const portableRuleSchema = z.object({
  actions: z.array(portableRuleActionSchema).min(1).max(8),
  conditions: z.array(mailRuleConditionSchema).min(1).max(10),
  enabled: z.boolean(),
  match: z.enum(["all", "any"]),
  name: portableText,
  stopProcessing: z.boolean(),
}).strict();

export const settingsPortabilityBundleSchema = z.object({
  exportedAt: z.string().datetime(),
  format: z.literal(SETTINGS_PORTABILITY_FORMAT),
  preferences: messageListPreferencesSchema,
  rules: z.array(portableRuleSchema).max(50),
  version: z.literal(SETTINGS_PORTABILITY_VERSION),
}).strict();

const fail = (message: string, code: string): never => {
  throw new ApiError(message, code, 422);
};
const canonical = (value: string): string => value.normalize("NFKC")
  .trim().toLocaleLowerCase("en-US");
const pathKey = (path: readonly string[]): string =>
  JSON.stringify(path.map(canonical));

const mailboxPath = (
  mailbox: Mailbox,
  byId: ReadonlyMap<string, Mailbox>,
): readonly string[] => {
  const path: string[] = [];
  const visited = new Set<string>();
  let current: Mailbox | undefined = mailbox;
  while (current) {
    if (visited.has(current.id) || path.length >= 16) {
      return fail(
        "A rule mailbox has an invalid or excessively deep hierarchy.",
        "SETTINGS_EXPORT_MAILBOX_HIERARCHY_INVALID",
      );
    }
    visited.add(current.id);
    path.unshift(current.name.normalize("NFKC").trim());
    const parentId = current.parentId;
    if (!parentId) break;
    current = byId.get(parentId);
    if (!current) {
      return fail(
        "A rule mailbox parent no longer exists.",
        "SETTINGS_EXPORT_MAILBOX_TARGET_MISSING",
      );
    }
  }
  return path;
};

const portableAction = (
  action: MailRule["actions"][number],
  mailboxes: readonly Mailbox[],
  labels: readonly MailLabel[],
): PortableMailRuleAction => {
  if (action.kind === "label") {
    const label = labels.find(({ id }) => id === action.labelId);
    if (!label) return fail(
      "A rule references a label that no longer exists.",
      "SETTINGS_EXPORT_LABEL_TARGET_MISSING",
    );
    return { kind: "label", name: label.name };
  }
  if (action.kind === "move") {
    const mailbox = mailboxes.find(({ id }) => id === action.mailboxId);
    if (!mailbox) return fail(
      "A rule references a mailbox that no longer exists.",
      "SETTINGS_EXPORT_MAILBOX_TARGET_MISSING",
    );
    const target: PortableMailboxTarget = mailbox.role === "custom"
      ? { path: mailboxPath(mailbox, new Map(mailboxes.map((item) => [item.id, item]))), type: "path" }
      : { role: mailbox.role, type: "role" };
    return { kind: "move", target };
  }
  return action;
};

export const createSettingsPortabilityBundle = (input: {
  readonly exportedAt?: string;
  readonly labels: readonly MailLabel[];
  readonly mailboxes: readonly Mailbox[];
  readonly preferences: SettingsPortabilityBundle["preferences"];
  readonly rules: readonly MailRule[];
}): SettingsPortabilityBundle => settingsPortabilityBundleSchema.parse({
  exportedAt: input.exportedAt ?? new Date().toISOString(),
  format: SETTINGS_PORTABILITY_FORMAT,
  preferences: input.preferences,
  rules: input.rules.map((rule): PortableMailRule => ({
    actions: rule.actions.map((action) => portableAction(
      action, input.mailboxes, input.labels,
    )),
    conditions: rule.conditions,
    enabled: rule.enabled,
    match: rule.match,
    name: rule.name,
    stopProcessing: rule.stopProcessing,
  })),
  version: SETTINGS_PORTABILITY_VERSION,
}) as SettingsPortabilityBundle;

export const parseSettingsPortabilityBundle = (
  value: unknown,
): SettingsPortabilityBundle => {
  const bundle = settingsPortabilityBundleSchema.parse(value);
  if (Buffer.byteLength(JSON.stringify(bundle), "utf8") > MAX_SETTINGS_PORTABILITY_BYTES) {
    return fail("The settings file is too large.", "SETTINGS_IMPORT_TOO_LARGE");
  }
  return bundle as SettingsPortabilityBundle;
};

const uniqueBy = <T>(
  values: readonly T[],
  key: (value: T) => string,
  missingMessage: string,
  ambiguousMessage: string,
): ((value: string) => T) => {
  const result = new Map<string, T>();
  const ambiguous = new Set<string>();
  for (const value of values) {
    const current = key(value);
    if (result.has(current)) ambiguous.add(current);
    else result.set(current, value);
  }
  for (const current of ambiguous) result.delete(current);
  return (value: string): T => {
    if (ambiguous.has(value)) {
      return fail(ambiguousMessage, "SETTINGS_IMPORT_TARGET_AMBIGUOUS");
    }
    return result.get(value) ?? fail(
      missingMessage,
      "SETTINGS_IMPORT_TARGET_MISSING",
    );
  };
};

export const resolvePortableRules = (input: {
  readonly labels: readonly MailLabel[];
  readonly mailboxes: readonly Mailbox[];
  readonly rules: readonly PortableMailRule[];
}): readonly MailRuleDefinition[] => {
  const byId = new Map(input.mailboxes.map((mailbox) => [mailbox.id, mailbox]));
  const roleMailboxes = uniqueBy(
    input.mailboxes.filter(({ role }) => role !== "custom"),
    ({ role }) => role,
    "A rule target mailbox is unavailable in this account.",
    "A rule target mailbox role is ambiguous in this account.",
  );
  const pathMailboxes = uniqueBy(
    input.mailboxes.filter(({ role }) => role === "custom"),
    (mailbox) => pathKey(mailboxPath(mailbox, byId)),
    "A rule target mailbox path is unavailable in this account.",
    "A rule target mailbox path is ambiguous in this account.",
  );
  const labels = uniqueBy(
    input.labels,
    ({ name }) => canonical(name),
    "A rule target label is unavailable in this account.",
    "A rule target label is ambiguous in this account.",
  );
  return input.rules.map((rule) => ({
    ...rule,
    actions: rule.actions.map((action) => {
      if (action.kind === "label") {
        return { kind: "label" as const, labelId: labels(canonical(action.name)).id };
      }
      if (action.kind === "move") {
        const mailbox = action.target.type === "role"
          ? roleMailboxes(action.target.role)
          : pathMailboxes(pathKey(action.target.path));
        if (mailbox.rights.mayAddItems === false) return fail(
          "A rule target mailbox does not allow message delivery.",
          "SETTINGS_IMPORT_MAILBOX_FORBIDDEN",
        );
        return { kind: "move" as const, mailboxId: mailbox.id };
      }
      return action;
    }),
  }));
};
