import { createHmac } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { EmailSignatureOwner } from "@/domain/member/email-signature";
import { id } from "@/domain/shared/brand";
import type { InstallationDraft } from "@/server/installation/installation.store";
import { installationStore } from "@/server/installation/installation.store";
import { hashAdminPassword } from "@/server/installation/password-hash";
import {
  emailSignatureOwnerKey,
  encryptEmailSignatureBook,
} from "@/server/signatures/email-signature-crypto";
import { emailSignatureFilePath } from "@/server/signatures/email-signature-file";
import {
  emailSignatureFileSchema,
  parseStoredEmailSignatureBook,
} from "@/server/signatures/email-signature-record";
import { emailSignatureStore } from "@/server/signatures/email-signature.store";

const originalDirectory = process.env["VEDA_MAIL_DATA_DIR"];
let temporaryDirectory = "";
const owner: EmailSignatureOwner = {
  email: "member@example.com",
  providerId: "mock",
};
const uppercaseOwner: EmailSignatureOwner = {
  ...owner,
  email: "Member@example.com",
};

const legacyOwnerKey = (
  signatureOwner: EmailSignatureOwner,
  secret: string,
): string =>
  createHmac("sha256", secret)
    .update("veda-mail/member-signatures/owner/v1")
    .update("\0")
    .update(
      `${signatureOwner.providerId.trim().toLowerCase()}\0${signatureOwner.email
        .trim()
        .toLowerCase()}`,
    )
    .digest("base64url");

const installationDraft = async (): Promise<InstallationDraft> => ({
  mailProfile: {
    allowedDomains: ["example.com"],
    config: {},
    displayName: "Test mail",
    providerId: id.provider("mock"),
  },
  organization: {
    accentColor: "#ff6b57",
    logoFileName: null,
    organizationName: "Example",
    primaryColor: "#27276f",
    productName: "Mail",
    publicRepositoryUrl: null,
  },
  owner: {
    password: await hashAdminPassword("strong-password-123"),
    username: "owner",
  },
});

beforeEach(async () => {
  temporaryDirectory = await mkdtemp(
    path.join(os.tmpdir(), "veda-signature-owner-"),
  );
  process.env["VEDA_MAIL_DATA_DIR"] = temporaryDirectory;
  await installationStore.complete(installationDraft);
});

afterEach(async () => {
  if (originalDirectory === undefined) {
    delete process.env["VEDA_MAIL_DATA_DIR"];
  } else {
    process.env["VEDA_MAIL_DATA_DIR"] = originalDirectory;
  }
  await rm(temporaryDirectory, { force: true, recursive: true });
});

describe("email signature owner isolation", () => {
  it("preserves local-part case while normalizing provider and domain case", async () => {
    const lowerBook = await emailSignatureStore.put(owner, {
      content: { body: "Lower signature", mode: "plain" },
      expectedRevision: null,
      name: "Lower",
      operation: "create",
    });
    const installation = await installationStore.get();
    if (!installation) throw new Error("Installation missing.");
    const secret = installation.sessionSecret;
    const ownerKey = emailSignatureOwnerKey(owner, secret);
    expect(
      emailSignatureOwnerKey(
        {
          ...owner,
          email: "member@EXAMPLE.COM",
          providerId: "MOCK",
        },
        secret,
      ),
    ).toBe(ownerKey);
    expect(emailSignatureOwnerKey(uppercaseOwner, secret)).not.toBe(ownerKey);
    await expect(emailSignatureStore.get(uppercaseOwner)).resolves.toMatchObject(
      { signatures: [] },
    );

    await emailSignatureStore.put(uppercaseOwner, {
      content: { body: "Upper signature", mode: "plain" },
      expectedRevision: null,
      name: "Upper",
      operation: "create",
    });
    await expect(emailSignatureStore.get(owner)).resolves.toMatchObject({
      revision: lowerBook.revision,
      signatures: [{ name: "Lower" }],
    });
    await expect(emailSignatureStore.get(uppercaseOwner)).resolves.toMatchObject(
      { signatures: [{ name: "Upper" }] },
    );
  });

  it("ignores a synthetic case-collapsed v1 bucket without adopting it", async () => {
    const legacyBook = parseStoredEmailSignatureBook(
      await emailSignatureStore.put(owner, {
        content: { body: "Legacy signature", mode: "plain" },
        expectedRevision: null,
        name: "Legacy",
        operation: "create",
      }),
    );
    const installation = await installationStore.get();
    if (!installation) throw new Error("Installation missing.");
    const secret = installation.sessionSecret;
    const legacyKey = legacyOwnerKey(owner, secret);
    await writeFile(
      emailSignatureFilePath(),
      JSON.stringify({
        owners: {
          [legacyKey]: encryptEmailSignatureBook(
            legacyBook,
            legacyKey,
            secret,
          ),
        },
        updatedAt: legacyBook.updatedAt,
        version: 1,
      }),
      { mode: 0o600 },
    );

    await expect(emailSignatureStore.get(owner)).resolves.toMatchObject({
      revision: null,
      signatures: [],
    });
    await expect(emailSignatureStore.get(uppercaseOwner)).resolves.toMatchObject(
      {
        revision: null,
        signatures: [],
      },
    );
    const created = await emailSignatureStore.put(owner, {
      content: { body: "New signature", mode: "plain" },
      expectedRevision: null,
      name: "New",
      operation: "create",
    });
    const stored = emailSignatureFileSchema.parse(
      JSON.parse(await readFile(emailSignatureFilePath(), "utf8")),
    );
    expect(
      stored.owners[emailSignatureOwnerKey(owner, secret)],
    ).toBeDefined();
    expect(stored.owners[legacyKey]).toBeDefined();
    expect(created.signatures).toMatchObject([{ name: "New" }]);
  });
});
