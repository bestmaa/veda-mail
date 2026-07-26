import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import * as OTPAuth from "otpauth";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { id } from "@/domain/shared/brand";
import { memberTwoFactorSecurity } from "@/server/auth/member-two-factor";
import type { InstallationDraft } from "@/server/installation/installation.store";
import { installationStore } from "@/server/installation/installation.store";
import { hashAdminPassword } from "@/server/installation/password-hash";

const originalDirectory = process.env["VEDA_MAIL_DATA_DIR"];
let temporaryDirectory = "";

const draft = async (): Promise<InstallationDraft> => ({
  mailProfile: {
    allowedDomains: ["example.com"],
    config: { baseUrl: "https://mail.example.com" },
    displayName: "Example Mail",
    providerId: id.provider("stalwart-jmap"),
  },
  organization: {
    accentColor: "#ff6b57",
    logoFileName: null,
    organizationName: "Example Org",
    primaryColor: "#27276f",
    productName: "Example Mail",
    publicRepositoryUrl: null,
  },
  owner: {
    password: await hashAdminPassword("strong-password-123"),
    username: "owner",
  },
});

beforeEach(async () => {
  temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "veda-member-mfa-"));
  process.env["VEDA_MAIL_DATA_DIR"] = temporaryDirectory;
  await installationStore.complete(draft);
});

afterEach(async () => {
  if (originalDirectory === undefined) {
    delete process.env["VEDA_MAIL_DATA_DIR"];
  } else {
    process.env["VEDA_MAIL_DATA_DIR"] = originalDirectory;
  }
  await rm(temporaryDirectory, { force: true, recursive: true });
});

describe("provider-independent member two-factor security", () => {
  it("encrypts TOTP state and consumes each backup code once", async () => {
    const authenticator = new OTPAuth.TOTP({
      algorithm: "SHA1",
      digits: 6,
      issuer: "Example Mail",
      label: "member@example.com",
      period: 30,
      secret: new OTPAuth.Secret({ size: 20 }),
    });
    const backupCodes = await memberTwoFactorSecurity.enable(
      "Member@Example.com",
      authenticator.toString(),
    );
    const securityPath = path.join(temporaryDirectory, "member-security.json");
    const [contents, fileStats] = await Promise.all([
      readFile(securityPath, "utf8"),
      stat(securityPath),
    ]);

    expect(fileStats.mode & 0o777).toBe(0o600);
    expect(contents).not.toContain(authenticator.secret.base32);
    expect(contents).not.toContain(backupCodes[0]);
    expect(await memberTwoFactorSecurity.isEnabled("member@example.com")).toBe(
      true,
    );
    expect(
      await memberTwoFactorSecurity.verify(
        "member@example.com",
        authenticator.generate(),
      ),
    ).toBe(true);
    expect(
      await memberTwoFactorSecurity.verify(
        "member@example.com",
        backupCodes[0]!,
      ),
    ).toBe(true);
    expect(
      await memberTwoFactorSecurity.verify(
        "member@example.com",
        backupCodes[0]!,
      ),
    ).toBe(false);
  });

  it("removes only the selected mailbox security record", async () => {
    const first = new OTPAuth.TOTP({
      issuer: "Mail",
      label: "first@example.com",
      secret: new OTPAuth.Secret({ size: 20 }),
    });
    const second = new OTPAuth.TOTP({
      issuer: "Mail",
      label: "second@example.com",
      secret: new OTPAuth.Secret({ size: 20 }),
    });
    await memberTwoFactorSecurity.enable("first@example.com", first.toString());
    await memberTwoFactorSecurity.enable("second@example.com", second.toString());
    await memberTwoFactorSecurity.disable("first@example.com");

    expect(await memberTwoFactorSecurity.isEnabled("first@example.com")).toBe(
      false,
    );
    expect(await memberTwoFactorSecurity.isEnabled("second@example.com")).toBe(
      true,
    );
  });
});
