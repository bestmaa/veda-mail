import "server-only";

import {
  MAX_MAIL_RULE_PREVIEW_HEADERS,
  type MailRule,
  type RulePreviewInput,
} from "@/domain/mail/rule";
import type { ProviderConnection } from "@/domain/provider/provider";
import { resolveGateway } from "@/server/mail/gateway-cache";
import { ApiError } from "@/transport/http/api-error";

const previewHeaders = (rules: readonly MailRule[]): readonly string[] =>
  [...new Set(rules.flatMap(({ conditions }) => conditions.flatMap((condition) =>
    condition.kind === "header" ? [condition.name.toLowerCase()] : [],
  )))];

export const previewMailRules = async (
  connection: ProviderConnection,
  input: RulePreviewInput,
) => {
  if (input.rules.some(({ conditions }) => conditions.some(
    (condition) => condition.kind === "address" && condition.field === "recipient",
  ))) {
    throw new ApiError(
      "Recipient-envelope conditions cannot be previewed safely.",
      "MAIL_RULE_PREVIEW_CONDITION_UNSUPPORTED",
      422,
    );
  }
  if (previewHeaders(input.rules).length > MAX_MAIL_RULE_PREVIEW_HEADERS) {
    throw new ApiError(
      `A preview can inspect at most ${MAX_MAIL_RULE_PREVIEW_HEADERS} custom headers.`,
      "MAIL_RULE_PREVIEW_HEADER_LIMIT",
      422,
    );
  }
  return (await resolveGateway(connection)).previewRules(input);
};
