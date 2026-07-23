import { describe, expect, it } from "vitest";

import { MockProviderModule } from "@/infrastructure/providers/mock/mock-provider.module";
import { StalwartProviderModule } from "@/infrastructure/providers/stalwart-jmap/stalwart-provider.module";

describe("member authentication provider contract", () => {
  it("keeps service settings separate from member credentials", () => {
    const provider = new StalwartProviderModule();
    const serviceFields = provider.manifest.fields.filter(
      (field) => field.scope === "service",
    );
    const memberFields = provider.manifest.fields.filter(
      (field) => field.scope === "member",
    );

    expect(serviceFields.map((field) => field.name)).toEqual(["baseUrl"]);
    expect(memberFields.map((field) => field.name)).toEqual([
      "email",
      "password",
    ]);
    expect(memberFields.find((field) => field.name === "password")?.secret).toBe(
      true,
    );
  });

  it("builds a Stalwart connection only after credentials are supplied", () => {
    const provider = new StalwartProviderModule();
    const service = provider.parseServiceConfig({
      baseUrl: "https://mail.example.com",
    });

    expect(
      provider.createMemberConfig(service, {
        email: "member@example.com",
        password: "mailbox-secret",
      }),
    ).toEqual({
      authType: "basic",
      baseUrl: "https://mail.example.com",
      secret: "mailbox-secret",
      username: "member@example.com",
    });
    expect(() =>
      provider.parseServiceConfig({
        baseUrl: "https://mail.example.com",
        secret: "must-not-live-in-the-service-profile",
      }),
    ).toThrow();
  });

  it("lets alternate providers translate the same member credentials", () => {
    const provider = new MockProviderModule();

    expect(
      provider.createMemberConfig(provider.parseServiceConfig({}), {
        email: "member@example.com",
        password: "ignored-by-demo",
      }),
    ).toEqual({ username: "member@example.com" });
  });
});
