import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { id } from "@/domain/shared/brand";
import { hashAdminPassword } from "@/server/installation/password-hash";
import { installationStore } from "@/server/installation/installation.store";
import { mailServiceProfileStore } from "@/server/mail-service/mail-service-profile.store";

const original = {
  baseUrl: process.env["STALWART_BASE_URL"],
  dataDirectory: process.env["VEDA_MAIL_DATA_DIR"],
  secret: process.env["STALWART_SECRET"],
  username: process.env["STALWART_USERNAME"],
};

let temporaryDirectory = "";

const restore = (name: string, value: string | undefined): void => {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
};

beforeEach(async () => {
  temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "veda-mail-"));
  process.env["VEDA_MAIL_DATA_DIR"] = temporaryDirectory;
});

afterEach(async () => {
  restore("STALWART_BASE_URL", original.baseUrl);
  restore("STALWART_SECRET", original.secret);
  restore("STALWART_USERNAME", original.username);
  restore("VEDA_MAIL_DATA_DIR", original.dataDirectory);
  await rm(temporaryDirectory, { force: true, recursive: true });
});

describe("mail-service profile store", () => {
  it("persists one normalized service profile without member secrets", async () => {
    await installationStore.complete(async () => ({
      mailProfile: {
        allowedDomains: ["example.com"],
        config: { baseUrl: "https://old.example.com" },
        displayName: "Old mail",
        providerId: id.provider("stalwart-jmap"),
      },
      organization: {
        accentColor: "#ff6b57",
        logoFileName: null,
        organizationName: "Example",
        primaryColor: "#27276f",
        productName: "Example Mail",
        publicRepositoryUrl: null,
      },
      owner: {
        password: await hashAdminPassword("strong-password-123"),
        username: "owner",
      },
    }));
    const profile = await mailServiceProfileStore.put({
      allowedDomains: ["Example.COM", "example.com"],
      config: { baseUrl: "https://mail.example.com" },
      displayName: "Organization mail",
      providerId: id.provider("stalwart-jmap"),
    });
    const stored = await readFile(
      path.join(temporaryDirectory, "installation.json"),
      "utf8",
    );

    expect(profile.allowedDomains).toEqual(["example.com"]);
    const parsed = JSON.parse(stored) as {
      mailProfile: Record<string, unknown>;
    };
    expect(parsed).toMatchObject({
      mailProfile: {
        allowedDomains: ["example.com"],
        config: { baseUrl: "https://mail.example.com" },
        version: 1,
      },
    });
    const storedProfile = JSON.stringify(parsed.mailProfile);
    expect(storedProfile).not.toContain("password");
    expect(storedProfile).not.toContain("secret");
  });

  it("does not bypass first-run setup with legacy environment settings", async () => {
    process.env["STALWART_BASE_URL"] = "https://mail.example.com";
    process.env["STALWART_USERNAME"] = "member@example.com";
    process.env["STALWART_SECRET"] = "mailbox-secret";

    await expect(mailServiceProfileStore.get()).resolves.toBeNull();
  });
});
