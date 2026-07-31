import "server-only";

import { createHash } from "node:crypto";

import type { DraftContent, DraftDetail } from "@/domain/mail/draft";
import {
  DraftConflictError,
  DraftNotFoundError,
} from "@/domain/mail/draft-errors";
import { isCanonicalDraftComposeHeader } from "@/domain/mail/draft-validation";
import { hasCanonicalDraftContent } from "@/domain/mail/draft-content-round-trip";
import type { MailAddress } from "@/domain/mail/mail";
import { id } from "@/domain/shared/brand";
import {
  hasLosslessDraftHeaders,
  hasSupportedDraftHeaderInventory,
} from "@/infrastructure/providers/stalwart-jmap/stalwart-draft-header-safety";
import { hasSupportedDraftBodyStructure } from "@/infrastructure/providers/stalwart-jmap/stalwart-draft-mime-safety";
import {
  jmapMessagePresentation,
  jmapTextBodyValue,
} from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap-body-presentation";
import type { JmapDraftEmail } from "@/infrastructure/providers/stalwart-jmap/stalwart-draft.schema";
import type { JmapEmail } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.types";
import {
  jmapDraftContentKeyword,
  VEDA_COMPOSE_KEYWORD_PREFIX,
  VEDA_CONTENT_KEYWORD_PREFIX,
  VEDA_SEND_CLAIM_KEYWORD_PREFIX,
} from "@/infrastructure/providers/stalwart-jmap/stalwart-draft-fingerprint";

const addresses = (
  values?:
    | readonly {
        readonly email: string;
        readonly name?: string | null | undefined;
      }[]
    | null,
): readonly MailAddress[] =>
  (values ?? []).map(({ email, name }) => ({ email, name: name ?? null }));

const presentationEmail = (email: JmapDraftEmail): JmapEmail => ({
  ...email,
  preview: "",
  size: 0,
  threadId: "draft",
});

const composeIdFrom = (email: JmapDraftEmail) => {
  const values = Object.entries(email.keywords)
    .filter(
      ([keyword, enabled]) =>
        enabled && keyword.startsWith(VEDA_COMPOSE_KEYWORD_PREFIX),
    )
    .map(([keyword]) => keyword.slice(VEDA_COMPOSE_KEYWORD_PREFIX.length));
  return values.length === 1 && isCanonicalDraftComposeHeader(values[0])
    ? id.draft(values[0])
    : null;
};

const hasMissingDraftBodyValue = (email: JmapDraftEmail): boolean =>
  [...(email.textBody ?? []), ...(email.htmlBody ?? [])].some(
    ({ partId }) =>
      !partId ||
      !Object.prototype.hasOwnProperty.call(email.bodyValues ?? {}, partId) ||
      email.bodyValues?.[partId]?.isEncodingProblem === true,
  );

const mediaType = (value: string): string =>
  value.split(";", 1)[0]?.trim().toLowerCase() ?? "";

const losslessBodyValue = (
  email: JmapDraftEmail,
  kind: "html" | "text",
  presented: string | null,
): boolean => {
  const parts =
    kind === "html" ? (email.htmlBody ?? []) : (email.textBody ?? []);
  if (parts.length === 0) {
    return kind === "html" ? presented === null : presented === "";
  }
  const part = parts.length === 1 ? parts[0] : undefined;
  const partId = part?.partId;
  const value = partId ? email.bodyValues?.[partId] : undefined;
  return (
    Boolean(part) &&
    mediaType(part?.type ?? "") ===
      `text/${kind === "html" ? "html" : "plain"}` &&
    Boolean(value) &&
    value?.isEncodingProblem !== true &&
    value?.isTruncated !== true &&
    value?.value === presented
  );
};

export const mapJmapDraft = (
  email: JmapDraftEmail,
  accountId: string,
  draftsMailboxId: string,
  requiredSendClaim?: string,
  authenticatedEmail?: string,
): DraftDetail => {
  const claims = Object.entries(email.keywords)
    .filter(
      ([keyword, enabled]) =>
        enabled && keyword.startsWith(VEDA_SEND_CLAIM_KEYWORD_PREFIX),
    )
    .map(([keyword]) => keyword);
  if (
    (requiredSendClaim &&
      (claims.length !== 1 || claims[0] !== requiredSendClaim)) ||
    (!requiredSendClaim && claims.length > 1)
  ) {
    throw new DraftConflictError();
  }
  if (
    email.keywords["$draft"] !== true ||
    email.mailboxIds[draftsMailboxId] !== true
  ) {
    throw new DraftNotFoundError();
  }
  const source = presentationEmail(email);
  const presentation = jmapMessagePresentation(source, accountId);
  const textBody = jmapTextBodyValue(source);
  const content: DraftContent = {
    bcc: addresses(email.bcc),
    body: textBody,
    cc: addresses(email.cc),
    ...(presentation.htmlBody ? { htmlBody: presentation.htmlBody } : {}),
    subject: email.subject ?? "",
    to: addresses(email.to),
  };
  return {
    composeId: composeIdFrom(email),
    content,
    hasAttachments: email.hasAttachment || presentation.attachments.length > 0,
    hasTruncatedContent:
      email.bodyValuesTruncated === true ||
      hasMissingDraftBodyValue(email) ||
      Object.values(email.bodyValues ?? {}).some(
        (value) =>
          value.isEncodingProblem === true || value.isTruncated === true,
      ) ||
      !losslessBodyValue(email, "text", textBody) ||
      !losslessBodyValue(email, "html", presentation.htmlBody) ||
      !hasLosslessDraftHeaders(email) ||
      !hasSupportedDraftHeaderInventory(email) ||
      !hasSupportedDraftBodyStructure(email) ||
      !hasCanonicalDraftContent(content) ||
      (email.replyTo?.length ?? 0) > 0 ||
      (email.sender?.length ?? 0) > 0 ||
      (authenticatedEmail !== undefined &&
        ((email.from?.length ?? 0) !== 1 ||
          email.from?.[0]?.email.toLowerCase() !==
            authenticatedEmail.toLowerCase())),
    hasUncertainSubmission: !requiredSendClaim && claims.length === 1,
    id: id.providerDraft(email.id),
    revision: jmapDraftRevision(accountId, email.id),
    updatedAt: email.receivedAt,
  };
};

export const jmapDraftRevision = (accountId: string, emailId: string): string =>
  `jmap-draft-v1-${createHash("sha256")
    .update(accountId)
    .update("\0")
    .update(emailId)
    .digest("base64url")}`;

const canonicalComparableDraftContent = (content: DraftContent) => ({
  bcc: content.bcc.map(({ email, name }) => ({ email, name: name ?? null })),
  body: content.body,
  cc: content.cc.map(({ email, name }) => ({ email, name: name ?? null })),
  htmlBody: content.htmlBody ?? null,
  subject: content.subject,
  to: content.to.map(({ email, name }) => ({ email, name: name ?? null })),
});

export const sameDraftContent = (
  left: DraftContent,
  right: DraftContent,
): boolean =>
  JSON.stringify(canonicalComparableDraftContent(left)) ===
  JSON.stringify(canonicalComparableDraftContent(right));

export const matchesStoredJmapDraftContent = (
  email: JmapDraftEmail,
  mapped: DraftContent,
  expected: DraftContent,
): boolean => {
  const fingerprints = Object.entries(email.keywords).filter(
    ([keyword, enabled]) =>
      enabled && keyword.startsWith(VEDA_CONTENT_KEYWORD_PREFIX),
  );
  if (fingerprints.length === 0) return sameDraftContent(mapped, expected);
  const keyword = fingerprints.length === 1 ? fingerprints[0]?.[0] : undefined;
  const fingerprint = keyword?.slice(VEDA_CONTENT_KEYWORD_PREFIX.length);
  if (!fingerprint || !/^[0-9a-f]{64}$/.test(fingerprint)) return false;
  return (
    keyword === jmapDraftContentKeyword(expected) &&
    sameDraftContent(mapped, expected)
  );
};
