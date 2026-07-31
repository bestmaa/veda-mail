import { hasHeaderControlCharacter } from "@/domain/mail/header-safety";
import {
  canonicalizeDraftMailContentValue,
  hasCanonicalDraftMailContent,
} from "@/domain/mail/outgoing-mail-canonicalizer";
import {
  hasDisallowedContentControl,
  hasUnpairedContentSurrogate,
  outgoingContentWithinLimit,
  outgoingContentUtf8Bytes,
} from "@/domain/mail/outgoing-content-policy";
import { id } from "@/domain/shared/brand";
import type {
  ComposerRecoveryJournal,
  ComposerRecoverySnapshot,
} from "@/presentation/features/mail-workspace/composer-recovery.types";
import {
  composeDraftIdSchema,
  draftContentSchema,
  draftRevisionSchema,
  providerDraftIdSchema,
} from "@/transport/http/draft-schemas";
import { replyMessageIdSchema } from "@/transport/http/request-schemas";
import { z } from "zod";
export const MAX_COMPOSER_RECOVERY_BYTES = 3 * 1024 * 1024;
const MAX_RAW_RECIPIENT_CHARACTERS = 32_000;
const MAX_RAW_SUBJECT_CHARACTERS = 4_096;
const safeMetadata = (maximum: number) => z.string().min(1).max(maximum)
  .refine((value) =>
    !hasHeaderControlCharacter(value) &&
    !hasDisallowedContentControl(value) &&
    !hasUnpairedContentSurrogate(value));
const rawHeader = (maximum: number) => z.string().max(maximum)
  .refine((value) =>
    !hasHeaderControlCharacter(value) &&
    !hasDisallowedContentControl(value) &&
    !hasUnpairedContentSurrogate(value));
const recoveryText = z.string().refine((value) =>
  outgoingContentWithinLimit(value) &&
  !hasDisallowedContentControl(value) &&
  !hasUnpairedContentSurrogate(value));
const ownerSchema = z.object({
  accountId: safeMetadata(255).transform(id.account),
  providerId: safeMetadata(255).transform(id.provider),
  sessionExpiresAt: z.string().datetime({ offset: true }),
  sessionScope: z.string().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/u),
}).strict();
const bodySchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("plain"), text: recoveryText }).strict(),
  z.object({
    html: recoveryText,
    mode: z.literal("rich"),
    preserveLoadedHtml: z.boolean(),
    text: recoveryText,
  }).strict().refine(
    ({ html, text }) => hasCanonicalDraftMailContent({ body: text, htmlBody: html }),
    "Rich recovery content is not canonical.",
  ),
]);
export const composerRecoverySnapshotSchema = z.object({
  bcc: rawHeader(MAX_RAW_RECIPIENT_CHARACTERS),
  body: bodySchema,
  cc: rawHeader(MAX_RAW_RECIPIENT_CHARACTERS),
  hadLocalAttachments: z.boolean(),
  inReplyTo: replyMessageIdSchema.optional(),
  signatureDisposition: z.enum(["detached", "none"]),
  subject: rawHeader(MAX_RAW_SUBJECT_CHARACTERS),
  title: z.enum([
    "Edit draft", "Forward message", "New message", "Reply all", "Reply",
  ]),
  to: rawHeader(MAX_RAW_RECIPIENT_CHARACTERS),
}).strict();
const generationSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const acknowledgementSchema = z.object({
  generation: generationSchema,
  providerDraftId: providerDraftIdSchema,
  revision: draftRevisionSchema,
}).strict();
const saveAttemptBase = {
  composeId: composeDraftIdSchema,
  content: draftContentSchema,
  contentGeneration: generationSchema,
} as const;
const pendingSaveSchema = z.union([
  z.object(saveAttemptBase).strict(),
  z.object({
    ...saveAttemptBase,
    expectedRevision: draftRevisionSchema,
    providerDraftId: providerDraftIdSchema,
  }).strict(),
]);
const terminalOwnerSchema = ownerSchema.pick({
  accountId: true, providerId: true, sessionScope: true,
});
const terminalBase = {
  composeId: composeDraftIdSchema,
  generation: generationSchema,
  intentId: z.string().uuid(),
  issuedAt: z.string().datetime({ offset: true }),
  owner: terminalOwnerSchema,
} as const;
const sendTerminalBase = {
  ...terminalBase,
  kind: z.literal("send"),
  requestFingerprint: z.string().regex(/^[0-9a-f]{64}$/u),
  state: z.enum(["armed", "uncertain"]),
} as const;
const terminalIntentSchema = z.union([
  z.object({
    ...terminalBase,
    expectedRevision: draftRevisionSchema,
    kind: z.literal("discard"), providerDraftId: providerDraftIdSchema,
    state: z.literal("armed"),
  }).strict(),
  z.object(sendTerminalBase).strict(),
  z.object({
    ...sendTerminalBase,
    expectedDraftRevision: draftRevisionSchema,
    providerDraftId: providerDraftIdSchema,
  }).strict(),
]);
export const composerRecoveryJournalSchema = z.object({
  acknowledged: acknowledgementSchema.optional(),
  composeId: composeDraftIdSchema,
  localGeneration: generationSchema,
  owner: ownerSchema,
  pendingSave: pendingSaveSchema.optional(),
  recordId: z.string().uuid(),
  snapshot: composerRecoverySnapshotSchema,
  storageRevision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  terminalIntent: terminalIntentSchema.optional(),
  updatedAt: z.string().datetime({ offset: true }),
  version: z.literal(1),
}).strict().superRefine((journal, context) => {
  const pending = journal.pendingSave;
  const acknowledged = journal.acknowledged;
  if (pending?.composeId !== undefined && pending.composeId !== journal.composeId) {
    context.addIssue({ code: "custom", message: "Compose IDs differ." });
  }
  if (
    (acknowledged?.generation ?? 0) > journal.localGeneration ||
    (pending?.contentGeneration ?? 0) > journal.localGeneration
  ) {
    context.addIssue({ code: "custom", message: "Recovery generation is invalid." });
  }
  if (pending && "providerDraftId" in pending) {
    if (
      !acknowledged ||
      acknowledged.providerDraftId !== pending.providerDraftId ||
      acknowledged.revision !== pending.expectedRevision ||
      pending.contentGeneration <= acknowledged.generation
    ) {
      context.addIssue({ code: "custom", message: "Pending update has no matching acknowledgement." });
    }
  } else if (pending && acknowledged) {
    context.addIssue({ code: "custom", message: "Pending create cannot have an acknowledgement." });
  }
  const terminal = journal.terminalIntent;
  if (terminal && pending) {
    context.addIssue({ code: "custom", message: "A terminal intent cannot coexist with a pending save." });
  }
  if (terminal && (
    terminal.composeId !== journal.composeId ||
    terminal.generation !== journal.localGeneration ||
    terminal.owner.accountId !== journal.owner.accountId ||
    terminal.owner.providerId !== journal.owner.providerId ||
    terminal.owner.sessionScope !== journal.owner.sessionScope
  )) {
    context.addIssue({ code: "custom", message: "Terminal intent scope is invalid." });
  }
  if (terminal && Date.parse(terminal.issuedAt) > Date.parse(journal.updatedAt)) {
    context.addIssue({ code: "custom", message: "Terminal intent timestamp is invalid." });
  }
  if (terminal?.kind === "send") {
    const providerDraftId = "providerDraftId" in terminal ? terminal.providerDraftId : undefined;
    const expectedDraftRevision = "expectedDraftRevision" in terminal ? terminal.expectedDraftRevision : undefined;
    if (
      acknowledged?.providerDraftId !== providerDraftId ||
      acknowledged?.revision !== expectedDraftRevision
    ) {
      context.addIssue({ code: "custom", message: "Send draft reference differs." });
    }
  }
  if (terminal?.kind === "discard" && (
    terminal.providerDraftId !== acknowledged?.providerDraftId ||
    terminal.expectedRevision !== acknowledged?.revision
  )) {
    context.addIssue({ code: "custom", message: "Discard draft reference differs." });
  }
  if (Date.parse(journal.updatedAt) > Date.parse(journal.owner.sessionExpiresAt)) {
    context.addIssue({ code: "custom", message: "Recovery outlives its session." });
  }
});

const serializedBytes = (value: unknown): number => {
  try {
    return outgoingContentUtf8Bytes(JSON.stringify(value));
  } catch {
    return Number.POSITIVE_INFINITY;
  }
};
export const canonicalComposerRecoverySnapshot = (
  snapshot: ComposerRecoverySnapshot,
): ComposerRecoverySnapshot => {
  const body = snapshot.body.mode === "plain"
    ? snapshot.body
    : (() => {
        const canonical = canonicalizeDraftMailContentValue({
          body: snapshot.body.text,
          htmlBody: snapshot.body.html,
        });
        return {
          html: canonical.htmlBody ?? "",
          mode: "rich" as const,
          preserveLoadedHtml: snapshot.body.preserveLoadedHtml,
          text: canonical.body,
        };
      })();
  return composerRecoverySnapshotSchema.parse({
    ...snapshot,
    body,
  }) as ComposerRecoverySnapshot;
};

export const canonicalComposerRecoveryJournal = (
  journal: ComposerRecoveryJournal,
): ComposerRecoveryJournal => {
  const candidate = {
    ...journal,
    ...(journal.pendingSave ? {
      pendingSave: {
        ...journal.pendingSave,
        content: draftContentSchema.parse(journal.pendingSave.content),
      },
    } : {}),
    snapshot: canonicalComposerRecoverySnapshot(journal.snapshot),
  };
  if (serializedBytes(candidate) > MAX_COMPOSER_RECOVERY_BYTES) {
    throw new RangeError("The recovery journal exceeds its safe size limit.");
  }
  return composerRecoveryJournalSchema.parse(candidate) as ComposerRecoveryJournal;
};
export const parseComposerRecoveryJournal = (
  value: unknown,
): ComposerRecoveryJournal | null => {
  if (serializedBytes(value) > MAX_COMPOSER_RECOVERY_BYTES) return null;
  const parsed = composerRecoveryJournalSchema.safeParse(value);
  return parsed.success ? parsed.data as ComposerRecoveryJournal : null;
};
