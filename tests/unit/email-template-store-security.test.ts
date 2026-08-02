import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { EmailTemplateOwner } from "@/domain/member/email-template";
import { id } from "@/domain/shared/brand";
import type { InstallationDraft } from "@/server/installation/installation.store";
import { installationStore } from "@/server/installation/installation.store";
import { hashAdminPassword } from "@/server/installation/password-hash";
import {
  emailTemplateOwnerKey,
  encryptEmailTemplateBook,
} from "@/server/templates/email-template-crypto";
import { emailTemplateFilePath } from "@/server/templates/email-template-file";
import {
  emailTemplateFileSchema,
  type StoredEmailTemplateBook,
} from "@/server/templates/email-template-record";
import { emailTemplateStore } from "@/server/templates/email-template.store";

const originalDirectory = process.env["VEDA_MAIL_DATA_DIR"];
let temporaryDirectory = "";
const owner: EmailTemplateOwner = {
  email: "member@example.com",
  providerId: "mock",
};

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

const create = () =>
  emailTemplateStore.put(owner, {
    content: {
      htmlBody: "<p><strong>Hello</strong></p>",
      mode: "rich",
      subject: "Welcome",
    },
    expectedRevision: null,
    name: "Welcome note",
    operation: "create",
  });

beforeEach(async () => {
  temporaryDirectory = await mkdtemp(
    path.join(os.tmpdir(), "veda-template-security-"),
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

const storedFile = async () =>
  emailTemplateFileSchema.parse(
    JSON.parse(await readFile(emailTemplateFilePath(), "utf8")),
  );

describe("email template store security", () => {
  it("normalizes provider/domain casing but preserves local-part identity", async () => {
    const book = await create();
    const installation = await installationStore.get();
    if (!installation) throw new Error("Installation missing.");
    const secret = installation.sessionSecret;

    expect(
      emailTemplateOwnerKey(
        { email: "member@EXAMPLE.COM", providerId: "MOCK" },
        secret,
      ),
    ).toBe(emailTemplateOwnerKey(owner, secret));
    expect(
      emailTemplateOwnerKey(
        { email: "Member@example.com", providerId: "mock" },
        secret,
      ),
    ).not.toBe(emailTemplateOwnerKey(owner, secret));
    await expect(
      emailTemplateStore.get({
        email: "Member@example.com",
        providerId: "mock",
      }),
    ).resolves.toMatchObject({ revision: null, templates: [] });
    await expect(emailTemplateStore.get(owner)).resolves.toMatchObject({
      revision: book.revision,
      templates: [{ name: "Welcome note" }],
    });
  });

  it("fails closed when an encrypted authentication tag is tampered", async () => {
    await create();
    const installation = await installationStore.get();
    if (!installation) throw new Error("Installation missing.");
    const ownerKey = emailTemplateOwnerKey(owner, installation.sessionSecret);
    const stored = await storedFile();
    const encrypted = stored.owners[ownerKey]!;
    const tag = `${encrypted.tag[0] === "A" ? "B" : "A"}${encrypted.tag.slice(1)}`;
    await writeFile(
      emailTemplateFilePath(),
      JSON.stringify({
        ...stored,
        owners: { ...stored.owners, [ownerKey]: { ...encrypted, tag } },
      }),
      { mode: 0o600 },
    );

    await expect(emailTemplateStore.get(owner)).rejects.toMatchObject({
      code: "TEMPLATE_STORE_UNAVAILABLE",
      status: 500,
    });
  });

  it("rejects validly encrypted noncanonical template content", async () => {
    const book = await create();
    const installation = await installationStore.get();
    if (!installation) throw new Error("Installation missing.");
    const secret = installation.sessionSecret;
    const ownerKey = emailTemplateOwnerKey(owner, secret);
    const noncanonical = {
      ...book,
      templates: [{ ...book.templates[0]!, body: "Divergent plain text" }],
    } as StoredEmailTemplateBook;
    await writeFile(
      emailTemplateFilePath(),
      JSON.stringify({
        owners: {
          [ownerKey]: encryptEmailTemplateBook(noncanonical, ownerKey, secret),
        },
        updatedAt: book.updatedAt,
        version: 1,
      }),
      { mode: 0o600 },
    );

    await expect(emailTemplateStore.get(owner)).rejects.toMatchObject({
      code: "TEMPLATE_STORE_UNAVAILABLE",
      status: 500,
    });
  });

  it.each([
    ["name", " Welcome note "],
    ["subject", " Welcome "],
  ] as const)(
    "rejects validly encrypted noncanonical %s whitespace",
    async (field, value) => {
      const book = await create();
      const installation = await installationStore.get();
      if (!installation) throw new Error("Installation missing.");
      const secret = installation.sessionSecret;
      const ownerKey = emailTemplateOwnerKey(owner, secret);
      const noncanonical = {
        ...book,
        templates: [{ ...book.templates[0]!, [field]: value }],
      } as StoredEmailTemplateBook;
      await writeFile(
        emailTemplateFilePath(),
        JSON.stringify({
          owners: {
            [ownerKey]: encryptEmailTemplateBook(
              noncanonical,
              ownerKey,
              secret,
            ),
          },
          updatedAt: book.updatedAt,
          version: 1,
        }),
        { mode: 0o600 },
      );

      await expect(emailTemplateStore.get(owner)).rejects.toMatchObject({
        code: "TEMPLATE_STORE_UNAVAILABLE",
        status: 500,
      });
    },
  );

  it("binds ciphertext to its owner bucket with authenticated data", async () => {
    await create();
    const installation = await installationStore.get();
    if (!installation) throw new Error("Installation missing.");
    const otherOwner = { email: "other@example.com", providerId: "mock" };
    const otherKey = emailTemplateOwnerKey(otherOwner, installation.sessionSecret);
    const stored = await storedFile();
    const ownerKey = emailTemplateOwnerKey(owner, installation.sessionSecret);
    await writeFile(
      emailTemplateFilePath(),
      JSON.stringify({
        ...stored,
        owners: { [otherKey]: stored.owners[ownerKey] },
      }),
      { mode: 0o600 },
    );

    await expect(emailTemplateStore.get(otherOwner)).rejects.toMatchObject({
      code: "TEMPLATE_STORE_UNAVAILABLE",
      status: 500,
    });
  });
});
