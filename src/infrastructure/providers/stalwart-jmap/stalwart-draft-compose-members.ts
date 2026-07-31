import "server-only";

import type { DraftId, ProviderDraftId } from "@/domain/shared/brand";
import { DraftConflictError } from "@/domain/mail/draft-errors";
import type { StalwartJmapClient } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.client";
import type { StalwartDraftContext } from "@/infrastructure/providers/stalwart-jmap/stalwart-draft-record-reader";
import { jmapDraftComposeKeyword } from "@/infrastructure/providers/stalwart-jmap/stalwart-draft-fingerprint";
import { jmapDraftQueryResultSchema } from "@/infrastructure/providers/stalwart-jmap/stalwart-draft.schema";
import { JMAP_MAIL } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.types";

export const assertStalwartDraftComposeMembers = async (
  client: StalwartJmapClient,
  context: StalwartDraftContext,
  composeId: DraftId | null,
  expectedIds: readonly ProviderDraftId[],
): Promise<void> => {
  if (!composeId) throw new DraftConflictError();
  const response = await client.request(
    [
      [
        "Email/query",
        {
          accountId: context.accountId,
          calculateTotal: true,
          filter: { hasKeyword: jmapDraftComposeKeyword(composeId) },
          limit: 3,
        },
        "draft-members-query",
      ],
    ],
    [JMAP_MAIL],
  );
  const result = client.result(
    response,
    "draft-members-query",
    "Email/query",
    jmapDraftQueryResultSchema,
  );
  const actual = [...result.ids].sort();
  const expected = [...expectedIds].sort();
  if (
    result.accountId !== context.accountId ||
    result.position !== 0 ||
    result.total !== expected.length ||
    actual.length !== expected.length ||
    !actual.every((value, index) => value === expected[index])
  ) {
    throw new DraftConflictError();
  }
};
