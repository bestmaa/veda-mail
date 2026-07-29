import "server-only";

import SMTPConnection from "nodemailer/lib/smtp-connection";

import type { ImapSmtpMemberConfig } from "@/infrastructure/providers/imap-smtp/imap-smtp.types";
import { assertSafeProviderHost } from "@/infrastructure/providers/stalwart-jmap/provider-url-policy";

type InspectableSmtpConnection = SMTPConnection & {
  readonly _maxAllowedSize?: unknown;
  readonly _supportedExtensions?: unknown;
  readonly allowsAuth?: boolean;
};

// Nodemailer parses EHLO SIZE but does not expose it in the public type. The
// exact runtime version is pinned and this narrow adapter is contract-tested.
export const readAdvertisedSmtpSize = (
  connection: Pick<
    InspectableSmtpConnection,
    "_maxAllowedSize" | "_supportedExtensions"
  >,
): number | null => {
  const extensions = connection._supportedExtensions;
  const maximum = connection._maxAllowedSize;
  if (
    !Array.isArray(extensions) ||
    !extensions.includes("SIZE") ||
    typeof maximum !== "number" ||
    !Number.isSafeInteger(maximum) ||
    maximum <= 0
  ) {
    return null;
  }
  return maximum;
};

const connectAndAuthenticate = (
  connection: InspectableSmtpConnection,
  config: ImapSmtpMemberConfig,
): Promise<void> =>
  new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      if (error) {
        connection.close();
        reject(error);
        return;
      }
      resolve();
    };
    connection.once("error", finish);
    connection.once("end", () =>
      finish(new Error("SMTP connection closed during capability discovery.")),
    );
    connection.connect((connectError) => {
      if (connectError) {
        finish(connectError);
        return;
      }
      if (!connection.allowsAuth) {
        finish();
        return;
      }
      connection.login(
        { pass: config.secret, user: config.username },
        (loginError) => finish(loginError),
      );
    });
  });

export const probeSmtpSizeLimit = async (
  config: ImapSmtpMemberConfig,
): Promise<number | null> => {
  await assertSafeProviderHost(config.smtpHost);
  const connection = new SMTPConnection({
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    host: config.smtpHost,
    port: Number(config.smtpPort),
    requireTLS: config.smtpSecurity === "starttls",
    secure: config.smtpSecurity === "tls",
    socketTimeout: 30_000,
  }) as InspectableSmtpConnection;
  await connectAndAuthenticate(connection, config);
  try {
    return readAdvertisedSmtpSize(connection);
  } finally {
    connection.quit();
  }
};
