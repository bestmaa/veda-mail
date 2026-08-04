import "server-only";

import type { Mailbox } from "@/domain/mail/mailbox";
import type { RuleDeploymentInput } from "@/domain/mail/rule";
import { decodeMailboxId } from "@/infrastructure/providers/imap-smtp/imap-codec";
import type { ImapSmtpMemberConfig } from "@/infrastructure/providers/imap-smtp/imap-smtp.types";
import { ManageSieveClient } from "@/infrastructure/providers/imap-smtp/manage-sieve-client";
import { manageSieveUnsupported } from "@/infrastructure/providers/imap-smtp/manage-sieve-errors";
import { ManageSieveRuleAdapter } from "@/infrastructure/providers/imap-smtp/manage-sieve-rule-adapter";
import { createOwnedSieveCompiler } from "@/infrastructure/providers/sieve/sieve-owned-compiler";
import { sieveDeliveryMailboxNames } from "@/infrastructure/providers/sieve/sieve-mailbox-names";

const configured = (config: ImapSmtpMemberConfig): boolean => Boolean(
  config.manageSieveHost && config.manageSievePort && config.manageSieveSecurity,
);

const adapter = (
  config: ImapSmtpMemberConfig,
  mailboxNames: Readonly<Record<string, string>>,
) => new ManageSieveRuleAdapter(
  new ManageSieveClient(config),
  createOwnedSieveCompiler(mailboxNames),
);

export const getImapRuleCapability = async (config: ImapSmtpMemberConfig) => {
  if (!configured(config)) return {
    maxRules: 0,
    maxScriptBytes: null,
    reason: "ManageSieve is not configured for this account.",
    supported: false,
    supportedActions: [],
    supportedConditions: [],
  } as const;
  return adapter(config, {}).getCapability();
};

export const deployImapRules = (
  config: ImapSmtpMemberConfig,
  mailboxes: readonly Mailbox[],
  input: RuleDeploymentInput,
) => {
  if (!configured(config)) {
    return manageSieveUnsupported("ManageSieve is not configured for this account.");
  }
  const names = sieveDeliveryMailboxNames(mailboxes.map((mailbox) => ({
    ...mailbox,
    name: decodeMailboxId(mailbox.id),
    parentId: null,
  })));
  return adapter(config, names).deploy(input);
};
