import "server-only";

import { createHash } from "node:crypto";

import type { DraftSaveInput } from "@/domain/mail/draft";
import { DraftConflictError } from "@/domain/mail/draft-errors";
import {
  uploadVerifiedJmapAttachments,
  type JmapComposeAttachment,
} from "@/infrastructure/providers/stalwart-jmap/jmap-compose-attachments";
import {
  bindJmapReceivedAttachments,
  readJmapReceivedAttachmentProviderBlobId,
} from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap-attachment";
import type { StalwartJmapClient } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.client";
import type { JmapDraftEmail } from "@/infrastructure/providers/stalwart-jmap/stalwart-draft.schema";

const retainedAttachments = (
  accountId: string,
  email: JmapDraftEmail,
  ids: DraftSaveInput["retainedAttachmentIds"],
): readonly JmapComposeAttachment[] => (ids ?? []).map((id) => {
  const match = bindJmapReceivedAttachments(accountId, email).find(
    ({ metadata }) => metadata.id === id && metadata.disposition === "attachment",
  );
  const blobId = match
    ? readJmapReceivedAttachmentProviderBlobId(match)
    : null;
  if (!match || !blobId) throw new DraftConflictError();
  return {
    blobId,
    name: match.metadata.name,
    size: match.metadata.size,
    type: match.metadata.mimeType,
  };
});

export const allStalwartDraftAttachments = (
  accountId: string,
  email: JmapDraftEmail,
): readonly JmapComposeAttachment[] =>
  retainedAttachments(
    accountId,
    email,
    bindJmapReceivedAttachments(accountId, email)
      .filter(({ metadata }) => metadata.disposition === "attachment")
      .map(({ metadata }) => metadata.id),
  );

export const resolveStalwartDraftAttachments = async (
  client: StalwartJmapClient,
  accountId: string,
  input: DraftSaveInput,
  existing?: JmapDraftEmail,
): Promise<readonly JmapComposeAttachment[]> => {
  if (!existing && (input.retainedAttachmentIds?.length ?? 0) > 0) {
    throw new DraftConflictError();
  }
  if ((input.retainedAttachmentIds?.length ?? 0) +
    (input.attachments?.length ?? 0) > 10) {
    throw new DraftConflictError();
  }
  const retained = existing
    ? retainedAttachments(accountId, existing, input.retainedAttachmentIds)
    : [];
  const uploaded = await uploadVerifiedJmapAttachments(client, accountId, {
    attachments: input.attachments ?? [],
    bcc: input.content.bcc,
    body: input.content.body,
    cc: input.content.cc,
    ...(input.content.htmlBody ? { htmlBody: input.content.htmlBody } : {}),
    subject: input.content.subject,
    to: input.content.to,
  });
  return [...retained, ...uploaded];
};

export const jmapDraftAttachmentFingerprint = (
  attachments: readonly JmapComposeAttachment[],
): string => createHash("sha256").update(JSON.stringify(attachments.map((item) => ({
  name: item.name,
  size: item.size,
  type: item.type,
})))).digest("hex");

const jmapStoredAttachmentFingerprint = (
  attachments: readonly JmapComposeAttachment[],
): string => createHash("sha256").update(JSON.stringify(attachments.map((item) => ({
  blobId: item.blobId,
  name: item.name,
  size: item.size,
  type: item.type,
})))).digest("hex");

export const jmapDraftAttachmentIntent = (input: DraftSaveInput): string =>
  createHash("sha256").update(JSON.stringify({
    retained: input.retainedAttachmentIds ?? [],
    uploaded: (input.attachments ?? []).map((item) => ({
      mimeType: item.mimeType,
      name: item.name,
      sha256: item.sha256,
      size: item.size,
    })),
  })).digest("hex");

export const sameJmapDraftAttachments = (
  accountId: string,
  email: JmapDraftEmail,
  expected: readonly JmapComposeAttachment[],
): boolean => {
  // Stalwart materializes uploaded blobs into MIME parts and may assign those
  // parts new blob IDs. The signed attachment intent binds the source bytes;
  // verify the resulting ordered inventory here instead of a transient ID.
  const actual = bindJmapReceivedAttachments(accountId, email).flatMap((item) => {
    const blobId = readJmapReceivedAttachmentProviderBlobId(item);
    return item.metadata.disposition === "attachment" && blobId
      ? [{
          blobId,
          name: item.metadata.name,
          size: item.metadata.size,
          type: item.metadata.mimeType,
        }]
      : [];
  });
  return jmapDraftAttachmentFingerprint(actual) ===
    jmapDraftAttachmentFingerprint(expected);
};

export const sameStoredJmapDraftAttachments = (
  accountId: string,
  left: JmapDraftEmail,
  right: JmapDraftEmail,
): boolean => jmapStoredAttachmentFingerprint(
  allStalwartDraftAttachments(accountId, left),
) === jmapStoredAttachmentFingerprint(
  allStalwartDraftAttachments(accountId, right),
);
