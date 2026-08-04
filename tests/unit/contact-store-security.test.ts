import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { ContactOwner } from "@/domain/member/contact";
import { id } from "@/domain/shared/brand";
import {
  contactOwnerKey,
} from "@/server/contacts/contact-crypto";
import { contactFilePath } from "@/server/contacts/contact-file";
import { contactFileSchema } from "@/server/contacts/contact-record";
import { contactStore } from "@/server/contacts/contact-store";
import type { InstallationDraft } from "@/server/installation/installation.store";
import { installationStore } from "@/server/installation/installation.store";
import { hashAdminPassword } from "@/server/installation/password-hash";

const originalDirectory = process.env["VEDA_MAIL_DATA_DIR"];
let temporaryDirectory = "";
const owner: ContactOwner = { email: "member@example.com", providerId: "mock" };

const installationDraft = async (): Promise<InstallationDraft> => ({
  mailProfile: {
    allowedDomains: ["example.com"], config: {}, displayName: "Test mail",
    providerId: id.provider("mock"),
  },
  organization: {
    accentColor: "#ff6b57", logoFileName: null, organizationName: "Example",
    primaryColor: "#27276f", productName: "Mail", publicRepositoryUrl: null,
  },
  owner: {
    password: await hashAdminPassword("strong-password-123"), username: "owner",
  },
});

beforeEach(async () => {
  temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "veda-contacts-"));
  process.env["VEDA_MAIL_DATA_DIR"] = temporaryDirectory;
  await installationStore.complete(installationDraft);
});

afterEach(async () => {
  if (originalDirectory === undefined) delete process.env["VEDA_MAIL_DATA_DIR"];
  else process.env["VEDA_MAIL_DATA_DIR"] = originalDirectory;
  await rm(temporaryDirectory, { force: true, recursive: true });
});

const create = () => contactStore.put(owner, {
  contact: {
    emails: [{ email: "private@example.com", label: "Work" }],
    name: "Private person",
  },
  expectedRevision: null,
  operation: "create-contact",
});

describe("contact store security", () => {
  it("encrypts owner data and isolates provider/local-part identities", async () => {
    const book = await create();
    const raw = await readFile(contactFilePath(), "utf8");
    expect(raw).not.toMatch(/private@example\.com|Private person/u);
    await expect(contactStore.get({
      email: "member@EXAMPLE.COM", providerId: "MOCK",
    })).resolves.toMatchObject({ revision: book.revision });
    await expect(contactStore.get({
      email: "Member@example.com", providerId: "mock",
    })).resolves.toMatchObject({ contacts: [], revision: null });
  });

  it("enforces optimistic revision and fails closed on tag tampering", async () => {
    await create();
    await expect(contactStore.put(owner, {
      contact: {
        emails: [{ email: "other@example.com", label: null }], name: "Other",
      },
      expectedRevision: null,
      operation: "create-contact",
    })).rejects.toMatchObject({ code: "CONTACT_BOOK_CONFLICT", status: 409 });

    const installation = await installationStore.get();
    if (!installation) throw new Error("Installation missing.");
    const key = contactOwnerKey(owner, installation.sessionSecret);
    const file = contactFileSchema.parse(
      JSON.parse(await readFile(contactFilePath(), "utf8")),
    );
    const encrypted = file.owners[key]!;
    const tag = `${encrypted.tag[0] === "A" ? "B" : "A"}${encrypted.tag.slice(1)}`;
    await writeFile(contactFilePath(), JSON.stringify({
      ...file,
      owners: { ...file.owners, [key]: { ...encrypted, tag } },
    }), { mode: 0o600 });
    await expect(contactStore.get(owner)).rejects.toMatchObject({
      code: "CONTACT_STORE_UNAVAILABLE",
      status: 500,
    });
  });
});
