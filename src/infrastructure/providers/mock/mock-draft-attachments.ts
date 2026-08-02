import "server-only";

import { createHash } from "node:crypto";

import type { DraftContent, DraftDetail, DraftSaveInput } from "@/domain/mail/draft";
import { DraftConflictError } from "@/domain/mail/draft-errors";
import type { Attachment, OutgoingAttachment } from "@/domain/mail/mail";
import { id, type ProviderDraftId } from "@/domain/shared/brand";

export interface MockDraftAttachmentRecord {
  readonly detail: Attachment;
  readonly outgoing: OutgoingAttachment;
}

export type MockDraftAttachmentMap = Map<
  ProviderDraftId,
  readonly MockDraftAttachmentRecord[]
>;

const cloneOutgoing = (value: OutgoingAttachment): OutgoingAttachment => ({
  ...value,
  content: value.content.slice(),
});

const verifiedOutgoing = (value: OutgoingAttachment): OutgoingAttachment => {
  const content = Buffer.from(value.content);
  if (content.byteLength !== value.size ||
    createHash("sha256").update(content).digest("hex") !== value.sha256) {
    throw new Error("Draft attachment integrity check failed.");
  }
  return { ...value, content };
};

export const resolveMockDraftAttachments = (
  records: MockDraftAttachmentMap,
  input: DraftSaveInput,
): readonly OutgoingAttachment[] => {
  const existing = input.providerDraftId
    ? records.get(input.providerDraftId) ?? []
    : [];
  const retained = (input.retainedAttachmentIds ?? []).map((attachmentId) => {
    const match = existing.find(({ detail }) => detail.id === attachmentId);
    if (!match) throw new DraftConflictError();
    return cloneOutgoing(match.outgoing);
  });
  return [...retained, ...(input.attachments ?? []).map(verifiedOutgoing)];
};

export const bindMockDraftAttachments = (
  providerDraftId: ProviderDraftId,
  attachments: readonly OutgoingAttachment[],
): readonly MockDraftAttachmentRecord[] => attachments.map((outgoing, index) => ({
  detail: {
    disposition: "attachment",
    id: id.attachment(`${providerDraftId}-attachment-${index}`),
    mimeType: outgoing.mimeType,
    name: outgoing.name,
    size: outgoing.size,
  },
  outgoing: cloneOutgoing(outgoing),
}));

export const mockDraftAttachmentFingerprint = (
  attachments: readonly OutgoingAttachment[],
): string => createHash("sha256").update(JSON.stringify(attachments.map((item) => ({
  mimeType: item.mimeType,
  name: item.name,
  sha256: item.sha256,
  size: item.size,
})))).digest("hex");

export const mockDraftOutgoingAttachments = (
  records: MockDraftAttachmentMap,
  draft: DraftDetail,
): readonly OutgoingAttachment[] =>
  (records.get(draft.id) ?? []).map(({ outgoing }) => cloneOutgoing(outgoing));

export const deleteMockDraftAttachments = (
  records: MockDraftAttachmentMap,
  providerDraftId: ProviderDraftId,
): void => { records.delete(providerDraftId); };

const comparableContent = (content: DraftContent) => ({
  bcc: content.bcc.map(({ email, name }) => ({ email, name: name ?? null })),
  body: content.body,
  cc: content.cc.map(({ email, name }) => ({ email, name: name ?? null })),
  htmlBody: content.htmlBody ?? null,
  inReplyTo: content.inReplyTo ?? null,
  subject: content.subject,
  to: content.to.map(({ email, name }) => ({ email, name: name ?? null })),
});

export const sameMockDraftContent = (
  left: DraftContent,
  right: DraftContent,
): boolean => JSON.stringify(comparableContent(left)) ===
  JSON.stringify(comparableContent(right));
