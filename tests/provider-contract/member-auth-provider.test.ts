import { describe, expect, it } from "vitest";

import { MockProviderModule } from "@/infrastructure/providers/mock/mock-provider.module";
import { ImapSmtpProviderModule } from "@/infrastructure/providers/imap-smtp/imap-smtp-provider.module";
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
    expect(
      memberFields.find((field) => field.name === "password")?.secret,
    ).toBe(true);
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
    expect(
      provider.rotateMemberSecret(
        {
          authType: "basic",
          baseUrl: "https://mail.example.com",
          secret: "old-password",
          username: "member@example.com",
        },
        "new-password",
      ),
    ).toMatchObject({ secret: "new-password" });
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

  it("keeps generic IMAP/SMTP service settings free of member secrets", () => {
    const provider = new ImapSmtpProviderModule();
    const service = provider.parseServiceConfig({
      imapHost: "imap.example.com",
      imapPort: "993",
      imapSecurity: "tls",
      smtpHost: "smtp.example.com",
      smtpPort: "587",
      smtpSecurity: "starttls",
    });
    expect(service).not.toHaveProperty("secret");
    expect(service).toMatchObject({
      manageSieveHost: "",
      manageSievePort: "",
      manageSieveSecurity: "",
      smtpMaxMessageBytes: "0",
    });
    expect(
      provider.createMemberConfig(service, {
        email: "member@example.com",
        password: "app-password",
      }),
    ).toMatchObject({
      imapHost: "imap.example.com",
      secret: "app-password",
      smtpHost: "smtp.example.com",
      username: "member@example.com",
    });
    expect(
      provider.manifest.fields.filter((field) => field.scope === "member"),
    ).toMatchObject([
      { name: "email", secret: false },
      { name: "password", secret: true },
    ]);
    expect(provider.manifest.capabilities.maxAttachmentBytes).toBe(
      18 * 1024 * 1024,
    );
    expect(provider.manifest.fields.filter(({ name }) =>
      name.startsWith("manageSieve"))).toHaveLength(3);
  });

  it("requires a complete TLS-only ManageSieve endpoint", async () => {
    const provider = new ImapSmtpProviderModule();
    await expect(provider.validateServiceConfig({
      imapHost: "imap.example.com",
      imapPort: "993",
      imapSecurity: "tls",
      manageSievePort: "4190",
      smtpHost: "smtp.example.com",
      smtpPort: "465",
      smtpSecurity: "tls",
    })).rejects.toThrow("Complete all ManageSieve settings");
    expect(() => provider.parseServiceConfig({
      imapHost: "imap.example.com",
      imapPort: "993",
      imapSecurity: "tls",
      manageSieveHost: "sieve.example.com",
      manageSievePort: "4190",
      manageSieveSecurity: "cleartext",
      smtpHost: "smtp.example.com",
      smtpPort: "465",
      smtpSecurity: "tls",
    })).toThrow();
  });

  it("advertises received downloads separately from outbound attachment limits", () => {
    const providers = [
      new MockProviderModule(),
      new StalwartProviderModule(),
      new ImapSmtpProviderModule(),
    ];
    for (const provider of providers) {
      expect(provider.manifest.capabilities).toMatchObject({
        maxAttachmentBytes: 18 * 1024 * 1024,
        maxAttachmentDownloadBytes: 50 * 1024 * 1024,
        supportsAttachmentDownload: true,
      });
    }
  });
});
