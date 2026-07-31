import "server-only";

import type {
  DraftCapability,
  DraftDetail,
  DraftSaveInput,
  SavedProviderDraft,
} from "@/domain/mail/draft";
import {
  DraftConflictError,
  DraftContentTruncatedError,
  DraftHasAttachmentsError,
  DraftNotFoundError,
  DraftUnavailableError,
} from "@/domain/mail/draft-errors";
import {
  assertDraftRevision,
  canonicalDraftComposeId,
  validateDraftSaveInput,
} from "@/domain/mail/draft-validation";
import type { ProviderDraftId } from "@/domain/shared/brand";
import type { StalwartJmapClient } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.client";
import {
  StalwartJmapHttpError,
  StalwartJmapMethodError,
  type StalwartJmapRequestBoundary,
} from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap-client-helpers";
import { assertDraftDestroyed } from "@/infrastructure/providers/stalwart-jmap/stalwart-draft-mutation";
import { assertStalwartDraftComposeMembers } from "@/infrastructure/providers/stalwart-jmap/stalwart-draft-compose-members";
import {
  StalwartDraftReader,
  type StalwartDraftRecord,
} from "@/infrastructure/providers/stalwart-jmap/stalwart-draft.reader";
import { saveStalwartDraft } from "@/infrastructure/providers/stalwart-jmap/stalwart-draft-save";
import {
  prepareStalwartDraftSendSource,
  type StalwartDraftSendSource,
} from "@/infrastructure/providers/stalwart-jmap/stalwart-draft-send-source";
import { assertOrphanReplacementCandidate } from "@/infrastructure/providers/stalwart-jmap/stalwart-draft-replacement";
import type { StalwartMailReader } from "@/infrastructure/providers/stalwart-jmap/stalwart-mail.reader";
import { JMAP_MAIL } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.types";

export type { StalwartDraftSendSource } from "@/infrastructure/providers/stalwart-jmap/stalwart-draft-send-source";

export class StalwartDraftStore {
  private readonly drafts: StalwartDraftReader;

  public constructor(
    private readonly client: StalwartJmapClient,
    private readonly mail: StalwartMailReader,
  ) {
    this.drafts = new StalwartDraftReader(client, mail);
  }

  public capability(): Promise<DraftCapability> {
    return this.drafts.capability();
  }

  public get(providerDraftId: ProviderDraftId): Promise<DraftDetail> {
    return this.drafts.get(providerDraftId);
  }

  public async prepareSend(
    source: SavedProviderDraft,
  ): Promise<StalwartDraftSendSource> {
    return prepareStalwartDraftSendSource(this.drafts, source);
  }

  public async save(input: DraftSaveInput): Promise<DraftDetail> {
    validateDraftSaveInput(input);
    const composeId = canonicalDraftComposeId(input.composeId);
    const context = await this.drafts.context();
    if (!input.providerDraftId) {
      const state = await this.drafts.state(context);
      return saveStalwartDraft(this.client, this.mail, this.drafts, {
        composeId,
        content: input.content,
        context,
        state,
      });
    }
    let existing: StalwartDraftRecord;
    try {
      existing = await this.drafts.load(context, input.providerDraftId);
    } catch (error) {
      if (!(error instanceof DraftNotFoundError)) throw error;
      if (await this.drafts.isPresent(context, input.providerDraftId)) {
        throw new DraftConflictError();
      }
      const recovered = await this.drafts.findByComposeId(context, composeId);
      if (!recovered) throw error;
      assertOrphanReplacementCandidate(
        recovered,
        {
          accountId: context.accountId,
          composeId,
          content: input.content,
          oldId: input.providerDraftId,
          oldRevision: assertDraftRevision(input.expectedRevision),
        },
        await this.mail.getAccount(),
      );
      return recovered.detail;
    }
    if (
      existing.detail.revision !==
        assertDraftRevision(input.expectedRevision) ||
      (existing.detail.composeId !== null &&
        existing.detail.composeId !== composeId)
    ) {
      throw new DraftConflictError();
    }
    if (existing.detail.hasAttachments) {
      throw new DraftHasAttachmentsError();
    }
    if (existing.detail.hasUncertainSubmission) {
      throw new DraftConflictError();
    }
    if (existing.detail.hasTruncatedContent) {
      throw new DraftContentTruncatedError();
    }
    return saveStalwartDraft(this.client, this.mail, this.drafts, {
      composeId,
      content: input.content,
      context,
      existing,
      state: existing.state,
    });
  }

  public async discard(
    providerDraftId: ProviderDraftId,
    expectedRevision: string,
  ): Promise<void> {
    const context = await this.drafts.context();
    let existing = await this.drafts.load(context, providerDraftId);
    if (existing.detail.revision !== assertDraftRevision(expectedRevision)) {
      throw new DraftConflictError();
    }
    for (let attempt = 0; attempt < 2; attempt += 1) {
      if (attempt > 0) {
        let fresh: StalwartDraftRecord;
        try {
          fresh = await this.drafts.load(context, providerDraftId);
        } catch (error) {
          if (error instanceof DraftNotFoundError) {
            const composeId = existing.detail.composeId;
            if (composeId) {
              await this.drafts.findByComposeId(context, composeId);
            }
            throw new DraftConflictError();
          }
          throw error;
        }
        if (
          fresh.detail.revision !== existing.detail.revision ||
          fresh.detail.composeId !== existing.detail.composeId
        ) {
          throw new DraftConflictError();
        }
        existing = fresh;
      }
      if (existing.detail.composeId) {
        await assertStalwartDraftComposeMembers(
          this.client,
          context,
          existing.detail.composeId,
          [providerDraftId],
        );
      }
      const boundary: StalwartJmapRequestBoundary = { issued: false };
      try {
        const response = await this.client.request(
          [
            [
              "Email/set",
              {
                accountId: context.accountId,
                destroy: [providerDraftId],
                ifInState: existing.state,
              },
              "discard-draft",
            ],
          ],
          [JMAP_MAIL],
          undefined,
          boundary,
        );
        assertDraftDestroyed(
          this.client,
          response,
          context.accountId,
          existing.state,
          providerDraftId,
        );
        if (
          existing.detail.composeId &&
          (await this.drafts.findByComposeId(
            context,
            existing.detail.composeId,
          ))
        ) {
          throw new DraftConflictError();
        }
        return;
      } catch (error) {
        if (!boundary.issued) throw new DraftUnavailableError();
        if (
          error instanceof StalwartJmapMethodError &&
          error.type === "stateMismatch" &&
          attempt === 0
        ) {
          continue;
        }
        try {
          await this.drafts.load(context, providerDraftId);
        } catch (lookupError) {
          if (lookupError instanceof DraftNotFoundError) {
            if (await this.drafts.isPresent(context, providerDraftId)) {
              throw new DraftConflictError();
            }
            const composeId = existing.detail.composeId;
            if (!composeId) return;
            const replacement = await this.drafts.findByComposeId(
              context,
              composeId,
            );
            if (replacement) throw new DraftConflictError();
            return;
          }
          throw lookupError;
        }
        if (
          error instanceof StalwartJmapHttpError &&
          error.methodsWereNotExecuted
        ) {
          throw new DraftUnavailableError();
        }
        throw new DraftConflictError();
      }
    }
  }
}
