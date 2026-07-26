import "server-only";

import { z } from "zod";

import type { ProviderModule } from "@/application/ports/mail-provider.port";
import type {
  MemberCredentials,
  ProviderConnection,
} from "@/domain/provider/provider";
import { id } from "@/domain/shared/brand";
import { ImapSmtpMailGateway } from "@/infrastructure/providers/imap-smtp/imap-mail.gateway";
import { verifyImapCredentials } from "@/infrastructure/providers/imap-smtp/imap-client";
import type {
  ImapSmtpMemberConfig,
} from "@/infrastructure/providers/imap-smtp/imap-smtp.types";
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

const serviceSchema = z
  .object({
    imapHost: hostname,
    imapPort: port,
    imapSecurity: security,
    smtpHost: hostname,
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

const securityOptions = [
  { label: "TLS (recommended)", value: "tls" },
  { label: "STARTTLS", value: "starttls" },
] as const;

export class ImapSmtpProviderModule implements ProviderModule {
  public readonly manifest = {
    capabilities: {
      maxAttachmentBytes: 25_000_000,
      supportsDrafts: false,
      supportsPasswordChange: false,
      supportsProfileSettings: false,
      supportsPush: false,
      supportsServerSearch: true,
      supportsThreads: false,
      supportsTwoFactorAuthentication: false,
    },
    description:
      "Connect Hostinger, cPanel, Zoho and other standard IMAP/SMTP services.",
    fields: [
      {
        defaultValue: "imap.example.com",
        help: "Public hostname from your provider's incoming-mail settings.",
        kind: "text",
        label: "IMAP host",
        name: "imapHost",
        placeholder: "imap.example.com",
        required: true,
        scope: "service",
        secret: false,
      },
      {
        defaultValue: "993",
        kind: "text",
        label: "IMAP port",
        name: "imapPort",
        required: true,
        scope: "service",
        secret: false,
      },
      {
        defaultValue: "tls",
        kind: "select",
        label: "IMAP security",
        name: "imapSecurity",
        options: securityOptions,
        required: true,
        scope: "service",
        secret: false,
      },
      {
        defaultValue: "smtp.example.com",
        help: "Public hostname from your provider's outgoing-mail settings.",
        kind: "text",
        label: "SMTP host",
        name: "smtpHost",
        placeholder: "smtp.example.com",
        required: true,
        scope: "service",
        secret: false,
      },
      {
        defaultValue: "465",
        kind: "text",
        label: "SMTP port",
        name: "smtpPort",
        required: true,
        scope: "service",
        secret: false,
      },
      {
        defaultValue: "tls",
        kind: "select",
        label: "SMTP security",
        name: "smtpSecurity",
        options: securityOptions,
        required: true,
        scope: "service",
        secret: false,
      },
      {
        autocomplete: "username",
        kind: "email",
        label: "Email address",
        name: "email",
        placeholder: "you@example.com",
        required: true,
        scope: "member",
        secret: false,
      },
      {
        autocomplete: "current-password",
        kind: "password",
        label: "Password or app password",
        name: "password",
        required: true,
        scope: "member",
        secret: true,
      },
    ],
    id: id.provider("imap-smtp"),
    name: "Standard IMAP + SMTP",
  } as const;

  public parseServiceConfig(input: Readonly<Record<string, string>>) {
    return serviceSchema.parse(input);
  }

  public async validateServiceConfig(input: Readonly<Record<string, string>>) {
    const parsed = serviceSchema.parse(input);
    await Promise.all([
      assertSafeProviderHost(parsed.imapHost),
      assertSafeProviderHost(parsed.smtpHost),
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
    return memberSchema.parse({ ...memberSchema.parse(config), secret: newPassword });
  }

  public async createGateway(connection: ProviderConnection) {
    return new ImapSmtpMailGateway(memberSchema.parse(connection.config));
  }
}
