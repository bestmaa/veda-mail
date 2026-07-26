import "server-only";

import { ImapFlow, type ImapFlowOptions } from "imapflow";

import type { ImapSmtpMemberConfig } from "@/infrastructure/providers/imap-smtp/imap-smtp.types";
import { assertSafeProviderHost } from "@/infrastructure/providers/stalwart-jmap/provider-url-policy";

const options = (
  config: ImapSmtpMemberConfig,
  verifyOnly = false,
): ImapFlowOptions => ({
  auth: { pass: config.secret, user: config.username },
  connectionTimeout: 15_000,
  doSTARTTLS: config.imapSecurity === "starttls",
  greetingTimeout: 15_000,
  host: config.imapHost,
  logger: false,
  maxLineLength: 10 * 1024 * 1024,
  maxLiteralSize: 55 * 1024 * 1024,
  port: Number(config.imapPort),
  secure: config.imapSecurity === "tls",
  socketTimeout: 60_000,
  verifyOnly,
});

export const verifyImapCredentials = async (
  config: ImapSmtpMemberConfig,
): Promise<void> => {
  await assertSafeProviderHost(config.imapHost);
  const client = new ImapFlow(options(config, true));
  await client.connect();
};

export const withImapClient = async <T>(
  config: ImapSmtpMemberConfig,
  task: (client: ImapFlow) => Promise<T>,
): Promise<T> => {
  await assertSafeProviderHost(config.imapHost);
  const client = new ImapFlow(options(config));
  await client.connect();
  try {
    return await task(client);
  } finally {
    await client.logout().catch(() => client.close());
  }
};
