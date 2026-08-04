import "server-only";

import { z } from "zod";

import type { ProviderModule } from "@/application/ports/mail-provider.port";
import type {
  MemberCredentials,
  ProviderConnection,
} from "@/domain/provider/provider";
import { ImapSmtpMailGateway } from "@/infrastructure/providers/imap-smtp/imap-mail.gateway";
import { imapSmtpManifest } from "@/infrastructure/providers/imap-smtp/imap-smtp-provider-fields";
import { verifyImapCredentials } from "@/infrastructure/providers/imap-smtp/imap-client";
import type { ImapSmtpMemberConfig } from "@/infrastructure/providers/imap-smtp/imap-smtp.types";
import { assertSafeProviderHost } from "@/infrastructure/providers/stalwart-jmap/provider-url-policy";

const port = z.coerce.number().int().min(1).max(65_535).transform(String);
const hostname = z
  .string()
  .trim()
  .min(1)
  .max(253)
  .regex(/^[a-z0-9.-]+$/i, "Enter a valid mail-server hostname.")
  .transform((value) => value.toLowerCase());
const security = z.enum(["tls", "starttls"]);
const optionalHostname = z.preprocess(
  (value) => value ?? "",
  z.union([hostname, z.literal("")]),
);
const optionalPort = z.preprocess(
  (value) => value ?? "",
  z.union([port, z.literal("")]),
);
const optionalSecurity = z.preprocess(
  (value) => value ?? "",
  z.union([security, z.literal("")]),
);
const smtpMaxMessageBytes = z
  .preprocess(
    (value) => (value === "" ? undefined : value),
    z.coerce.number().int().min(0).max(1_000_000_000).default(0),
  )
  .transform(String);

const serviceSchema = z
  .object({
    imapHost: hostname,
    imapPort: port,
    imapSecurity: security,
    manageSieveHost: optionalHostname,
    manageSievePort: optionalPort,
    manageSieveSecurity: optionalSecurity,
    smtpHost: hostname,
    smtpMaxMessageBytes,
    smtpPort: port,
    smtpSecurity: security,
  })
  .strict();

const memberSchema = serviceSchema
  .extend({
    secret: z.string().min(1).max(1024),
    username: z.string().email().max(320),
  })
  .strict();

export class ImapSmtpProviderModule implements ProviderModule {
  public readonly manifest = imapSmtpManifest;

  public parseServiceConfig(input: Readonly<Record<string, string>>) {
    return serviceSchema.parse(input);
  }

  public async validateServiceConfig(input: Readonly<Record<string, string>>) {
    const parsed = serviceSchema.parse(input);
    const sieveValues = [
      parsed.manageSieveHost,
      parsed.manageSievePort,
      parsed.manageSieveSecurity,
    ];
    if (sieveValues.some(Boolean) && !sieveValues.every(Boolean)) {
      throw new Error("Complete all ManageSieve settings or leave all three blank.");
    }
    await Promise.all([
      assertSafeProviderHost(parsed.imapHost),
      assertSafeProviderHost(parsed.smtpHost),
      ...(parsed.manageSieveHost
        ? [assertSafeProviderHost(parsed.manageSieveHost)]
        : []),
    ]);
    return parsed;
  }

  public createMemberConfig(
    serviceConfig: Readonly<Record<string, string>>,
    credentials: MemberCredentials,
  ): ImapSmtpMemberConfig {
    return memberSchema.parse({
      ...serviceSchema.parse(serviceConfig),
      secret: credentials.password,
      username: credentials.email,
    });
  }

  public async authenticateMember(
    serviceConfig: Readonly<Record<string, string>>,
    credentials: MemberCredentials,
  ) {
    const config = this.createMemberConfig(serviceConfig, credentials);
    try {
      await verifyImapCredentials(config);
      return { config, status: "authenticated" as const };
    } catch {
      return { status: "rejected" as const };
    }
  }

  public rotateMemberSecret(
    config: Readonly<Record<string, string>>,
    newPassword: string,
  ) {
    return memberSchema.parse({
      ...memberSchema.parse(config),
      secret: newPassword,
    });
  }

  public async createGateway(connection: ProviderConnection) {
    return new ImapSmtpMailGateway(memberSchema.parse(connection.config));
  }
}
