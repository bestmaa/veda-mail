import "server-only";

import type { ProviderModule } from "@/application/ports/mail-provider.port";
import type { MemberCredentials } from "@/domain/provider/provider";
import { id } from "@/domain/shared/brand";
import { MockMailGateway } from "@/infrastructure/providers/mock/mock-mail.gateway";

export class MockProviderModule implements ProviderModule {
  public readonly manifest = {
    capabilities: {
      maxAttachmentBytes: 25_000_000,
      supportsDrafts: true,
      supportsPasswordChange: true,
      supportsProfileSettings: true,
      supportsPush: false,
      supportsServerSearch: true,
      supportsThreads: true,
    },
    description: "Explore every workflow with safe, deterministic demo mail.",
    fields: [],
    id: id.provider("mock"),
    name: "Demo workspace",
  };

  public parseServiceConfig(input: Readonly<Record<string, string>>) {
    void input;
    return {};
  }

  public async validateServiceConfig(
    input: Readonly<Record<string, string>>,
  ) {
    return this.parseServiceConfig(input);
  }

  public createMemberConfig(
    _serviceConfig: Readonly<Record<string, string>>,
    credentials: MemberCredentials,
  ) {
    return { username: credentials.email };
  }

  public async createGateway() {
    return new MockMailGateway();
  }

  public rotateMemberSecret(
    config: Readonly<Record<string, string>>,
    newPassword: string,
  ) {
    void newPassword;
    return config;
  }
}
