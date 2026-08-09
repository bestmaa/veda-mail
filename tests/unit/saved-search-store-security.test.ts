import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SavedSearchOwner } from "@/domain/mail/saved-search";
import { id } from "@/domain/shared/brand";
import type { InstallationDraft } from "@/server/installation/installation.store";
import { installationStore } from "@/server/installation/installation.store";
import { hashAdminPassword } from "@/server/installation/password-hash";
import { savedSearchOwnerKey } from "@/server/saved-searches/saved-search-crypto";
import { savedSearchFilePath } from "@/server/saved-searches/saved-search-file";
import { savedSearchFileSchema } from "@/server/saved-searches/saved-search-record";
import { savedSearchStore } from "@/server/saved-searches/saved-search-store";

const originalDirectory = process.env["VEDA_MAIL_DATA_DIR"];
let temporaryDirectory = "";
const owner: SavedSearchOwner = { email: "member@example.com", providerId: "mock" };
const installationDraft = async (): Promise<InstallationDraft> => ({
  mailProfile: { allowedDomains: ["example.com"], config: {}, displayName: "Test mail", providerId: id.provider("mock") },
  organization: { accentColor: "#ff6b57", logoFileName: null, organizationName: "Example",
    primaryColor: "#27276f", productName: "Mail", publicRepositoryUrl: null },
  owner: { password: await hashAdminPassword("strong-password-123"), username: "owner" },
});
beforeEach(async () => {
  temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "veda-saved-searches-"));
  process.env["VEDA_MAIL_DATA_DIR"] = temporaryDirectory;
  await installationStore.complete(installationDraft);
});
afterEach(async () => {
  if (originalDirectory === undefined) delete process.env["VEDA_MAIL_DATA_DIR"];
  else process.env["VEDA_MAIL_DATA_DIR"] = originalDirectory;
  await rm(temporaryDirectory, { force: true, recursive: true });
});
const create = () => savedSearchStore.put(owner, { expectedRevision: null,
  name: "Private search", operation: "create", query: "from:private@example.com" });

describe("saved search store security", () => {
  it("encrypts queries and isolates provider/account owners", async () => {
    const book = await create();
    const raw = await readFile(savedSearchFilePath(), "utf8");
    expect(raw).not.toMatch(/Private search|private@example\.com/u);
    await expect(savedSearchStore.get({ email: "member@EXAMPLE.COM", providerId: "MOCK" }))
      .resolves.toMatchObject({ revision: book.revision });
    await expect(savedSearchStore.get({ email: "Member@example.com", providerId: "mock" }))
      .resolves.toMatchObject({ revision: null, searches: [] });
  });

  it("enforces CAS and fails closed when authenticated ciphertext is tampered", async () => {
    await create();
    await expect(savedSearchStore.put(owner, { expectedRevision: null, name: "Stale",
      operation: "create", query: "is:starred" })).rejects.toMatchObject({
      code: "SAVED_SEARCH_BOOK_CONFLICT", status: 409,
    });
    const installation = await installationStore.get();
    if (!installation) throw new Error("Installation missing.");
    const ownerKey = savedSearchOwnerKey(owner, installation.sessionSecret);
    const file = savedSearchFileSchema.parse(JSON.parse(await readFile(savedSearchFilePath(), "utf8")));
    const encrypted = file.owners[ownerKey]!;
    const tag = `${encrypted.tag[0] === "A" ? "B" : "A"}${encrypted.tag.slice(1)}`;
    await writeFile(savedSearchFilePath(), JSON.stringify({ ...file,
      owners: { ...file.owners, [ownerKey]: { ...encrypted, tag } } }), { mode: 0o600 });
    await expect(savedSearchStore.get(owner)).rejects.toMatchObject({
      code: "SAVED_SEARCH_STORE_UNAVAILABLE", status: 500,
    });
  });
});
