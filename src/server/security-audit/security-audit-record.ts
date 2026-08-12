import "server-only";

import { z } from "zod";

export const MAX_SECURITY_AUDIT_ENTRIES = 10_000;

export const securityAuditActionSchema = z.enum([
  "admin.account.updated",
  "admin.authentication.challenge",
  "admin.authentication.failed",
  "admin.authentication.signed-out",
  "admin.authentication.succeeded",
  "admin.capabilities.updated",
  "admin.mail-policy.updated",
  "admin.mail-service.updated",
  "admin.mail-user.created",
  "admin.organization.updated",
  "admin.retention.updated",
  "admin.session.revoked",
  "admin.two-factor.disabled",
  "admin.two-factor.enrolled",
  "admin.two-factor.recovery-regenerated",
  "mailbox.deleted",
  "mailbox.emptied",
  "member.authentication.challenge",
  "member.authentication.failed",
  "member.authentication.signed-out",
  "member.authentication.succeeded",
  "member.calendar.exported",
  "member.contacts.exported",
  "member.contacts.imported",
  "member.message.exported",
  "member.message.imported",
  "member.settings.exported",
  "member.settings.imported",
  "member.delegation.created",
  "member.delegation.deleted",
  "member.delegation.updated",
  "member.rule.created",
  "member.rule.deleted",
  "member.rule.reconciled",
  "member.rule.reordered",
  "member.rule.toggled",
  "member.rule.updated",
  "member.session.revoked",
  "member.two-factor.disabled",
  "member.two-factor.enrolled",
  "member.two-factor.recovery-regenerated",
  "member.vacation.updated",
  "messages.destroyed",
  "setup.completed",
  "system.retention.checkpointed",
]);

const digestSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/u);
const requestIdSchema = z.string().regex(/^[A-Za-z0-9_-]{16,64}$/u);

export const securityAuditEntrySchema = z.object({
  action: securityAuditActionSchema,
  actorId: digestSchema,
  actorType: z.enum(["administrator", "anonymous", "member", "system"]),
  at: z.string().datetime(),
  count: z.number().int().min(0).max(10_000).nullable(),
  id: z.string().uuid(),
  integrity: digestSchema,
  outcome: z.enum(["attempt", "challenge", "failure", "partial", "success"]),
  previousIntegrity: digestSchema,
  requestId: requestIdSchema.nullable(),
  sequence: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  targetId: digestSchema.nullable(),
  targetType: z.enum([
    "authentication",
    "calendar",
    "contacts",
    "delegation",
    "mail-policy",
    "mail-service",
    "mailbox",
    "messages",
    "organization",
    "retention",
    "rule",
    "session",
    "settings",
    "two-factor",
    "user",
    "vacation",
  ]).nullable(),
}).strict();

export const securityAuditFileSchema = z.object({
  anchor: digestSchema.nullable(),
  droppedCount: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  entries: z.array(securityAuditEntrySchema).max(MAX_SECURITY_AUDIT_ENTRIES),
  integrity: digestSchema.nullable(),
  keyCheck: digestSchema.nullable(),
  nextSequence: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  updatedAt: z.string().datetime(),
  version: z.literal(1),
}).strict().superRefine((file, context) => {
  const isPristine = file.entries.length === 0;
  if (isPristine && (
    file.anchor !== null ||
    file.droppedCount !== 0 ||
    file.integrity !== null ||
    file.keyCheck !== null ||
    file.nextSequence !== 1 ||
    file.updatedAt !== new Date(0).toISOString()
  )) {
    context.addIssue({
      code: "custom",
      message: "An empty security audit store must be pristine.",
    });
  }
  if (!isPristine && (
    file.anchor === null ||
    file.integrity === null ||
    file.keyCheck === null
  )) {
    context.addIssue({
      code: "custom",
      message: "A populated security audit store must include integrity metadata.",
    });
  }
});

export type SecurityAuditAction = z.infer<typeof securityAuditActionSchema>;
export type SecurityAuditEntry = z.infer<typeof securityAuditEntrySchema>;
export type SecurityAuditFile = z.infer<typeof securityAuditFileSchema>;

export type SecurityAuditAppend = Pick<SecurityAuditEntry,
  "action" | "actorId" | "actorType" | "count" | "outcome" |
  "requestId" | "targetId" | "targetType"
>;

export const emptySecurityAuditFile = (): SecurityAuditFile => ({
  anchor: null,
  droppedCount: 0,
  entries: [],
  integrity: null,
  keyCheck: null,
  nextSequence: 1,
  updatedAt: new Date(0).toISOString(),
  version: 1,
});
