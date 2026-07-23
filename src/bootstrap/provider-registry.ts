import "server-only";

import { MockProviderModule } from "@/infrastructure/providers/mock/mock-provider.module";
import { ProviderRegistry } from "@/infrastructure/providers/provider-registry";
import { StalwartProviderModule } from "@/infrastructure/providers/stalwart-jmap/stalwart-provider.module";

let registry: ProviderRegistry | null = null;

export const createProviderRegistry = (
  environment = process.env.NODE_ENV,
): ProviderRegistry => {
  const nextRegistry = new ProviderRegistry();
  nextRegistry.register(new StalwartProviderModule());
  if (environment !== "production") {
    nextRegistry.register(new MockProviderModule());
  }
  return nextRegistry;
};

export const getProviderRegistry = (): ProviderRegistry => {
  if (registry) {
    return registry;
  }

  registry = createProviderRegistry();
  return registry;
};
