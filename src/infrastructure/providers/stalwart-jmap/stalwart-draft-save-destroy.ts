import "server-only";

import type { DraftDetail } from "@/domain/mail/draft";
import { hasCanonicalDraftContent } from "@/domain/mail/draft-content-round-trip";
import {
  DraftConflictError,
  DraftContentTruncatedError,
  DraftNotFoundError,
  DraftUnavailableError,
} from "@/domain/mail/draft-errors";
import type { StalwartJmapClient } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.client";
import {
  StalwartJmapHttpError,
  StalwartJmapMethodError,
  type StalwartJmapRequestBoundary,
} from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap-client-helpers";
import {
  hasLosslessDraftHeaders,
  hasSupportedDraftHeaderInventory,
} from "@/infrastructure/providers/stalwart-jmap/stalwart-draft-header-safety";
import { sameDraftContent } from "@/infrastructure/providers/stalwart-jmap/stalwart-draft.mapper";
import { hasSupportedDraftBodyStructure } from "@/infrastructure/providers/stalwart-jmap/stalwart-draft-mime-safety";
import { assertDraftDestroyed } from "@/infrastructure/providers/stalwart-jmap/stalwart-draft-mutation";
import { assertStalwartDraftComposeMembers } from "@/infrastructure/providers/stalwart-jmap/stalwart-draft-compose-members";
import {
  findStalwartDraftByKeyword,
  type StalwartDraftRecord,
} from "@/infrastructure/providers/stalwart-jmap/stalwart-draft-record-reader";
import {
  assertReplacementCandidate,
  assertUnchangedDraftMetadata,
} from "@/infrastructure/providers/stalwart-jmap/stalwart-draft-replacement";
import type { StalwartDraftSaveMutation } from "@/infrastructure/providers/stalwart-jmap/stalwart-draft-save-new";
import type { StalwartDraftReader } from "@/infrastructure/providers/stalwart-jmap/stalwart-draft.reader";
import type { StalwartMailReader } from "@/infrastructure/providers/stalwart-jmap/stalwart-mail.reader";
import { JMAP_MAIL } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.types";

type Account = Awaited<ReturnType<StalwartMailReader["getAccount"]>>;
type AnchoredMutation = StalwartDraftSaveMutation & {
  readonly existing: StalwartDraftRecord;
};

export const assertEditableExisting = (
  expected: StalwartDraftRecord,
  fresh: StalwartDraftRecord,
  account: Account,
): void => {
  const from = fresh.email.from ?? [];
  if (
    fresh.detail.revision !== expected.detail.revision ||
    fresh.detail.composeId !== expected.detail.composeId ||
    !sameDraftContent(fresh.detail.content, expected.detail.content) ||
    fresh.detail.hasUncertainSubmission ||
    !hasCanonicalDraftContent(fresh.detail.content) ||
    from.length !== 1 ||
    from[0]?.email.toLowerCase() !== account.email.toLowerCase() ||
    !hasLosslessDraftHeaders(fresh.email) ||
    !hasSupportedDraftHeaderInventory(fresh.email) ||
    !hasSupportedDraftBodyStructure(fresh.email) ||
    (fresh.email.replyTo?.length ?? 0) > 0 ||
    (fresh.email.sender?.length ?? 0) > 0
  ) {
    throw new DraftConflictError();
  }
  if (fresh.detail.hasTruncatedContent) {
    throw new DraftContentTruncatedError();
  }
  assertUnchangedDraftMetadata(expected, fresh);
};

const soleReplacement = async (
  drafts: StalwartDraftReader,
  input: AnchoredMutation,
  candidate: StalwartDraftRecord,
  account: Account,
  keyword: string,
): Promise<DraftDetail> => {
  const sole = await drafts.findByComposeId(input.context, input.composeId);
  if (sole?.detail.id !== candidate.detail.id) {
    throw new DraftConflictError();
  }
  assertReplacementCandidate(
    sole,
    { ...input, accountId: input.context.accountId },
    account,
    keyword,
  );
  return sole.detail;
};

export const destroyReplacedDraft = async (
  client: StalwartJmapClient,
  drafts: StalwartDraftReader,
  input: AnchoredMutation,
  account: Account,
  keyword: string,
): Promise<DraftDetail> => {
  const anchor = { ...input, accountId: input.context.accountId };
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const candidate = await findStalwartDraftByKeyword(
      client,
      input.context,
      keyword,
    );
    if (!candidate) throw new DraftConflictError();
    assertReplacementCandidate(candidate, anchor, account, keyword);
    let old: StalwartDraftRecord;
    try {
      old = await drafts.load(input.context, input.existing.detail.id);
    } catch (error) {
      if (!(error instanceof DraftNotFoundError)) throw error;
      if (await drafts.isPresent(input.context, input.existing.detail.id)) {
        throw new DraftConflictError();
      }
      return soleReplacement(drafts, input, candidate, account, keyword);
    }
    if (candidate.state !== old.state) {
      if (attempt === 0) continue;
      throw new DraftConflictError();
    }
    assertEditableExisting(input.existing, old, account);
    await assertStalwartDraftComposeMembers(
      client,
      input.context,
      input.composeId,
      [old.detail.id, candidate.detail.id],
    );
    const boundary: StalwartJmapRequestBoundary = { issued: false };
    try {
      const response = await client.request(
        [
          [
            "Email/set",
            {
              accountId: input.context.accountId,
              destroy: [input.existing.detail.id],
              ifInState: old.state,
            },
            "discard-draft",
          ],
        ],
        [JMAP_MAIL],
        undefined,
        boundary,
      );
      assertDraftDestroyed(
        client,
        response,
        input.context.accountId,
        old.state,
        input.existing.detail.id,
      );
      return soleReplacement(drafts, input, candidate, account, keyword);
    } catch (error) {
      if (!boundary.issued) throw new DraftUnavailableError();
      if (
        error instanceof StalwartJmapMethodError &&
        error.type === "stateMismatch" &&
        attempt === 0
      ) {
        continue;
      }
      if (!(await drafts.isPresent(input.context, input.existing.detail.id))) {
        return soleReplacement(drafts, input, candidate, account, keyword);
      }
      if (
        error instanceof StalwartJmapHttpError &&
        error.methodsWereNotExecuted &&
        attempt === 0
      ) {
        continue;
      }
      throw new DraftConflictError();
    }
  }
  throw new DraftConflictError();
};
