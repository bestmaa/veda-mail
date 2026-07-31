import "server-only";

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
import {
  isVedaDraftKeyword,
  jmapDraftComposeKeyword,
  jmapDraftContentKeyword,
} from "@/infrastructure/providers/stalwart-jmap/stalwart-draft-fingerprint";
import { sameDraftContent } from "@/infrastructure/providers/stalwart-jmap/stalwart-draft.mapper";
import type { StalwartDraftRecord } from "@/infrastructure/providers/stalwart-jmap/stalwart-draft-record-reader";
import { assertEditableExisting } from "@/infrastructure/providers/stalwart-jmap/stalwart-draft-save-destroy";
import type { StalwartDraftSaveMutation } from "@/infrastructure/providers/stalwart-jmap/stalwart-draft-save-new";
import type { StalwartDraftReader } from "@/infrastructure/providers/stalwart-jmap/stalwart-draft.reader";
import type { StalwartMailReader } from "@/infrastructure/providers/stalwart-jmap/stalwart-mail.reader";
import { jmapKeywordBooleanRecordSchema } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap-record.schema";
import { jmapSetResultSchema } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.schema";
import { JMAP_MAIL } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.types";
import { hasAdvancedJmapSetState } from "@/infrastructure/providers/stalwart-jmap/stalwart-set-state";

type Account = Awaited<ReturnType<StalwartMailReader["getAccount"]>>;
type ImportedMutation = StalwartDraftSaveMutation & {
  readonly existing: StalwartDraftRecord;
};

const exact = (actual: readonly string[], expected: readonly string[]) =>
  actual.length === expected.length &&
  actual.every((value, index) => value === expected[index]);

const hasNoVedaMarkers = (record: StalwartDraftRecord): boolean =>
  !Object.entries(record.email.keywords).some(
    ([keyword, enabled]) => enabled && isVedaDraftKeyword(keyword),
  );

const assertAdopted = (
  input: ImportedMutation,
  before: StalwartDraftRecord,
  fresh: StalwartDraftRecord,
  account: Account,
): void => {
  const composeKeyword = jmapDraftComposeKeyword(input.composeId);
  const contentKeyword = jmapDraftContentKeyword(before.detail.content);
  const vedaKeywords = Object.entries(fresh.email.keywords)
    .filter(([keyword, enabled]) => enabled && isVedaDraftKeyword(keyword))
    .map(([keyword]) => keyword)
    .sort();
  const expected = {
    ...before,
    detail: { ...before.detail, composeId: input.composeId },
    email: {
      ...before.email,
      keywords: {
        ...before.email.keywords,
        [composeKeyword]: true,
        [contentKeyword]: true,
      },
    },
  };
  if (
    !exact(vedaKeywords, [composeKeyword, contentKeyword].sort()) ||
    !sameDraftContent(fresh.detail.content, before.detail.content)
  ) {
    throw new DraftConflictError();
  }
  assertEditableExisting(expected, fresh, account);
};

const verifyAdopted = async (
  drafts: StalwartDraftReader,
  input: ImportedMutation,
  before: StalwartDraftRecord,
  fresh: StalwartDraftRecord,
  account: Account,
): Promise<StalwartDraftRecord> => {
  assertAdopted(input, before, fresh, account);
  const sole = await drafts.findByComposeId(input.context, input.composeId);
  if (sole?.detail.id !== fresh.detail.id) {
    throw new DraftConflictError();
  }
  assertAdopted(input, before, sole, account);
  return sole;
};

const reconcileAdoption = async (
  drafts: StalwartDraftReader,
  input: ImportedMutation,
  before: StalwartDraftRecord,
  account: Account,
): Promise<StalwartDraftRecord | null> => {
  const fresh = await drafts.load(input.context, before.detail.id);
  if (fresh.detail.composeId === input.composeId) {
    return verifyAdopted(drafts, input, before, fresh, account);
  }
  if (fresh.detail.composeId !== null || !hasNoVedaMarkers(fresh)) {
    throw new DraftConflictError();
  }
  assertEditableExisting(before, fresh, account);
  return null;
};

export const adoptImportedStalwartDraft = async (
  client: StalwartJmapClient,
  drafts: StalwartDraftReader,
  input: ImportedMutation,
  account: Account,
): Promise<StalwartDraftRecord> => {
  let before = input.existing;
  if (!hasNoVedaMarkers(before)) throw new DraftConflictError();
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const composeKeyword = jmapDraftComposeKeyword(input.composeId);
    const contentKeyword = jmapDraftContentKeyword(before.detail.content);
    if (
      !jmapKeywordBooleanRecordSchema.safeParse({
        ...before.email.keywords,
        [composeKeyword]: true,
        [contentKeyword]: true,
      }).success
    ) {
      throw new DraftConflictError();
    }
    if (await drafts.findByComposeId(input.context, input.composeId)) {
      throw new DraftConflictError();
    }
    const boundary: StalwartJmapRequestBoundary = { issued: false };
    try {
      const response = await client.request(
        [
          [
            "Email/set",
            {
              accountId: input.context.accountId,
              ifInState: before.state,
              update: {
                [before.detail.id]: {
                  [`keywords/${composeKeyword}`]: true,
                  [`keywords/${contentKeyword}`]: true,
                },
              },
            },
            "adopt-draft",
          ],
        ],
        [JMAP_MAIL],
        undefined,
        boundary,
      );
      const result = client.result(
        response,
        "adopt-draft",
        "Email/set",
        jmapSetResultSchema,
      );
      if (
        result.accountId !== input.context.accountId ||
        !hasAdvancedJmapSetState(result, before.state) ||
        !exact(Object.keys(result.updated ?? {}), [before.detail.id]) ||
        Object.keys(result.created ?? {}).length !== 0 ||
        (result.destroyed?.length ?? 0) !== 0 ||
        Object.keys(result.notCreated ?? {}).length !== 0 ||
        Object.keys(result.notUpdated ?? {}).length !== 0 ||
        Object.keys(result.notDestroyed ?? {}).length !== 0
      ) {
        throw new DraftConflictError();
      }
      return verifyAdopted(
        drafts,
        input,
        before,
        await drafts.load(input.context, before.detail.id),
        account,
      );
    } catch (error) {
      if (!boundary.issued) throw new DraftUnavailableError();
      const recovered = await reconcileAdoption(drafts, input, before, account);
      if (recovered) return recovered;
      if (
        error instanceof StalwartJmapMethodError &&
        error.type === "stateMismatch" &&
        attempt === 0
      ) {
        before = await drafts.load(input.context, before.detail.id);
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
  }
  throw new DraftConflictError();
};
