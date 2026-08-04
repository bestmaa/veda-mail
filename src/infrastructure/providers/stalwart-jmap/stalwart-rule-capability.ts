import "server-only";

import {
  MAX_MAIL_RULES,
  type RuleCapability,
} from "@/domain/mail/rule";
import type { StalwartJmapClient } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.client";
import { JMAP_MAIL } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.types";
import { ruleUnsupported } from "@/infrastructure/providers/stalwart-jmap/stalwart-rule-errors";
import {
  JMAP_SIEVE,
  MAX_STALWART_SIEVE_SCRIPT_BYTES,
  parseAccountSieveCapability,
  parseServerSieveCapability,
  sieveSessionSchema,
  VEDA_RULE_SCRIPT_NAME,
} from "@/infrastructure/providers/stalwart-jmap/stalwart-sieve-schema";

export interface StalwartSieveContext {
  readonly accountId: string;
  readonly extensions: ReadonlySet<string>;
  readonly maxScriptBytes: number;
}

const unsupported = (reason: string): RuleCapability => ({
  maxRules: MAX_MAIL_RULES,
  maxScriptBytes: null,
  reason,
  supported: false,
  supportedActions: [],
  supportedConditions: [],
});

const discover = async (
  client: StalwartJmapClient,
): Promise<StalwartSieveContext | RuleCapability> => {
  const parsedSession = sieveSessionSchema.safeParse(await client.getSession());
  if (!parsedSession.success) {
    return unsupported("The provider returned invalid Sieve discovery data.");
  }
  const session = parsedSession.data;
  if (!parseServerSieveCapability(session.capabilities[JMAP_SIEVE]).success) {
    return unsupported("This provider does not advertise JMAP Sieve.");
  }
  const accountId = session.primaryAccounts[JMAP_SIEVE];
  if (!accountId || accountId !== session.primaryAccounts[JMAP_MAIL]) {
    return unsupported("Rules are unavailable for the primary mail account.");
  }
  const account = session.accounts[accountId];
  if (!account || account.isReadOnly) {
    return unsupported("The primary rules account is read-only.");
  }
  const parsed = parseAccountSieveCapability(
    account.accountCapabilities[JMAP_SIEVE],
  );
  if (!parsed.success) {
    return unsupported("The provider returned invalid Sieve capabilities.");
  }
  const maximum = parsed.data.maxSizeScript ?? MAX_STALWART_SIEVE_SCRIPT_BYTES;
  if (
    maximum < 1 || parsed.data.maxNumberScripts === 0 ||
    Buffer.byteLength(VEDA_RULE_SCRIPT_NAME, "utf8") >
      parsed.data.maxSizeScriptName
  ) {
    return unsupported("The provider cannot store the Veda rules script.");
  }
  return {
    accountId,
    extensions: new Set(parsed.data.sieveExtensions),
    maxScriptBytes: Math.min(maximum, MAX_STALWART_SIEVE_SCRIPT_BYTES),
  };
};

const capabilityFrom = (context: StalwartSieveContext): RuleCapability => {
  const flags = context.extensions.has("imap4flags");
  const attachment = ["foreverypart", "mime", "variables"].every(
    (extension) => context.extensions.has(extension),
  );
  return {
    maxRules: MAX_MAIL_RULES,
    maxScriptBytes: context.maxScriptBytes,
    supported: true,
    supportedActions: [
      "discard",
      ...(context.extensions.has("fileinto") ? ["move" as const] : []),
      ...(flags ? ["label" as const, "mark-read" as const, "star" as const] : []),
    ],
    supportedConditions: [
      "cc", "from", "header", "size", "subject", "to",
      ...(context.extensions.has("envelope") ? ["recipient" as const] : []),
      ...(attachment ? ["attachment" as const] : []),
    ],
  };
};

export const getStalwartRuleCapability = async (
  client: StalwartJmapClient,
): Promise<RuleCapability> => {
  const context = await discover(client);
  return "accountId" in context ? capabilityFrom(context) : context;
};

export const requireStalwartSieveContext = async (
  client: StalwartJmapClient,
): Promise<StalwartSieveContext> => {
  const context = await discover(client);
  if ("accountId" in context) return context;
  return ruleUnsupported(
    context.reason ?? "Rules are unavailable for this provider account.",
  );
};
