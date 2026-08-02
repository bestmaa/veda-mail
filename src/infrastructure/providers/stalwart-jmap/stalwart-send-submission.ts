import "server-only";

import type { z } from "zod";

import type { SendReceipt } from "@/domain/mail/mail";
import { id } from "@/domain/shared/brand";
import type { StalwartJmapClient } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.client";
import {
  StalwartJmapHttpError,
  StalwartJmapMethodError,
  type StalwartJmapRequestBoundary,
} from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap-client-helpers";
import { jmapSetResultSchema } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.schema";
import {
  JMAP_MAIL,
  JMAP_SUBMISSION,
  type JmapMethodCall,
} from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.types";
import { cleanupRejectedStalwartSubmission } from "@/infrastructure/providers/stalwart-jmap/stalwart-submission-cleanup";
import { hasAdvancedJmapSetState } from "@/infrastructure/providers/stalwart-jmap/stalwart-set-state";
import { type StalwartSendCleanupContext, verifyAndRepairStalwartSentState } from "@/infrastructure/providers/stalwart-jmap/stalwart-send-cleanup";

const uncertainReceipt = (): SendReceipt => ({
  deliveryStatus: "uncertain",
  id: id.message(`uncertain-${crypto.randomUUID()}`),
  rejectedRecipients: [],
  submittedAt: new Date().toISOString(),
});

type JmapSetResult = z.infer<typeof jmapSetResultSchema>;

type SetOutcome =
  | { readonly id: string; readonly kind: "created" }
  | { readonly kind: "not-created" }
  | { readonly kind: "uncertain" };

const hasOwn = (value: object, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(value, key);
const exactKeys = (
  value: Readonly<Record<string, unknown>> | null | undefined,
  expected: readonly string[],
): boolean => {
  const actual = Object.keys(value ?? {}).sort();
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  );
};
const hasNoSetFailures = (result: JmapSetResult): boolean =>
  [result.notCreated, result.notDestroyed, result.notUpdated].every(
    (value) => Object.keys(value ?? {}).length === 0,
  );

export const isValidSetError = (value: unknown): boolean =>
  typeof value === "object" &&
  value !== null &&
  "type" in value &&
  typeof value.type === "string" &&
  value.type.length > 0 &&
  value.type.length <= 128 &&
  value.type.trim() === value.type;

const setOutcome = (result: JmapSetResult, key: string): SetOutcome => {
  const created = result.created?.[key];
  const hasNotCreated =
    result.notCreated != null && hasOwn(result.notCreated, key);
  const validNotCreated =
    hasNotCreated && isValidSetError(result.notCreated?.[key]);
  if ((created && hasNotCreated) || (hasNotCreated && !validNotCreated)) {
    return { kind: "uncertain" };
  }
  if (validNotCreated) return { kind: "not-created" };
  return created ? { id: created.id, kind: "created" } : { kind: "uncertain" };
};

const readSetOutcome = (
  client: StalwartJmapClient,
  response: Awaited<ReturnType<StalwartJmapClient["request"]>>,
  callId: string,
  expectedMethod: string,
  key: string,
  allowedImplicitMethods: readonly string[] = [],
): SetOutcome => {
  try {
    const raw = client.result(
      response,
      callId,
      expectedMethod,
      jmapSetResultSchema,
      allowedImplicitMethods,
    );
    const parsed = jmapSetResultSchema.safeParse(raw);
    return parsed.success
      ? setOutcome(parsed.data, key)
      : { kind: "uncertain" };
  } catch (error) {
    if (
      error instanceof StalwartJmapMethodError &&
      error.kind === "definitive"
    ) {
      return { kind: "not-created" };
    }
    return { kind: "uncertain" };
  }
};

const submissionEvidence = (
  client: StalwartJmapClient,
  response: Awaited<ReturnType<StalwartJmapClient["request"]>>,
  createId: string,
  emailId: string,
  expectedAccountId: string,
): "accepted" | "cleanup-eligible" | "uncertain" => {
  try {
    const create = client.result(
      response,
      "create",
      "Email/set",
      jmapSetResultSchema,
    );
    const submission = client.result(
      response,
      "submit",
      "EmailSubmission/set",
      jmapSetResultSchema,
      ["Email/set"],
    );
    const implicit = response.methodResponses.filter(
      ([method, , callId]) => method === "Email/set" && callId === "submit",
    );
    const update = jmapSetResultSchema.safeParse(implicit[0]?.[1]);
    const accountId = expectedAccountId;
    const sameAccount =
      create.accountId === accountId && submission.accountId === accountId;
    const trustedPrimary =
      sameAccount &&
      hasAdvancedJmapSetState(create) &&
      exactKeys(create.created, [createId]) &&
      create.created?.[createId]?.id === emailId &&
      hasNoSetFailures(create) &&
      (create.destroyed?.length ?? 0) === 0 &&
      Object.keys(create.updated ?? {}).length === 0 &&
      hasAdvancedJmapSetState(submission) &&
      exactKeys(submission.created, ["submit"]) &&
      hasNoSetFailures(submission) &&
      (submission.destroyed?.length ?? 0) === 0 &&
      Object.keys(submission.updated ?? {}).length === 0;
    if (!trustedPrimary) return "uncertain";
    const trustedImplicit =
      implicit.length === 1 &&
      update.success &&
      update.data.accountId === accountId &&
      hasAdvancedJmapSetState(update.data, create.newState) &&
      exactKeys(update.data.updated, [emailId]) &&
      hasOwn(update.data.updated ?? {}, emailId) &&
      hasNoSetFailures(update.data) &&
      Object.keys(update.data.created ?? {}).length === 0 &&
      (update.data.destroyed?.length ?? 0) === 0;
    return trustedImplicit ? "accepted" : "cleanup-eligible";
  } catch {
    return "uncertain";
  }
};

export const submitStalwartMessage = async (
  client: StalwartJmapClient,
  calls: readonly JmapMethodCall[],
  createId: string,
  expectedAccountId: string,
  cleanupContext?: StalwartSendCleanupContext,
): Promise<SendReceipt> => {
  const boundary: StalwartJmapRequestBoundary = { issued: false };
  let response: Awaited<ReturnType<StalwartJmapClient["request"]>>;
  try {
    response = await client.request(
      calls,
      [JMAP_MAIL, JMAP_SUBMISSION],
      undefined,
      boundary,
    );
  } catch (error) {
    if (
      !boundary.issued ||
      (error instanceof StalwartJmapHttpError && error.methodsWereNotExecuted)
    ) {
      throw error;
    }
    return uncertainReceipt();
  }

  const submission = readSetOutcome(
    client,
    response,
    "submit",
    "EmailSubmission/set",
    "submit",
    ["Email/set"],
  );
  const create = readSetOutcome(
    client,
    response,
    "create",
    "Email/set",
    createId,
  );
  if (submission.kind === "not-created") {
    const hasImplicit = response.methodResponses.some(
      ([method, , callId]) => method === "Email/set" && callId === "submit",
    );
    if (hasImplicit) return uncertainReceipt();
    if (create.kind === "created") {
      await cleanupRejectedStalwartSubmission(
        client,
        response,
        createId,
        create.id,
        expectedAccountId,
      );
    }
    throw new Error("Stalwart did not create the outgoing message.");
  }
  if (submission.kind === "uncertain") return uncertainReceipt();
  if (create.kind !== "created") return uncertainReceipt();
  const evidence = submissionEvidence(
    client, response, createId, create.id, expectedAccountId,
  );
  if (evidence !== "accepted") {
    if (
      evidence !== "cleanup-eligible" ||
      !cleanupContext ||
      !(await verifyAndRepairStalwartSentState(
        client,
        expectedAccountId,
        create.id,
        cleanupContext,
      ))
    ) {
      return uncertainReceipt();
    }
  }

  return {
    deliveryStatus: "accepted",
    id: id.message(create.id),
    rejectedRecipients: [],
    submittedAt: new Date().toISOString(),
  };
};
