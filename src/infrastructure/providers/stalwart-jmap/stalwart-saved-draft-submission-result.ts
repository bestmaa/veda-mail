import "server-only";

import type { z } from "zod";

import type { StalwartJmapClient } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.client";
import { StalwartJmapMethodError } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap-client-helpers";
import { jmapSetResultSchema } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.schema";
import { isValidSetError } from "@/infrastructure/providers/stalwart-jmap/stalwart-send-submission";
import {
  hasAdvancedJmapSetState,
  hasCreatedSubmissionState,
  hasUnchangedJmapSetState,
} from "@/infrastructure/providers/stalwart-jmap/stalwart-set-state";

type SetResult = z.infer<typeof jmapSetResultSchema>;
export const hasSavedDraftSubmissionEvidence = (
  response: Awaited<ReturnType<StalwartJmapClient["request"]>>,
): boolean =>
  response.methodResponses.some(
    ([method, , callId]) =>
      callId === "submit-saved-draft" &&
      (method === "EmailSubmission/set" || method === "Email/set"),
  );
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
const noFailures = (result: Readonly<Record<string, unknown>>): boolean =>
  ["notCreated", "notDestroyed", "notUpdated"].every((property) => {
    const value = result[property];
    return (
      value == null ||
      (typeof value === "object" &&
        value !== null &&
        Object.keys(value).length === 0)
    );
  });

export const savedDraftSubmissionOutcome = (
  client: StalwartJmapClient,
  response: Awaited<ReturnType<StalwartJmapClient["request"]>>,
  accountId: string,
  emailId: string,
  expectedEmailState: string,
): "accepted" | "cleanup-eligible" | "retryable" | "uncertain" => {
  let submission: SetResult;
  try {
    submission = client.result(
      response,
      "submit-saved-draft",
      "EmailSubmission/set",
      jmapSetResultSchema,
      ["Email/set"],
    );
  } catch (error) {
    const hasImplicit = response.methodResponses.some(
      ([method, , callId]) =>
        method === "Email/set" && callId === "submit-saved-draft",
    );
    return error instanceof StalwartJmapMethodError &&
      error.kind === "definitive" &&
      !hasImplicit
      ? "retryable"
      : "uncertain";
  }
  try {
    const notCreated = submission.notCreated ?? {};
    const implicit = response.methodResponses.filter(
      ([method, , callId]) =>
        method === "Email/set" && callId === "submit-saved-draft",
    );
    const retryable =
      Object.keys(submission.created ?? {}).length === 0 &&
      exactKeys(notCreated, ["submit"]) &&
      isValidSetError(notCreated["submit"]) &&
      submission.accountId === accountId &&
      hasUnchangedJmapSetState(submission) &&
      Object.keys(submission.updated ?? {}).length === 0 &&
      (submission.destroyed?.length ?? 0) === 0 &&
      Object.keys(submission.notUpdated ?? {}).length === 0 &&
      Object.keys(submission.notDestroyed ?? {}).length === 0 &&
      implicit.length === 0;
    if (retryable) return "retryable";
    const strictSubmission =
      submission.accountId === accountId &&
      hasCreatedSubmissionState(submission) &&
      exactKeys(submission.created, ["submit"]) &&
      Boolean(submission.created?.["submit"]?.id) &&
      noFailures(submission) &&
      (submission.destroyed?.length ?? 0) === 0 &&
      Object.keys(submission.updated ?? {}).length === 0;
    if (!strictSubmission) return "uncertain";
    const emailSet = jmapSetResultSchema.safeParse(implicit[0]?.[1]);
    const implicitBase =
      implicit.length === 1 &&
      emailSet.success &&
      emailSet.data.accountId === accountId &&
      hasAdvancedJmapSetState(emailSet.data, expectedEmailState) &&
      noFailures(emailSet.data) &&
      Object.keys(emailSet.data.created ?? {}).length === 0;
    const updated =
      implicitBase &&
      exactKeys(emailSet.data.updated, [emailId]) &&
      hasOwn(emailSet.data.updated ?? {}, emailId) &&
      (emailSet.data.destroyed?.length ?? 0) === 0;
    const destroyed =
      implicitBase &&
      Object.keys(emailSet.data.updated ?? {}).length === 0 &&
      emailSet.data.destroyed?.length === 1 &&
      emailSet.data.destroyed[0] === emailId;
    if (updated || destroyed) return "accepted";

    // A successful EmailSubmission/set is authoritative submission evidence.
    // Some Stalwart releases omit or vary the implicit Email/set response for
    // onSuccessUpdateEmail. Verify the exact copy independently instead of
    // leaving a delivered message uncertain solely because that optional
    // response shape differs.
    return "cleanup-eligible";
  } catch {
    return "uncertain";
  }
};
