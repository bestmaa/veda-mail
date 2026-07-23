import {
  mkdtemp,
  readFile,
  rm,
  stat,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { id } from "@/domain/shared/brand";
import { hashAdminPassword } from "@/server/installation/password-hash";
import { installationStore } from "@/server/installation/installation.store";
import {
  emailDomain,
  mailServiceProfileInputSchema,
  memberCredentialsSchema,
} from "@/server/mail-service/mail-service-profile.schema";
import { mailServiceProfileRevision } from "@/server/mail-service/mail-service-profile-revision";
import { mailServiceProfileStore } from "@/server/mail-service/mail-service-profile.store";

const originalEnv = {
  dataDirectory: process.env["VEDA_MAIL_DATA_DIR"],
};

let directory = "";

const restore = (name: string, value: string | undefined): void => {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
};

const install = async () =>
  installationStore.complete(async () => ({
    mailProfile: {
      allowedDomains: ["vedaconcepts.com"],
      config: { baseUrl: "https://old.example.com" },
      displayName: "Old Mail",
      providerId: id.provider("stalwart-jmap"),
    },
    organization: {
      accentColor: "#ff6b57",
      logoFileName: null,
      organizationName: "Veda Concepts",
      primaryColor: "#27276f",
      productName: "Veda Mail",
      publicRepositoryUrl: null,
    },
    owner: {
      password: await hashAdminPassword("strong-password-123"),
      username: "owner",
    },
  }));

beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "veda-mail-profile-"));
  process.env["VEDA_MAIL_DATA_DIR"] = directory;
});

afterEach(async () => {
  restore("VEDA_MAIL_DATA_DIR", originalEnv.dataDirectory);
  await rm(directory, { force: true, recursive: true });
});

describe("mail service profile", () => {
  it("normalizes domains and member email domains", () => {
    const profile = mailServiceProfileInputSchema.parse({
      allowedDomains: ["VEDACONCEPTS.COM.", "vedaconcepts.com"],
      config: { baseUrl: "https://mail.example.com" },
      displayName: "Veda Mail",
      providerId: "stalwart-jmap",
    });
    const credentials = memberCredentialsSchema.parse({
      email: "Member@VEDACONCEPTS.COM",
      password: "mailbox-secret",
    });

    expect(profile.allowedDomains).toEqual(["vedaconcepts.com"]);
    expect(credentials.email).toBe("Member@vedaconcepts.com");
    expect(emailDomain(credentials.email)).toBe("vedaconcepts.com");
  });

  it("persists one atomic, private service profile", async () => {
    await install();
    const saved = await mailServiceProfileStore.put({
      allowedDomains: ["vedaconcepts.com"],
      config: { baseUrl: "https://mail.example.com" },
      displayName: "Veda Concepts Mail",
      providerId: id.provider("stalwart-jmap"),
    });
    const storedPath = path.join(directory, "installation.json");
    const persisted = JSON.parse(await readFile(storedPath, "utf8")) as {
      mailProfile: unknown;
    };

    expect(await mailServiceProfileStore.get()).toEqual(saved);
    expect(persisted.mailProfile).toEqual(saved);
    expect((await stat(storedPath)).mode & 0o777).toBe(0o600);
  });

  it("changes the session revision when service settings change", async () => {
    await install();
    const first = await mailServiceProfileStore.put({
      allowedDomains: ["vedaconcepts.com"],
      config: { baseUrl: "https://mail.example.com" },
      displayName: "Veda Concepts Mail",
      providerId: id.provider("stalwart-jmap"),
    });
    const second = await mailServiceProfileStore.put({
      allowedDomains: ["vedaconcepts.com", "example.org"],
      config: { baseUrl: "https://mail.example.com" },
      displayName: "Veda Concepts Mail",
      providerId: id.provider("stalwart-jmap"),
    });

    expect(mailServiceProfileRevision(first)).not.toBe(
      mailServiceProfileRevision(second),
    );
  });
});
