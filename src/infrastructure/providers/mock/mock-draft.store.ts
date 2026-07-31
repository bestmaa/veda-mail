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
import { mockMailboxIds } from "@/infrastructure/providers/mock/mock-seed";

const comparableContent = (content: DraftContent) => ({
  bcc: content.bcc.map(({ email, name }) => ({ email, name: name ?? null })),
  body: content.body,
  cc: content.cc.map(({ email, name }) => ({ email, name: name ?? null })),
  htmlBody: content.htmlBody ?? null,
  inReplyTo: content.inReplyTo ?? null,
  subject: content.subject,
  to: content.to.map(({ email, name }) => ({ email, name: name ?? null })),
});

const sameContent = (left: DraftContent, right: DraftContent): boolean =>
  JSON.stringify(comparableContent(left)) ===
  JSON.stringify(comparableContent(right));

const cloneDraft = (draft: DraftDetail): DraftDetail =>
  structuredClone(draft);

const MAX_REPLACEMENT_REPLAYS = 256;

interface MockDraftReplacementReplay {
  readonly composeId: DraftId;
  readonly expectedRevision: string;
  readonly replacementId: ProviderDraftId;
}

export class MockDraftStore {
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
  }

  public async get(providerDraftId: ProviderDraftId): Promise<DraftDetail> {
    return cloneDraft(this.require(providerDraftId));
  }

  public async save(input: DraftSaveInput): Promise<DraftDetail> {
    validateDraftSaveInput(input);
    const composeId = canonicalDraftComposeId(input.composeId);
    if (!input.providerDraftId) {
      const reconciled = [...this.drafts.values()].find(
        (draft) => draft.composeId === composeId,
      );
      if (reconciled) {
        if (!sameContent(reconciled.content, input.content)) {
          throw new DraftConflictError();
        }
        return cloneDraft(reconciled);
      }
      return this.create(composeId, input.content);
    }
    const expectedRevision = assertDraftRevision(input.expectedRevision);
    const current = this.drafts.get(input.providerDraftId);
    if (!current) {
      return this.reconcileReplacementReplay(
        input.providerDraftId,
        composeId,
        expectedRevision,
        input.content,
      );
    }
    if (
      current.revision !== expectedRevision ||
      (current.composeId !== null && current.composeId !== composeId)
    ) {
      throw new DraftConflictError();
    }
    this.drafts.delete(current.id);
    const replacement = this.create(composeId, input.content);
    this.rememberReplacementReplay(
      current.id,
      composeId,
      expectedRevision,
      replacement.id,
    );
    return replacement;
  }

  public messages(): readonly MessageDetail[] {
    return [...this.drafts.values()].map((draft) => ({
      attachments: [],
      cc: structuredClone(draft.content.cc),
      from: [{ email: "member@example.com", name: "Sample Member" }],
      hasAttachment: false,
      htmlBody: draft.content.htmlBody ?? null,
      id: id.message(draft.id),
      isStarred: false,
      isUnread: false,
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
  ): void {
    if (!providerDraft) return;
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
    this.drafts.delete(current.id);
  }

  private create(
    composeId: DraftDetail["composeId"],
    content: DraftContent,
  ): DraftDetail {
    this.revision += 1;
    const providerDraftId = id.providerDraft(
      `mock-draft-${crypto.randomUUID()}`,
    );
    const draft: DraftDetail = {
      composeId,
      content: structuredClone(content),
      hasAttachments: false,
      hasTruncatedContent: false,
      hasUncertainSubmission: false,
      id: providerDraftId,
      revision: `mock-revision-${this.revision}`,
      updatedAt: new Date().toISOString(),
    };
    this.drafts.set(providerDraftId, draft);
    return cloneDraft(draft);
  }

  private reconcileReplacementReplay(
    oldId: ProviderDraftId,
    composeId: DraftId,
    expectedRevision: string,
    content: DraftContent,
  ): DraftDetail {
    const replay = this.replacementReplays.get(oldId);
    if (!replay) throw new DraftNotFoundError();
    const replacement = this.drafts.get(replay.replacementId);
    if (
      replay.composeId !== composeId ||
      replay.expectedRevision !== expectedRevision ||
      replacement?.composeId !== composeId ||
      !sameContent(replacement.content, content)
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
  ): void {
    this.replacementReplays.set(oldId, {
      composeId,
      expectedRevision,
      replacementId,
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
