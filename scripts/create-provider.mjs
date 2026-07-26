import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const [providerId, ...nameParts] = process.argv.slice(2);
const displayName = nameParts.join(" ").trim();

if (!providerId || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(providerId)) {
  console.error(
    "Usage: npm run provider:create -- provider-id \"Provider Name\"",
  );
  process.exitCode = 1;
} else if (!displayName) {
  console.error("Add a human-readable provider name.");
  process.exitCode = 1;
} else {
  const className = providerId
    .split("-")
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join("");
  const directory = path.resolve(
    "src",
    "infrastructure",
    "providers",
    providerId,
  );
  await mkdir(directory, { recursive: false });
  const gateway = `import "server-only";

import type { MailGateway } from "@/application/ports/mail-provider.port";

export class ${className}MailGateway implements MailGateway {
  // Implement every MailGateway operation. Normalize provider DTOs here.
  public async changePassword() { throw new Error("Not implemented."); }
  public async getAccount() { throw new Error("Not implemented."); }
  public async getMemberProfile() { throw new Error("Not implemented."); }
  public async getTwoFactorEnabled() { return false; }
  public async getMessage() { throw new Error("Not implemented."); }
  public async listMailboxes() { throw new Error("Not implemented."); }
  public async listMessages() { throw new Error("Not implemented."); }
  public async mutateMessage() { throw new Error("Not implemented."); }
  public async sendMessage() { throw new Error("Not implemented."); }
  public async testConnection() { throw new Error("Not implemented."); }
  public async updateMemberProfile() { throw new Error("Not implemented."); }
  public async updateTwoFactor() { throw new Error("Not implemented."); }
}
`;
  const moduleTemplate = `import "server-only";

import { z } from "zod";
import type { ProviderModule } from "@/application/ports/mail-provider.port";
import { id } from "@/domain/shared/brand";
import { ${className}MailGateway } from "@/infrastructure/providers/${providerId}/${providerId}-mail.gateway";
import { assertSafeProviderOrigin } from "@/infrastructure/providers/stalwart-jmap/provider-url-policy";

const serviceSchema = z.object({
  endpoint: z.string().url(),
}).strict();
const memberSchema = serviceSchema.extend({
  secret: z.string().min(1),
  username: z.string().email(),
}).strict();

export class ${className}ProviderModule implements ProviderModule {
  public readonly manifest = {
    capabilities: {
      maxAttachmentBytes: 25_000_000,
      supportsDrafts: false,
      supportsPasswordChange: false,
      supportsProfileSettings: false,
      supportsPush: false,
      supportsServerSearch: false,
      supportsThreads: false,
      supportsTwoFactorAuthentication: false,
    },
    description: "Connect ${displayName}.",
    fields: [
      {
        kind: "url",
        label: "API endpoint",
        name: "endpoint",
        required: true,
        scope: "service",
        secret: false,
      },
      {
        kind: "email",
        label: "Email address",
        name: "email",
        required: true,
        scope: "member",
        secret: false,
      },
      {
        kind: "password",
        label: "Password or token",
        name: "password",
        required: true,
        scope: "member",
        secret: true,
      },
    ],
    id: id.provider("${providerId}"),
    name: "${displayName}",
  } as const;

  public parseServiceConfig(input: Readonly<Record<string, string>>) {
    return serviceSchema.parse(input);
  }
  public async validateServiceConfig(input: Readonly<Record<string, string>>) {
    const parsed = this.parseServiceConfig(input);
    await assertSafeProviderOrigin(parsed.endpoint);
    return parsed;
  }
  public createMemberConfig(service: Readonly<Record<string, string>>, credentials: { email: string; password: string }) {
    return memberSchema.parse({
      ...this.parseServiceConfig(service),
      secret: credentials.password,
      username: credentials.email,
    });
  }
  public async authenticateMember(service: Readonly<Record<string, string>>, credentials: { email: string; password: string }) {
    const config = this.createMemberConfig(service, credentials);
    // Authenticate upstream and return rejected on any credential failure.
    return { config, status: "authenticated" as const };
  }
  public rotateMemberSecret(config: Readonly<Record<string, string>>, password: string) {
    return memberSchema.parse({ ...config, secret: password });
  }
  public async createGateway(connection: { config: Readonly<Record<string, string>> }) {
    memberSchema.parse(connection.config);
    return new ${className}MailGateway();
  }
}
`;
  await Promise.all([
    writeFile(path.join(directory, `${providerId}-mail.gateway.ts`), gateway, {
      flag: "wx",
    }),
    writeFile(
      path.join(directory, `${providerId}-provider.module.ts`),
      moduleTemplate,
      { flag: "wx" },
    ),
  ]);
  console.log(`Created provider skeleton at ${directory}`);
  console.log("Implement it, add contract tests, then register the module.");
}
