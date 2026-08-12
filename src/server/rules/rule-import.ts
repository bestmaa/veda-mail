import "server-only";

import {
  MAX_MAIL_RULES,
  type MailRuleDefinition,
} from "@/domain/mail/rule";
import { appendRuleAudit } from "@/server/rules/rule-audit";
import {
  emptyRuleBookProjection,
  parseStoredRuleBook,
  type StoredRuleBook,
} from "@/server/rules/rule-record";
import { parseMailRule } from "@/server/rules/rule-schema";
import { ApiError } from "@/transport/http/api-error";

export const createImportedRuleBook = (
  current: StoredRuleBook | null,
  definitions: readonly MailRuleDefinition[],
  now: string,
): StoredRuleBook => {
  if (definitions.length > MAX_MAIL_RULES) {
    throw new ApiError(
      `Each identity can contain at most ${MAX_MAIL_RULES} mail rules.`,
      "MAIL_RULE_LIMIT_REACHED",
      422,
    );
  }
  const rules = definitions.map((definition) => parseMailRule({
    ...definition,
    createdAt: now,
    id: crypto.randomUUID(),
    updatedAt: now,
  }));
  const revision = crypto.randomUUID();
  return parseStoredRuleBook({
    audit: appendRuleAudit(current?.audit ?? [], "import", null, now),
    connection: null,
    createdAt: current?.createdAt ?? now,
    deployment: {
      ...emptyRuleBookProjection().deployment,
      desiredRevision: revision,
      updatedAt: now,
    },
    revision,
    rules,
    updatedAt: now,
    version: 1,
  });
};
