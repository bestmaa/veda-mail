import "server-only";

import type { ProviderModule } from "@/application/ports/mail-provider.port";
import type { ProviderManifest } from "@/domain/provider/provider";
import type { ProviderId } from "@/domain/shared/brand";

export class ProviderRegistry {
  private readonly modules = new Map<ProviderId, ProviderModule>();

  public register(module: ProviderModule): void {
    if (this.modules.has(module.manifest.id)) {
      throw new Error(`Provider ${module.manifest.id} is already registered.`);
    }
    this.modules.set(module.manifest.id, module);
  }

  public get(providerId: ProviderId): ProviderModule {
    const providerModule = this.modules.get(providerId);
    if (!providerModule) {
      throw new Error(`Unknown mail provider: ${providerId}`);
    }
    return providerModule;
  }

  public list(): readonly ProviderManifest[] {
    return [...this.modules.values()].map(
      (providerModule) => providerModule.manifest,
    );
  }
}
