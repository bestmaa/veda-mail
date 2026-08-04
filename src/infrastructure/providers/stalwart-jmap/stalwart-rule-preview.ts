import "server-only";

import { z } from "zod";

import {
  MAX_MAIL_RULE_PREVIEW_HEADERS,
  MAX_MAIL_RULE_PREVIEW_MESSAGES,
  type MailRule,
  type RulePreviewInput,
  type RulePreviewResult,
} from "@/domain/mail/rule";
import { id } from "@/domain/shared/brand";
import { evaluateMailRules } from "@/server/rules/rule-evaluator";
import type { StalwartJmapClient } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.client";
import {
  jmapListResultSchema,
  jmapQueryResultSchema,
} from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.schema";
import { JMAP_MAIL } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.types";

const MAX_ADDRESS_COUNT = 100;
const MAX_ADDRESS_BYTES = 998;
const addressSchema = z.object({
  email: z.string().min(1).max(MAX_ADDRESS_BYTES),
}).passthrough();
const previewEmailSchema = z.object({
  cc: z.array(addressSchema).max(MAX_ADDRESS_COUNT).nullish(),
  from: z.array(addressSchema).max(MAX_ADDRESS_COUNT).nullish(),
  hasAttachment: z.boolean(),
  id: z.string().min(1).max(1_024),
  receivedAt: z.string().datetime(),
  size: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  subject: z.string().max(998).nullable(),
  to: z.array(addressSchema).max(MAX_ADDRESS_COUNT).nullish(),
}).passthrough();

const customHeaders = (rules: readonly MailRule[]): readonly string[] =>
  [...new Set(rules.flatMap(({ conditions }) => conditions.flatMap((condition) =>
    condition.kind === "header" ? [condition.name.toLowerCase()] : [],
  )))];
const propertyFor = (name: string) => `header:${name}:asText:all`;
const addresses = (values: readonly { readonly email: string }[] | null | undefined) =>
  (values ?? []).map(({ email }) => email);

const headerRecord = (
  value: z.infer<typeof previewEmailSchema>,
  names: readonly string[],
): Readonly<Record<string, readonly string[]>> => Object.fromEntries(
  names.flatMap((name) => {
    const raw = value[propertyFor(name)];
    if (raw === null || raw === undefined) return [];
    if (!Array.isArray(raw) || raw.length > 100 || raw.some(
      (entry) => typeof entry !== "string" || entry.length > 8_192,
    )) throw new Error("The provider returned invalid preview headers.");
    return [[name, raw] as const];
  }),
);

export const previewStalwartRules = async (
  client: StalwartJmapClient,
  input: RulePreviewInput,
): Promise<readonly RulePreviewResult[]> => {
  if (input.limit < 1 || input.limit > MAX_MAIL_RULE_PREVIEW_MESSAGES) {
    throw new Error("Rule preview limit is invalid.");
  }
  if (input.rules.some(({ conditions }) => conditions.some((condition) =>
    condition.kind === "address" && condition.field === "recipient"))) {
    throw new Error("Envelope-recipient conditions cannot be previewed.");
  }
  const headers = customHeaders(input.rules);
  if (headers.length > MAX_MAIL_RULE_PREVIEW_HEADERS) {
    throw new Error("Too many preview headers were requested.");
  }
  const session = await client.getSession();
  const accountId = session.primaryAccounts[JMAP_MAIL];
  if (!accountId) throw new Error("This account does not expose JMAP Mail.");
  const response = await client.request([["Email/query", {
    accountId, limit: input.limit, position: 0,
    sort: [{ isAscending: false, property: "receivedAt" }],
  }, "query"], ["Email/get", {
    "#ids": { name: "Email/query", path: "/ids", resultOf: "query" },
    accountId,
    properties: ["id", "receivedAt", "size", "subject", "from", "to", "cc",
      "hasAttachment", ...headers.map(propertyFor)],
  }, "emails"]], [JMAP_MAIL]);
  const query = client.result(response, "query", "Email/query", jmapQueryResultSchema);
  const emails = client.result(
    response, "emails", "Email/get", jmapListResultSchema(previewEmailSchema),
  );
  if (query.accountId !== accountId || emails.accountId !== accountId ||
    emails.list.length !== query.ids.length || emails.list.length > input.limit) {
    throw new Error("The provider returned an inconsistent rule preview.");
  }
  const byId = new Map(emails.list.map((email) => [email.id, email]));
  return query.ids.map((messageId) => {
    const email = byId.get(messageId);
    if (!email) throw new Error("The provider omitted a preview message.");
    const facts = {
      cc: addresses(email.cc), from: addresses(email.from),
      hasAttachment: email.hasAttachment, headers: headerRecord(email, headers),
      id: id.message(email.id), receivedAt: email.receivedAt,
      recipient: [], size: email.size, subject: email.subject ?? "",
      to: addresses(email.to),
    };
    return {
      evaluation: evaluateMailRules(input.rules, facts),
      from: facts.from, messageId: facts.id,
      receivedAt: facts.receivedAt, subject: facts.subject,
    };
  });
};
