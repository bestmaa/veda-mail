import "server-only";

import type {
  DraftCapability,
  DraftContent,
  DraftDetail,
  DraftSaveInput,
  SavedProviderDraft,
} from "@/domain/mail/draft";
import {
  DraftConflictError,
  DraftHasAttachmentsError,
  DraftNotFoundError,
} from "@/domain/mail/draft-errors";
import {
  assertDraftRevision,
  canonicalDraftComposeId,
  validateDraftSaveInput,
} from "@/domain/mail/draft-validation";
import type { MessageDetail } from "@/domain/mail/mail";
import {
  id,
  type DraftId,
  type ProviderDraftId,
} from "@/domain/shared/brand";
import type { OutgoingAttachment } from "@/domain/mail/mail";
import {
  bindMockDraftAttachments,
  deleteMockDraftAttachments,
  mockDraftAttachmentFingerprint,
  mockDraftOutgoingAttachments,
  resolveMockDraftAttachments,
  sameMockDraftContent,
  type MockDraftAttachmentMap,
} from "@/infrastructure/providers/mock/mock-draft-attachments";
import { mockMailboxIds } from "@/infrastructure/providers/mock/mock-seed";

const cloneDraft = (draft: DraftDetail): DraftDetail =>
  structuredClone(draft);

const MAX_REPLACEMENT_REPLAYS = 256;

interface MockDraftReplacementReplay {
  readonly attachmentFingerprint: string;
  readonly composeId: DraftId;
  readonly expectedRevision: string;
  readonly replacementId: ProviderDraftId;
}

export class MockDraftStore {
  private readonly attachments: MockDraftAttachmentMap = new Map();
  private readonly drafts = new Map<ProviderDraftId, DraftDetail>();
  private readonly replacementReplays = new Map<
    ProviderDraftId,
    MockDraftReplacementReplay
  >();
  private revision = 0;

  public async capability(): Promise<DraftCapability> {
    return { status: "supported" };
  }

  public async discard(
    providerDraftId: ProviderDraftId,
    expectedRevision: string,
  ): Promise<void> {
    const current = this.require(providerDraftId);
    if (current.revision !== assertDraftRevision(expectedRevision)) {
      throw new DraftConflictError();
    }
    this.drafts.delete(providerDraftId);
    deleteMockDraftAttachments(this.attachments, providerDraftId);
  }

  public async get(providerDraftId: ProviderDraftId): Promise<DraftDetail> {
    return cloneDraft(this.require(providerDraftId));
  }

  public async save(input: DraftSaveInput): Promise<DraftDetail> {
    validateDraftSaveInput(input);
    const composeId = canonicalDraftComposeId(input.composeId);
    const attachments = resolveMockDraftAttachments(this.attachments, input);
    if (!input.providerDraftId) {
      const reconciled = [...this.drafts.values()].find(
        (draft) => draft.composeId === composeId,
      );
      if (reconciled) {
        if (!sameMockDraftContent(reconciled.content, input.content) ||
          mockDraftAttachmentFingerprint(
            mockDraftOutgoingAttachments(this.attachments, reconciled),
          ) !== mockDraftAttachmentFingerprint(attachments)) {
          throw new DraftConflictError();
        }
        return cloneDraft(reconciled);
      }
      return this.create(composeId, input.content, attachments);
    }
    const expectedRevision = assertDraftRevision(input.expectedRevision);
    const current = this.drafts.get(input.providerDraftId);
    if (!current) {
      return this.reconcileReplacementReplay(
        input.providerDraftId,
        composeId,
        expectedRevision,
        input.content,
        attachments,
      );
    }
    if (
      current.revision !== expectedRevision ||
      (current.composeId !== null && current.composeId !== composeId)
    ) {
      throw new DraftConflictError();
    }
    this.drafts.delete(current.id);
    deleteMockDraftAttachments(this.attachments, current.id);
    const replacement = this.create(composeId, input.content, attachments);
    this.rememberReplacementReplay(
      current.id,
      composeId,
      expectedRevision,
      replacement.id,
      mockDraftAttachmentFingerprint(attachments),
    );
    return replacement;
  }

  public messages(): readonly MessageDetail[] {
    return [...this.drafts.values()].map((draft) => ({
      attachments: structuredClone(draft.attachments ?? []),
      cc: structuredClone(draft.content.cc),
      from: [{ email: "member@example.com", name: "Sample Member" }],
      hasAttachment: draft.hasAttachments,
      htmlBody: draft.content.htmlBody ?? null,
      id: id.message(draft.id),
      isStarred: false,
      isUnread: false,
      labelIds: [],
      mailboxIds: [mockMailboxIds.drafts],
      preview: draft.content.body.slice(0, 140),
      receivedAt: draft.updatedAt,
      replyTo: [],
      size: new TextEncoder().encode(
        draft.content.body + (draft.content.htmlBody ?? ""),
      ).byteLength,
      subject: draft.content.subject,
      textBody: draft.content.body,
      threadId: id.thread(`thread-${draft.id}`),
      to: structuredClone(draft.content.to),
    }));
  }

  public consumeForSend(
    providerDraft?: SavedProviderDraft,
    hasAttachments = false,
  ): readonly OutgoingAttachment[] {
    if (!providerDraft) return [];
    if (hasAttachments) throw new DraftHasAttachmentsError();
    const current = this.require(providerDraft.id);
    if (
      current.revision !== assertDraftRevision(
        providerDraft.expectedRevision,
      ) ||
      current.composeId !== canonicalDraftComposeId(providerDraft.composeId)
    ) {
      throw new DraftConflictError();
    }
    const attachments = mockDraftOutgoingAttachments(this.attachments, current);
    this.drafts.delete(current.id);
    deleteMockDraftAttachments(this.attachments, current.id);
    return attachments;
  }

  private create(
    composeId: DraftDetail["composeId"],
    content: DraftContent,
    outgoing: readonly OutgoingAttachment[],
  ): DraftDetail {
    this.revision += 1;
    const providerDraftId = id.providerDraft(
      `mock-draft-${crypto.randomUUID()}`,
    );
    const bound = bindMockDraftAttachments(providerDraftId, outgoing);
    const draft: DraftDetail = {
      attachments: bound.map(({ detail }) => detail),
      composeId,
      content: structuredClone(content),
      hasAttachments: bound.length > 0,
      hasTruncatedContent: false,
      hasUncertainSubmission: false,
      id: providerDraftId,
      revision: `mock-revision-${this.revision}`,
      updatedAt: new Date().toISOString(),
    };
    this.drafts.set(providerDraftId, draft);
    this.attachments.set(providerDraftId, bound);
    return cloneDraft(draft);
  }

  private reconcileReplacementReplay(
    oldId: ProviderDraftId,
    composeId: DraftId,
    expectedRevision: string,
    content: DraftContent,
    attachments: readonly OutgoingAttachment[],
  ): DraftDetail {
    const replay = this.replacementReplays.get(oldId);
    if (!replay) throw new DraftNotFoundError();
    const replacement = this.drafts.get(replay.replacementId);
    if (
      replay.composeId !== composeId ||
      replay.expectedRevision !== expectedRevision ||
      replay.attachmentFingerprint !== mockDraftAttachmentFingerprint(attachments) ||
      replacement?.composeId !== composeId ||
      !sameMockDraftContent(replacement.content, content)
    ) {
      throw new DraftConflictError();
    }
    return cloneDraft(replacement);
  }

  private rememberReplacementReplay(
    oldId: ProviderDraftId,
    composeId: DraftId,
    expectedRevision: string,
    replacementId: ProviderDraftId,
    attachmentFingerprint: string,
  ): void {
    this.replacementReplays.set(oldId, {
      composeId,
      expectedRevision,
      replacementId,
      attachmentFingerprint,
    });
    while (this.replacementReplays.size > MAX_REPLACEMENT_REPLAYS) {
      const oldest = this.replacementReplays.keys().next().value;
      if (!oldest) break;
      this.replacementReplays.delete(oldest);
    }
  }

  private require(providerDraftId: ProviderDraftId): DraftDetail {
    const draft = this.drafts.get(providerDraftId);
    if (!draft) throw new DraftNotFoundError();
    return draft;
  }
}
