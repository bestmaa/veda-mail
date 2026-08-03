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
    notFound: z.array(z.string()).max(1),
    state: z.string().min(1),
  })
  .passthrough();

const patchSegment = (value: string): string =>
  value.replaceAll("~", "~0").replaceAll("/", "~1");

const loadSubmittedEmail = async (
  client: StalwartJmapClient,
  accountId: string,
  emailId: string,
) => {
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
  return result.accountId === accountId &&
    result.notFound.length === 0 &&
    email?.id === emailId
    ? { email, state: result.state }
    : null;
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

export const verifyAndRepairStalwartSentState = async (
  client: StalwartJmapClient,
  accountId: string,
  emailId: string,
  context: StalwartSendCleanupContext,
): Promise<boolean> => {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    let current: Awaited<ReturnType<typeof loadSubmittedEmail>>;
    try {
      current = await loadSubmittedEmail(client, accountId, emailId);
    } catch {
      return false;
    }
    if (!current || !hasSentMembership(current.email, context)) return false;
    if (hasCleanSentState(current.email, context)) return true;
    if (attempt === 2) return false;
    try {
      await requestCleanup(
        client,
        accountId,
        emailId,
        current.state,
        context,
      );
    } catch {
      // The update may have crossed the transport boundary. Re-read the
      // provider state before deciding whether another idempotent repair is safe.
    }
  }
  return false;
};
