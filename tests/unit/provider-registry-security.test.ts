import { describe, expect, it } from "vitest";

import { createProviderRegistry } from "@/bootstrap/provider-registry";

describe("provider registry security", () => {
  it("does not register the demo provider in production", () => {
    const providerIds = createProviderRegistry("production")
      .list()
      .map((provider) => provider.id);

    expect(providerIds).toContain("stalwart-jmap");
    expect(providerIds).toContain("imap-smtp");
    expect(providerIds).not.toContain("mock");
  });

  it.each(["development", "test", undefined] as const)(
    "registers the demo provider outside production (%s)",
    (environment) => {
      const providerIds = createProviderRegistry(environment)
        .list()
        .map((provider) => provider.id);

      expect(providerIds).toContain("mock");
    },
  );
});
