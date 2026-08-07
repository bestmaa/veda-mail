import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { id } from "@/domain/shared/brand";
import {
  issueAdminToken,
  revokeAdminToken,
  verifyAdminCredentials,
  verifyAdminToken,
} from "@/server/auth/admin-session";
import {
  adminUsernameSchema,
  installationRecordSchema,
  setupInputSchema,
} from "@/server/installation/installation.schema";
import { installationStore } from "@/server/installation/installation.store";
import {
  hashAdminPassword,
  verifyAdminPasswordDigest,
} from "@/server/installation/password-hash";
import { assertSameOrigin } from "@/server/installation/request-origin";
import { assertSetupToken } from "@/server/installation/setup-token";

const original = {
  dataDirectory: process.env["VEDA_MAIL_DATA_DIR"],
  setupToken: process.env["VEDA_MAIL_SETUP_TOKEN"],
  trustProxy: process.env["VEDA_MAIL_TRUST_PROXY_HEADERS"],
};
let temporaryDirectory = "";

const install = async () =>
  installationStore.complete(async () => ({
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
      password: await hashAdminPassword("correct-password-123"),
      username: "owner",
    },
  }));

beforeEach(async () => {
  temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "veda-auth-"));
  process.env["VEDA_MAIL_DATA_DIR"] = temporaryDirectory;
  process.env["VEDA_MAIL_SETUP_TOKEN"] = "one-time-token-1234567890";
  delete process.env["VEDA_MAIL_TRUST_PROXY_HEADERS"];
});

afterEach(async () => {
  for (const [name, value] of Object.entries({
    VEDA_MAIL_DATA_DIR: original.dataDirectory,
    VEDA_MAIL_SETUP_TOKEN: original.setupToken,
    VEDA_MAIL_TRUST_PROXY_HEADERS: original.trustProxy,
  })) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  await rm(temporaryDirectory, { force: true, recursive: true });
});

describe("installation security", () => {
  it("hashes and verifies admin passwords using scrypt", async () => {
    const stored = await hashAdminPassword("correct-password-123");
    expect(stored.algorithm).toBe("scrypt");
    expect(stored.digest).not.toContain("correct-password-123");
    await expect(
      verifyAdminPasswordDigest("correct-password-123", stored),
    ).resolves.toBe(true);
    await expect(
      verifyAdminPasswordDigest("incorrect-password", stored),
    ).resolves.toBe(false);
  });

  it("normalizes usernames and timing-safely checks the setup token", () => {
    expect(adminUsernameSchema.parse("  Main.Admin ")).toBe("main.admin");
    expect(
      setupInputSchema.parse({
        accentColor: "#ff6b57",
        adminPassword: "correct-password-123",
        adminUsername: "owner",
        organizationName: "Example Org",
        primaryColor: "#27276f",
        productName: "Example Mail",
        publicRepositoryUrl: "",
        setupToken: "one-time-token-1234567890",
      }).publicRepositoryUrl,
    ).toBeNull();
    expect(() => assertSetupToken("one-time-token-1234567890")).not.toThrow();
    expect(() => assertSetupToken("wrong-token")).toThrow("incorrect");
  });

  it("binds sessions to authVersion and invalidates them on account change", async () => {
    const installation = await install();
    expect(installation.owner.twoFactor).toBeNull();
    const token = await issueAdminToken(installation);
    await expect(verifyAdminToken(token)).resolves.toBe(true);
    await expect(
      verifyAdminCredentials(
        "owner",
        "correct-password-123",
        installation,
      ),
    ).resolves.toBe(true);

    const password = await hashAdminPassword("new-password-123");
    await installationStore.updateOwner(1, {
      password,
      twoFactor: null,
      username: "new-owner",
    });
    await expect(verifyAdminToken(token)).resolves.toBe(false);
  });

  it("revokes a valid administrator token server-side", async () => {
    const installation = await install();
    const token = await issueAdminToken(installation);

    await expect(revokeAdminToken(token)).resolves.toBe(true);
    await expect(verifyAdminToken(token)).resolves.toBe(false);
  });

  it("loads installation records created before administrator 2FA", async () => {
    const installation = await install();
    const legacy = structuredClone(installation) as unknown as {
      owner: { twoFactor?: unknown };
    };
    delete legacy.owner.twoFactor;
    const migrated = installationRecordSchema.parse(legacy);

    expect(migrated.owner.twoFactor).toBeNull();
  });

  it("rejects cross-origin mutations", () => {
    const request = new Request("https://mail.example.com/api/v1/setup", {
      headers: {
        host: "mail.example.com",
        origin: "https://evil.example",
      },
      method: "POST",
    });
    expect(() => assertSameOrigin(request)).toThrow("Cross-origin");
  });

  it("compares the origin protocol and trusted forwarded origin", () => {
    const downgrade = new Request("https://mail.example.com/api/v1/setup", {
      headers: { host: "mail.example.com", origin: "http://mail.example.com" },
      method: "POST",
    });
    expect(() => assertSameOrigin(downgrade)).toThrow("Cross-origin");

    process.env["VEDA_MAIL_TRUST_PROXY_HEADERS"] = "true";
    const proxied = new Request("http://127.0.0.1:3000/api/v1/setup", {
      headers: {
        "x-forwarded-host": "mail.example.com",
        "x-forwarded-proto": "https",
        origin: "https://mail.example.com",
      },
      method: "POST",
    });
    expect(() => assertSameOrigin(proxied)).not.toThrow();
  });

  it("fails closed when both browser origin signals are absent", () => {
    const ambiguous = new Request(
      "https://mail.example.com/api/v1/admin/auth",
      { method: "POST" },
    );
    const sameOriginNavigation = new Request(
      "https://mail.example.com/api/v1/admin/auth",
      { headers: { "sec-fetch-site": "none" }, method: "POST" },
    );

    expect(() => assertSameOrigin(ambiguous)).toThrow("same-origin");
    expect(() => assertSameOrigin(sameOriginNavigation)).not.toThrow();
  });
});
