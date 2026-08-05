import {
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { id } from "@/domain/shared/brand";
import type { InstallationDraft } from "@/server/installation/installation.store";
import { installationStore } from "@/server/installation/installation.store";
import { hashAdminPassword } from "@/server/installation/password-hash";

const originalDirectory = process.env["VEDA_MAIL_DATA_DIR"];
let temporaryDirectory = "";

const draft = async (username: string): Promise<InstallationDraft> => ({
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
    publicRepositoryUrl: "https://github.com/example/mail",
  },
  owner: {
    password: await hashAdminPassword("strong-password-123"),
    username,
  },
});

beforeEach(async () => {
  temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "veda-install-"));
  process.env["VEDA_MAIL_DATA_DIR"] = temporaryDirectory;
});

afterEach(async () => {
  if (originalDirectory === undefined) {
    delete process.env["VEDA_MAIL_DATA_DIR"];
  } else {
    process.env["VEDA_MAIL_DATA_DIR"] = originalDirectory;
  }
  await rm(temporaryDirectory, { force: true, recursive: true });
});

describe("installation store", () => {
  it("persists a versioned mode-0600 record without plaintext password", async () => {
    const created = await installationStore.complete(() => draft("owner"));
    const file = path.join(temporaryDirectory, "installation.json");
    const [contents, fileStats] = await Promise.all([
      readFile(file, "utf8"),
      stat(file),
    ]);

    expect(created.version).toBe(1);
    expect(fileStats.mode & 0o777).toBe(0o600);
    expect(contents).not.toContain("strong-password-123");
    expect(JSON.parse(contents)).toMatchObject({
      owner: {
        authVersion: 1,
        password: { algorithm: "scrypt" },
        username: "owner",
      },
    });
  });

  it("allows only one winner during concurrent first-run setup", async () => {
    const attempts = await Promise.allSettled([
      installationStore.complete(() => draft("first-owner")),
      installationStore.complete(() => draft("second-owner")),
    ]);
    const successes = attempts.filter(({ status }) => status === "fulfilled");
    const failures = attempts.filter(({ status }) => status === "rejected");

    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(1);
    expect(await installationStore.isInstalled()).toBe(true);
  });

  it("never replaces an installation file created before its final commit", async () => {
    const destination = path.join(temporaryDirectory, "installation.json");
    await expect(
      installationStore.complete(async () => {
        await writeFile(destination, "external-winner", {
          flag: "wx",
          mode: 0o600,
        });
        return draft("late-owner");
      }),
    ).rejects.toMatchObject({ code: "SETUP_ALREADY_COMPLETED", status: 409 });
    await expect(readFile(destination, "utf8")).resolves.toBe(
      "external-winner",
    );
  });

  it("serializes branding mutations against the latest committed state", async () => {
    await installationStore.complete(() => draft("owner"));
    let secondSaw = "";
    const first = installationStore.updateBranding(async (current) => ({
      ...current,
      logoFileName: `branding/logo-${"a".repeat(64)}.webp`,
    }));
    const second = installationStore.updateBranding(async (current) => {
      secondSaw = current.logoFileName ?? "";
      return {
        ...current,
        logoFileName: `branding/logo-${"b".repeat(64)}.webp`,
      };
    });
    await Promise.all([first, second]);

    expect(secondSaw).toBe(`branding/logo-${"a".repeat(64)}.webp`);
    await expect(installationStore.get()).resolves.toMatchObject({
      organization: {
        logoFileName: `branding/logo-${"b".repeat(64)}.webp`,
      },
    });
  });

  it("returns only the public branding snapshot", async () => {
    await installationStore.complete(() => draft("owner"));
    const branding = await installationStore.getBranding();

    expect(branding).toEqual({
      accentColor: "#ff6b57",
      logoUrl: null,
      organizationName: "Example Org",
      primaryColor: "#27276f",
      productName: "Example Mail",
      publicRepositoryUrl: "https://github.com/example/mail",
    });
    expect(JSON.stringify(branding)).not.toContain("password");
    expect(JSON.stringify(branding)).not.toContain("sessionSecret");
  });

});
