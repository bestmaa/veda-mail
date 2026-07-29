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

export const closeImapClient = async (client: ImapFlow): Promise<void> => {
  try {
    await client.logout();
  } catch {
    try {
      client.close();
    } catch {
      // Cleanup errors must not mask the provider operation result.
    }
  }
};

export const connectImapClient = async (
  config: ImapSmtpMemberConfig,
  signal?: AbortSignal,
): Promise<ImapFlow> => {
  await assertSafeProviderHost(config.imapHost);
  const client = new ImapFlow(options(config));
  const onAbort = (): void => {
    try {
      client.close();
    } catch {
      // The connection attempt still settles with the original abort failure.
    }
  };
  if (signal?.aborted) {
    onAbort();
    throw new DOMException("The IMAP connection was cancelled.", "AbortError");
  }
  signal?.addEventListener("abort", onAbort, { once: true });
  try {
    await client.connect();
    if (signal?.aborted) {
      throw new DOMException(
        "The IMAP connection was cancelled.",
        "AbortError",
      );
    }
    return client;
  } catch (error) {
    try {
      client.close();
    } catch {
      // Preserve the connection error that explains the failure.
    }
    throw error;
  } finally {
    signal?.removeEventListener("abort", onAbort);
  }
};

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
  const client = await connectImapClient(config);
  try {
    return await task(client);
  } finally {
    await closeImapClient(client);
  }
};
