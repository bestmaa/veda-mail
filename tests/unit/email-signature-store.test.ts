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

import {
  type EmailSignatureOwner,
  MAX_EMAIL_SIGNATURES,
} from "@/domain/member/email-signature";
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
  type StoredEmailSignatureBook,
} from "@/server/signatures/email-signature-record";
import { emailSignatureStore } from "@/server/signatures/email-signature.store";

const originalDirectory = process.env["VEDA_MAIL_DATA_DIR"];
let temporaryDirectory = "";

const owner: EmailSignatureOwner = {
  email: "Member@Example.com",
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

const create = (
  expectedRevision: string | null,
  name: string,
  currentOwner = owner,
) =>
  emailSignatureStore.put(currentOwner, {
    content: { htmlBody: "<p><b>Regards</b></p>", mode: "rich" },
    expectedRevision,
    name,
    operation: "create",
  });

beforeEach(async () => {
  temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "veda-signatures-"));
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

describe("encrypted email signature store", () => {
  it("persists an isolated encrypted lifecycle and clears deleted defaults", async () => {
    let book = await create(null, "Work");
    const signatureId = book.signatures[0]!.id;
    const other = await emailSignatureStore.get({
      email: "other@example.com",
      providerId: "mock",
    });
    const file = emailSignatureFilePath();
    const [contents, fileStats] = await Promise.all([
      readFile(file, "utf8"),
      stat(file),
    ]);

    expect(other.signatures).toEqual([]);
    expect(fileStats.mode & 0o777).toBe(0o600);
    expect(contents).not.toMatch(/(?:Member@Example\.com|Regards|Work)/u);
    book = await emailSignatureStore.put(owner, {
      expectedRevision: book.revision,
      newMessageId: signatureId,
      operation: "set-defaults",
      replyForwardId: signatureId,
    });
    book = await emailSignatureStore.put(owner, {
      content: { body: "Plain regards", mode: "plain" },
      expectedRevision: book.revision,
      name: "Work",
      operation: "update",
      signatureId,
    });
    expect(book.signatures[0]).not.toHaveProperty("htmlBody");
    book = await emailSignatureStore.put(owner, {
      expectedRevision: book.revision,
      operation: "delete",
      signatureId,
    });
    expect(book.signatures).toEqual([]);
    expect(book.defaults).toEqual({
      newMessageId: null,
      replyForwardId: null,
    });
  });

  it("rejects duplicate names and permits only one stale-revision writer", async () => {
    let book = await create(null, "Work");
    await expect(create(book.revision, "work")).rejects.toMatchObject({
      code: "SIGNATURE_NAME_CONFLICT",
      status: 422,
    });
    book = await create(book.revision, "Personal");
    await expect(
      emailSignatureStore.put(owner, {
        content: { body: "Duplicate", mode: "plain" },
        expectedRevision: book.revision,
        name: "WORK",
        operation: "update",
        signatureId: book.signatures[1]!.id,
      }),
    ).rejects.toMatchObject({
      code: "SIGNATURE_NAME_CONFLICT",
      status: 422,
    });
    const expectedRevision = book.revision;
    const signatureId = book.signatures[0]!.id;
    const attempts = await Promise.allSettled([
      emailSignatureStore.put(owner, {
        content: { body: "First", mode: "plain" },
        expectedRevision,
        name: "First",
        operation: "update",
        signatureId,
      }),
      emailSignatureStore.put(owner, {
        content: { body: "Second", mode: "plain" },
        expectedRevision,
        name: "Second",
        operation: "update",
        signatureId,
      }),
    ]);

    expect(attempts.filter(({ status }) => status === "fulfilled")).toHaveLength(
      1,
    );
    expect(attempts.filter(({ status }) => status === "rejected")).toHaveLength(
      1,
    );
    expect(
      attempts.find(({ status }) => status === "rejected"),
    ).toMatchObject({ reason: { code: "SIGNATURE_BOOK_CONFLICT", status: 409 } });
  });

  it("enforces the per-identity signature capacity", async () => {
    let revision: string | null = null;
    for (let index = 0; index < MAX_EMAIL_SIGNATURES; index += 1) {
      revision = (await create(revision, `Signature ${index}`)).revision;
    }
    await expect(create(revision, "Overflow")).rejects.toMatchObject({
      code: "SIGNATURE_LIMIT_REACHED",
      status: 422,
    });
  });

  it("maps validly encrypted noncanonical data to a safe internal failure", async () => {
    const book = await create(null, "Work");
    const installation = await installationStore.get();
    if (!installation) throw new Error("Installation missing.");
    const ownerKey = emailSignatureOwnerKey(owner, installation.sessionSecret);
    const noncanonical = {
      ...book,
      signatures: [{ ...book.signatures[0]!, body: "Divergent" }],
    } as StoredEmailSignatureBook;
    await writeFile(
      emailSignatureFilePath(),
      JSON.stringify({
        owners: {
          [ownerKey]: encryptEmailSignatureBook(
            noncanonical,
            ownerKey,
            installation.sessionSecret,
          ),
        },
        updatedAt: book.updatedAt,
        version: 1,
      }),
      { mode: 0o600 },
    );

    await expect(emailSignatureStore.get(owner)).rejects.toMatchObject({
      code: "SIGNATURE_STORE_UNAVAILABLE",
      message: "Email signatures are temporarily unavailable.",
      status: 500,
    });
  });

  it("fails closed when an encrypted authentication tag is tampered", async () => {
    await create(null, "Work");
    const installation = await installationStore.get();
    if (!installation) throw new Error("Installation missing.");
    const ownerKey = emailSignatureOwnerKey(owner, installation.sessionSecret);
    const file = emailSignatureFilePath();
    const stored = emailSignatureFileSchema.parse(
      JSON.parse(await readFile(file, "utf8")),
    );
    const encrypted = stored.owners[ownerKey]!;
    const tag = `${encrypted.tag[0] === "A" ? "B" : "A"}${encrypted.tag.slice(1)}`;
    await writeFile(
      file,
      JSON.stringify({
        ...stored,
        owners: { ...stored.owners, [ownerKey]: { ...encrypted, tag } },
      }),
      { mode: 0o600 },
    );

    await expect(emailSignatureStore.get(owner)).rejects.toMatchObject({
      code: "SIGNATURE_STORE_UNAVAILABLE",
      status: 500,
    });
  });
});
