import "server-only";

import type { DraftDetail } from "@/domain/mail/draft";
import {
  DraftConflictError,
  DraftUnavailableError,
} from "@/domain/mail/draft-errors";
import type { StalwartJmapClient } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.client";
import {
  StalwartJmapHttpError,
  StalwartJmapMethodError,
  type StalwartJmapRequestBoundary,
} from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap-client-helpers";
import { adoptImportedStalwartDraft } from "@/infrastructure/providers/stalwart-jmap/stalwart-draft-adopt";
import { createJmapDraftObject } from "@/infrastructure/providers/stalwart-jmap/stalwart-draft.composer";
import { matchesStoredJmapDraftContent } from "@/infrastructure/providers/stalwart-jmap/stalwart-draft.mapper";
import { createdDraftId } from "@/infrastructure/providers/stalwart-jmap/stalwart-draft-mutation";
import { findStalwartDraftByKeyword } from "@/infrastructure/providers/stalwart-jmap/stalwart-draft-record-reader";
import {
  assertReplacementCandidate,
  replacementOperationKeyword,
} from "@/infrastructure/providers/stalwart-jmap/stalwart-draft-replacement";
import {
  assertEditableExisting,
  destroyReplacedDraft,
} from "@/infrastructure/providers/stalwart-jmap/stalwart-draft-save-destroy";
import {
  saveNewStalwartDraft,
  type StalwartDraftSaveMutation,
} from "@/infrastructure/providers/stalwart-jmap/stalwart-draft-save-new";
import type { StalwartDraftReader } from "@/infrastructure/providers/stalwart-jmap/stalwart-draft.reader";
import type { StalwartMailReader } from "@/infrastructure/providers/stalwart-jmap/stalwart-mail.reader";
import { JMAP_MAIL } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.types";

export type { StalwartDraftSaveMutation } from "@/infrastructure/providers/stalwart-jmap/stalwart-draft-save-new";

export const saveStalwartDraft = async (
  client: StalwartJmapClient,
  mail: StalwartMailReader,
  drafts: StalwartDraftReader,
  input: StalwartDraftSaveMutation,
): Promise<DraftDetail> => {
  if (!input.existing) {
    return saveNewStalwartDraft(client, mail, drafts, input);
  }
  const account = await mail.getAccount();
  let old = await drafts.load(input.context, input.existing.detail.id);
  assertEditableExisting(input.existing, old, account);
  if (old.detail.composeId === null) {
    old = await adoptImportedStalwartDraft(
      client,
      drafts,
      { ...input, existing: old },
      account,
    );
  }
  if (
    old.detail.composeId !== input.composeId ||
    input.existing.detail.revision !== old.detail.revision
  ) {
    throw new DraftConflictError();
  }
  if (
    matchesStoredJmapDraftContent(old.email, old.detail.content, input.content)
  ) {
    const sole = await drafts.findByComposeId(input.context, input.composeId);
    if (sole?.detail.id !== old.detail.id) {
      throw new DraftConflictError();
    }
    assertEditableExisting(old, sole, account);
    return sole.detail;
  }
  const anchored = {
    ...input,
    accountId: input.context.accountId,
    existing: old,
  };
  const keyword = replacementOperationKeyword(anchored, account);
  const recovered = await findStalwartDraftByKeyword(
    client,
    input.context,
    keyword,
  );
  if (recovered) {
    assertReplacementCandidate(recovered, anchored, account, keyword);
    return destroyReplacedDraft(client, drafts, anchored, account, keyword);
  }
  for (let attempt = 0; attempt < 2; attempt += 1) {
    old = await drafts.load(input.context, anchored.existing.detail.id);
    assertEditableExisting(anchored.existing, old, account);
    const sole = await drafts.findByComposeId(input.context, input.composeId);
    if (sole?.detail.id !== old.detail.id) {
      throw new DraftConflictError();
    }
    assertEditableExisting(anchored.existing, sole, account);
    old = sole;
    const boundary: StalwartJmapRequestBoundary = { issued: false };
    try {
      const createId = `draft-${input.composeId}`;
      const response = await client.request(
        [
          [
            "Email/set",
            {
              accountId: input.context.accountId,
              create: {
                [createId]: createJmapDraftObject(
                  input.content,
                  input.composeId,
                  input.context.draftsMailboxId,
                  account,
                  null,
                  old.email,
                  { additionalKeywords: { [keyword]: true } },
                ),
              },
              ifInState: old.state,
            },
            "save-draft",
          ],
        ],
        [JMAP_MAIL],
        undefined,
        boundary,
      );
      createdDraftId(
        client,
        response,
        "save-draft",
        input.context.accountId,
        old.state,
        createId,
      );
    } catch (error) {
      if (!boundary.issued) throw new DraftUnavailableError();
      const candidate = await findStalwartDraftByKeyword(
        client,
        input.context,
        keyword,
      );
      if (candidate) {
        assertReplacementCandidate(candidate, anchored, account, keyword);
        return destroyReplacedDraft(client, drafts, anchored, account, keyword);
      }
      if (
        error instanceof StalwartJmapMethodError &&
        error.type === "stateMismatch" &&
        attempt === 0
      ) {
        continue;
      }
      if (
        error instanceof StalwartJmapHttpError &&
        error.methodsWereNotExecuted
      ) {
        throw new DraftUnavailableError();
      }
      throw new DraftConflictError();
    }
    return destroyReplacedDraft(client, drafts, anchored, account, keyword);
  }
  throw new DraftConflictError();
};
