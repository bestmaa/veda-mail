import "server-only";

import { z } from "zod";

import type { StalwartJmapClient } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.client";
import {
  jmapIdBooleanRecordSchema,
  jmapKeywordBooleanRecordSchema,
} from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap-record.schema";
import { JMAP_MAIL } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.types";

export interface StalwartSendCleanupContext {
  readonly draftMailboxId: string;
  readonly removeKeywords?: readonly string[];
  readonly sentMailboxId: string;
}

const submittedEmailSchema = z
  .object({
    id: z.string().min(1),
    keywords: jmapKeywordBooleanRecordSchema,
    mailboxIds: jmapIdBooleanRecordSchema,
  })
  .passthrough();

const submittedEmailResultSchema = z
  .object({
    accountId: z.string().min(1),
    list: z.array(submittedEmailSchema).max(1),
    notFound: z.array(z.string()).max(1).nullish().transform((value) => value ?? []),
    state: z.string().min(1),
  })
  .passthrough();

type SubmittedEmailRead =
  | { readonly email: z.infer<typeof submittedEmailSchema>; readonly kind: "found"; readonly state: string }
  | { readonly kind: "invalid" }
  | { readonly kind: "missing" };

const patchSegment = (value: string): string =>
  value.replaceAll("~", "~0").replaceAll("/", "~1");

const loadSubmittedEmail = async (
  client: StalwartJmapClient,
  accountId: string,
  emailId: string,
): Promise<SubmittedEmailRead> => {
  const response = await client.request(
    [
      [
        "Email/get",
        {
          accountId,
          ids: [emailId],
          properties: ["id", "keywords", "mailboxIds"],
        },
        "verify-submitted-email",
      ],
    ],
    [JMAP_MAIL],
  );
  const result = client.result(
    response,
    "verify-submitted-email",
    "Email/get",
    submittedEmailResultSchema,
  );
  const email = result.list[0];
  if (result.accountId !== accountId) return { kind: "invalid" };
  if (
    result.list.length === 0 &&
    result.notFound.length === 1 &&
    result.notFound[0] === emailId
  ) return { kind: "missing" };
  return result.notFound.length === 0 && email?.id === emailId
    ? { email, kind: "found", state: result.state }
    : { kind: "invalid" };
};

const hasSentMembership = (
  email: z.infer<typeof submittedEmailSchema>,
  context: StalwartSendCleanupContext,
): boolean => email.mailboxIds[context.sentMailboxId] === true;

const hasCleanSentState = (
  email: z.infer<typeof submittedEmailSchema>,
  context: StalwartSendCleanupContext,
): boolean =>
  hasSentMembership(email, context) &&
  email.mailboxIds[context.draftMailboxId] !== true &&
  email.keywords["$draft"] !== true &&
  (context.removeKeywords ?? []).every(
    (keyword) => email.keywords[keyword] !== true,
  );

const sentStateDiscoveryDelaysMs = [0, 50, 100, 200, 400] as const;
const sentStateRepairDelaysMs = [50, 100] as const;

const waitForSentState = (delayMs: number): Promise<void> =>
  delayMs === 0
    ? Promise.resolve()
    : new Promise((resolve) => setTimeout(resolve, delayMs));

const requestCleanup = async (
  client: StalwartJmapClient,
  accountId: string,
  emailId: string,
  state: string,
  context: StalwartSendCleanupContext,
): Promise<void> => {
  await client.request(
    [
      [
        "Email/set",
        {
          accountId,
          ifInState: state,
          update: {
            [emailId]: {
              "keywords/$draft": null,
              "keywords/$seen": true,
              ...Object.fromEntries(
                (context.removeKeywords ?? []).map((keyword) => [
                  `keywords/${patchSegment(keyword)}`,
                  null,
                ]),
              ),
              [`mailboxIds/${patchSegment(context.draftMailboxId)}`]: null,
              [`mailboxIds/${patchSegment(context.sentMailboxId)}`]: true,
            },
          },
        },
        "cleanup-submitted-email",
      ],
    ],
    [JMAP_MAIL],
  );
};

const repairVerifiedSentState = async (
  client: StalwartJmapClient,
  accountId: string,
  emailId: string,
  context: StalwartSendCleanupContext,
  initialState: string,
): Promise<boolean> => {
  let state = initialState;
  for (const delayMs of sentStateRepairDelaysMs) {
    try {
      await requestCleanup(client, accountId, emailId, state, context);
    } catch {
      // The update may have crossed the transport boundary. Only an exact
      // provider re-read can prove whether cleanup completed.
    }
    await waitForSentState(delayMs);
    let current: SubmittedEmailRead;
    try {
      current = await loadSubmittedEmail(client, accountId, emailId);
    } catch {
      return false;
    }
    if (current.kind !== "found" || !hasSentMembership(current.email, context)) {
      return false;
    }
    if (hasCleanSentState(current.email, context)) return true;
    state = current.state;
  }
  return false;
};

export const verifyAndRepairStalwartSentState = async (
  client: StalwartJmapClient,
  accountId: string,
  emailId: string,
  context: StalwartSendCleanupContext,
): Promise<boolean> => {
  for (const delayMs of sentStateDiscoveryDelaysMs) {
    await waitForSentState(delayMs);
    let current: SubmittedEmailRead;
    try {
      current = await loadSubmittedEmail(client, accountId, emailId);
    } catch {
      return false;
    }
    if (current.kind === "invalid") return false;
    if (current.kind === "missing") continue;
    if (!hasSentMembership(current.email, context)) continue;
    if (hasCleanSentState(current.email, context)) return true;
    return repairVerifiedSentState(
      client, accountId, emailId, context, current.state,
    );
  }
  return false;
};
