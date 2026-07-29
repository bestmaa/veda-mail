import "server-only";

import type { ProviderModule } from "@/application/ports/mail-provider.port";
import type {
  MemberCredentials,
  ProviderConnection,
} from "@/domain/provider/provider";
import { id } from "@/domain/shared/brand";
import { assertSafeProviderOrigin } from "@/infrastructure/providers/stalwart-jmap/provider-url-policy";
import { StalwartMailGateway } from "@/infrastructure/providers/stalwart-jmap/stalwart-mail.gateway";
import { StalwartOAuthClient } from "@/infrastructure/providers/stalwart-jmap/stalwart-oauth.client";
import type { StalwartConfig } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.types";
import { z } from "zod";

const serviceConfigSchema = z
  .object({
    baseUrl: z
      .string()
      .url()
      .refine((value) => {
        const url = new URL(value);
        const isDevelopmentLoopback =
          process.env.NODE_ENV !== "production" &&
          url.protocol === "http:" &&
          ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
        return url.protocol === "https:" || isDevelopmentLoopback;
      }, "Use an HTTPS Stalwart URL."),
  })
  .strict();

const basicMemberConfigSchema = serviceConfigSchema
  .extend({
    authType: z.literal("basic"),
    secret: z.string().min(1, "A password is required."),
    username: z.string().email(),
  })
  .strict();

const bearerMemberConfigSchema = serviceConfigSchema
  .extend({
    authType: z.literal("bearer"),
    expiresAt: z.string().datetime(),
    oauthClientId: z.string().min(1),
    refreshToken: z.string().min(1),
    secret: z.string().min(1),
    username: z.string().email(),
  })
  .strict();

const memberConfigSchema = z.discriminatedUnion("authType", [
  basicMemberConfigSchema,
  bearerMemberConfigSchema,
]);

export const parseStalwartMemberConfig = (
  input: Readonly<Record<string, string>>,
): StalwartConfig => memberConfigSchema.parse(input);

export class StalwartProviderModule implements ProviderModule {
  public readonly manifest = {
    capabilities: {
      maxAttachmentBytes: 18 * 1024 * 1024,
      supportsDrafts: false,
      supportsPasswordChange: true,
      supportsProfileSettings: true,
      supportsPush: false,
      supportsServerSearch: true,
      supportsThreads: false,
      supportsTwoFactorAuthentication: true,
    },
    description: "Connect directly to a Stalwart JMAP mail server.",
    fields: [
      {
        defaultValue: "",
        help: "Public HTTPS URL used for JMAP discovery.",
        kind: "url",
        label: "Server URL",
        name: "baseUrl",
        placeholder: "https://mail.example.com",
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
        label: "Password",
        name: "password",
        placeholder: "Your mailbox password",
        required: true,
        scope: "member",
        secret: true,
      },
    ],
    id: id.provider("stalwart-jmap"),
    name: "Stalwart JMAP",
  } as const;

  public parseServiceConfig(input: Readonly<Record<string, string>>) {
    return serviceConfigSchema.parse(input);
  }

  public async validateServiceConfig(input: Readonly<Record<string, string>>) {
    const parsed = serviceConfigSchema.parse(input);
    await assertSafeProviderOrigin(parsed.baseUrl);
    return parsed;
  }

  public createMemberConfig(
    serviceConfig: Readonly<Record<string, string>>,
    credentials: MemberCredentials,
  ) {
    return memberConfigSchema.parse({
      ...serviceConfigSchema.parse(serviceConfig),
      authType: "basic",
      secret: credentials.password,
      username: credentials.email,
    }) satisfies StalwartConfig;
  }

  public authenticateMember(
    serviceConfig: Readonly<Record<string, string>>,
    credentials: MemberCredentials,
  ) {
    return StalwartOAuthClient.authenticate(
      { baseUrl: String(serviceConfig["baseUrl"] ?? "") },
      credentials,
    );
  }

  public rotateMemberSecret(
    config: Readonly<Record<string, string>>,
    newPassword: string,
  ) {
    const parsed = memberConfigSchema.parse(config);
    return parsed.authType === "bearer"
      ? config
      : basicMemberConfigSchema.parse({ ...parsed, secret: newPassword });
  }

  public async createGateway(connection: ProviderConnection) {
    const config = parseStalwartMemberConfig(connection.config);
    return new StalwartMailGateway(config);
  }
}
