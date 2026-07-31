import "server-only";

import type { z } from "zod";

import type { StalwartJmapClient } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.client";
import type { StalwartJmapRequestBoundary } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap-client-helpers";
import { jmapSetResultSchema } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.schema";
import {
  JMAP_MAIL,
  type JmapResponse,
} from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.types";
import { hasAdvancedJmapSetState } from "@/infrastructure/providers/stalwart-jmap/stalwart-set-state";

const exact = (actual: readonly string[], expected: readonly string[]) =>
  actual.length === expected.length &&
  actual.every((value, index) => value === expected[index]);
type JmapSetResult = z.infer<typeof jmapSetResultSchema>;
const hasNoFailures = (result: JmapSetResult): boolean =>
  [result.notCreated, result.notDestroyed, result.notUpdated].every(
    (value) => Object.keys(value ?? {}).length === 0,
  );

export const cleanupRejectedStalwartSubmission = async (
  client: StalwartJmapClient,
  response: JmapResponse,
  createId: string,
  emailId: string,
  expectedAccountId: string,
): Promise<boolean> => {
  let create: JmapSetResult;
  try {
    create = client.result(
      response,
      "create",
      "Email/set",
      jmapSetResultSchema,
    );
  } catch {
    return false;
  }
  if (
    create.accountId !== expectedAccountId ||
    !hasAdvancedJmapSetState(create) ||
    !exact(Object.keys(create.created ?? {}), [createId]) ||
    create.created?.[createId]?.id !== emailId ||
    !hasNoFailures(create) ||
    Object.keys(create.updated ?? {}).length > 0 ||
    (create.destroyed?.length ?? 0) > 0
  ) {
    return false;
  }
  const boundary: StalwartJmapRequestBoundary = { issued: false };
  try {
    const cleanup = await client.request(
      [
        [
          "Email/set",
          {
            accountId: expectedAccountId,
            destroy: [emailId],
            ifInState: create.newState,
          },
          "cleanup-rejected-submission",
        ],
      ],
      [JMAP_MAIL],
      undefined,
      boundary,
    );
    const result = client.result(
      cleanup,
      "cleanup-rejected-submission",
      "Email/set",
      jmapSetResultSchema,
    );
    return (
      result.accountId === expectedAccountId &&
      hasAdvancedJmapSetState(result, create.newState) &&
      exact(result.destroyed ?? [], [emailId]) &&
      hasNoFailures(result) &&
      Object.keys(result.created ?? {}).length === 0 &&
      Object.keys(result.updated ?? {}).length === 0
    );
  } catch {
    return false;
  }
};
