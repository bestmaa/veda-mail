import "server-only";

import type { ImapFlow } from "imapflow";

import type { DraftCapability, DraftDetail, DraftSaveInput, SavedProviderDraft } from "@/domain/mail/draft";
import { DraftConflictError, DraftContentTruncatedError, DraftNotFoundError, DraftUnavailableError } from "@/domain/mail/draft-errors";
import { sameDraftContent } from "@/infrastructure/providers/stalwart-jmap/stalwart-draft.mapper";
import { assertDraftRevision, canonicalDraftComposeId, validateDraftSaveInput } from "@/domain/mail/draft-validation";
import type { DraftId, ProviderDraftId } from "@/domain/shared/brand";
import type { OutgoingAttachment } from "@/domain/mail/mail";
import {
  assertImapDraftReplaceable,
  imapDraftAttachmentFingerprint,
  resolveImapDraftSaveAttachments,
  sameImapDraftAttachmentSelection,
} from "@/infrastructure/providers/imap-smtp/imap-draft-attachments";
import { decodeScopedImapMessageId, imapUidValidityMatches } from "@/infrastructure/providers/imap-smtp/imap-codec";
import { withImapClient } from "@/infrastructure/providers/imap-smtp/imap-client";
import { composeImapDraft, imapDraftWriteHeader } from "@/infrastructure/providers/imap-smtp/imap-draft-mime";
import {
  type ImapDraftContext,
  openImapDraftMailbox,
  searchImapDraftHeader,
} from "@/infrastructure/providers/imap-smtp/imap-draft-mailbox";
import { withImapDraftOperation } from "@/infrastructure/providers/imap-smtp/imap-draft-operation-lock";
import {
  loadImapDraftRecord,
  MAX_IMAP_DRAFT_SOURCE_BYTES,
} from "@/infrastructure/providers/imap-smtp/imap-draft-record";
import type { ImapSmtpMemberConfig } from "@/infrastructure/providers/imap-smtp/imap-smtp.types";

export class ImapDraftStore {
  public constructor(private readonly config: ImapSmtpMemberConfig) {}

  public capability(): Promise<DraftCapability> {
    return withImapClient(this.config, async (client) => {
      try {
        await openImapDraftMailbox(client);
        return { status: "supported" as const };
      } catch (error) {
        if (error instanceof DraftUnavailableError) {
          return { status: "unavailable" as const };
        }
        throw error;
      }
    });
  }

  public get(providerDraftId: ProviderDraftId): Promise<DraftDetail> {
    return withImapClient(this.config, async (client) =>
      (await this.loadReference(
        client,
        await openImapDraftMailbox(client, true),
        providerDraftId,
      ))
        .detail,
    );
  }

  public save(input: DraftSaveInput): Promise<DraftDetail> {
    validateDraftSaveInput(input);
    return withImapDraftOperation(this.config, input.composeId, () =>
      withImapClient(this.config, async (client) => {
        const active = await openImapDraftMailbox(client);
        const composeId = canonicalDraftComposeId(input.composeId);
        const matches = await searchImapDraftHeader(
          client,
          "X-Veda-Compose-Id",
          composeId,
        );
        if (input.providerDraftId) {
          const existing = await this.loadReference(
            client,
            active,
            input.providerDraftId,
          );
          assertImapDraftReplaceable(existing, input, matches);
          const attachments = resolveImapDraftSaveAttachments(existing, input);
          return this.replace(client, active, existing.detail, input, attachments);
        }
        if (matches.length === 1) {
          const existing = await this.loadUid(client, active, matches[0]!);
          if (
            !existing.detail.hasTruncatedContent &&
            sameDraftContent(existing.detail.content, input.content) &&
            sameImapDraftAttachmentSelection(existing, input)
          ) {
            return existing.detail;
          }
          throw new DraftConflictError();
        }
        if (matches.length > 1) throw new DraftConflictError();
        return this.append(
          client,
          active,
          composeId,
          input.content,
          input.attachments ?? [],
        );
      }),
    );
  }

  public discard(
    providerDraftId: ProviderDraftId,
    expectedRevision: string,
  ): Promise<void> {
    return withImapClient(this.config, async (client) => {
      const active = await openImapDraftMailbox(client);
      const existing = await this.loadReference(client, active, providerDraftId);
      if (existing.detail.revision !== assertDraftRevision(expectedRevision)) {
        throw new DraftConflictError();
      }
      if (!(await client.messageDelete(existing.uid, { uid: true }))) {
        throw new DraftConflictError();
      }
    });
  }

  public async prepareSend(source: SavedProviderDraft) {
    const record = await withImapClient(this.config, async (client) =>
      this.loadReference(
        client,
        await openImapDraftMailbox(client, true),
        source.id,
      ),
    );
    const detail = record.detail;
    const composeId = canonicalDraftComposeId(source.composeId);
    if (
      detail.composeId !== composeId ||
      detail.revision !== assertDraftRevision(source.expectedRevision)
    ) {
      throw new DraftConflictError();
    }
    if (detail.hasTruncatedContent) throw new DraftContentTruncatedError();
    return record;
  }

  private async append(
    client: ImapFlow,
    active: ImapDraftContext,
    composeId: DraftId,
    content: DraftSaveInput["content"],
    attachments: readonly OutgoingAttachment[],
  ): Promise<DraftDetail> {
    const { raw, writeId } = await composeImapDraft(
      content,
      composeId,
      this.config.username,
      attachments,
    );
    if (raw.byteLength > MAX_IMAP_DRAFT_SOURCE_BYTES) {
      throw new DraftContentTruncatedError();
    }
    const appended = await client.append(active.mailbox, raw, ["\\Draft"]);
    if (!appended) throw new DraftUnavailableError();
    let uid = appended.uid;
    if (!uid) {
      const matches = await searchImapDraftHeader(
        client,
        imapDraftWriteHeader,
        writeId,
      );
      uid = matches.length === 1 ? matches[0] : undefined;
    }
    if (!uid) throw new DraftConflictError();
    const saved = (await this.loadUid(client, active, uid)).detail;
    if (
      saved.hasTruncatedContent ||
      saved.composeId !== composeId ||
      !sameDraftContent(saved.content, content) ||
      imapDraftAttachmentFingerprint(
        (await this.loadUid(client, active, uid)).attachments.map(
          ({ outgoing }) => outgoing,
        ),
      ) !== imapDraftAttachmentFingerprint(attachments)
    ) {
      await client.messageDelete(uid, { uid: true });
      throw new DraftConflictError();
    }
    return saved;
  }

  private async replace(
    client: ImapFlow,
    active: ImapDraftContext,
    old: DraftDetail,
    input: Extract<DraftSaveInput, { readonly providerDraftId: ProviderDraftId }>,
    attachments: readonly OutgoingAttachment[],
  ): Promise<DraftDetail> {
    const replacement = await this.append(
      client,
      active,
      canonicalDraftComposeId(input.composeId),
      input.content,
      attachments,
    );
    const oldReference = decodeScopedImapMessageId(this.config, old.id);
    if (await client.messageDelete(oldReference.uid, { uid: true })) {
      return replacement;
    }
    const replacementReference = decodeScopedImapMessageId(
      this.config,
      replacement.id,
    );
    await client.messageDelete(replacementReference.uid, { uid: true });
    throw new DraftConflictError();
  }

  private async loadReference(
    client: ImapFlow,
    active: ImapDraftContext,
    providerDraftId: ProviderDraftId,
  ) {
    let reference: ReturnType<typeof decodeScopedImapMessageId>;
    try {
      reference = decodeScopedImapMessageId(this.config, providerDraftId);
    } catch {
      throw new DraftNotFoundError();
    }
    if (
      reference.mailbox !== active.mailbox ||
      !imapUidValidityMatches(reference, active.uidValidity)
    ) {
      throw new DraftNotFoundError();
    }
    return this.loadUid(client, active, reference.uid);
  }

  private async loadUid(client: ImapFlow, active: ImapDraftContext, uid: number) {
    return loadImapDraftRecord({
      client,
      config: this.config,
      mailbox: active.mailbox,
      uid,
      uidValidity: active.uidValidity,
    });
  }
}
