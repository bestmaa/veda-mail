import "server-only";

import { DraftConflictError } from "@/domain/mail/draft-errors";
import type { ProviderDraftId } from "@/domain/shared/brand";
import type { StalwartJmapClient } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.client";
import {
  jmapDraftSetResultSchema,
  type JmapDraftSetResult,
} from "@/infrastructure/providers/stalwart-jmap/stalwart-draft.schema";
import type { JmapResponse } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.types";
import { hasAdvancedJmapSetState } from "@/infrastructure/providers/stalwart-jmap/stalwart-set-state";

const keys = (
  value?: Readonly<Record<string, unknown>> | null,
): readonly string[] => (value ? Object.keys(value) : []);

const exact = (actual: readonly string[], expected: readonly string[]) =>
  actual.length === expected.length &&
  actual.every((value, index) => value === expected[index]);

const baseResult = (
  client: StalwartJmapClient,
  response: JmapResponse,
  callId: string,
  accountId: string,
  expectedState: string,
): JmapDraftSetResult => {
  const result = client.result(
    response,
    callId,
    "Email/set",
    jmapDraftSetResultSchema,
  );
  if (
    result.accountId !== accountId ||
    !hasAdvancedJmapSetState(result, expectedState) ||
    keys(result.notCreated).length > 0 ||
    keys(result.notDestroyed).length > 0 ||
    keys(result.notUpdated).length > 0
  ) {
    throw new DraftConflictError();
  }
  return result;
};

export const createdDraftId = (
  client: StalwartJmapClient,
  response: JmapResponse,
  callId: string,
  accountId: string,
  expectedState: string,
  createId: string,
  destroyedId?: ProviderDraftId,
): ProviderDraftId => {
  const result = baseResult(client, response, callId, accountId, expectedState);
  const createdKeys = keys(result.created);
  const destroyed = [...(result.destroyed ?? [])].sort();
  const expectedDestroyed = destroyedId ? [destroyedId] : [];
  if (
    !exact(createdKeys, [createId]) ||
    !exact(destroyed, expectedDestroyed) ||
    keys(result.updated).length > 0 ||
    !result.created?.[createId]?.id
  ) {
    throw new DraftConflictError();
  }
  return result.created?.[createId]?.id as ProviderDraftId;
};

export const assertDraftDestroyed = (
  client: StalwartJmapClient,
  response: JmapResponse,
  accountId: string,
  expectedState: string,
  providerDraftId: ProviderDraftId,
): void => {
  const result = baseResult(
    client,
    response,
    "discard-draft",
    accountId,
    expectedState,
  );
  if (
    keys(result.created).length > 0 ||
    keys(result.updated).length > 0 ||
    !exact(result.destroyed ?? [], [providerDraftId])
  ) {
    throw new DraftConflictError();
  }
};
