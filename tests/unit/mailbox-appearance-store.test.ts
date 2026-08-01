import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { Mailbox, MailboxAppearanceOwner } from "@/domain/mail/mailbox";
import { id } from "@/domain/shared/brand";
import type { InstallationDraft } from "@/server/installation/installation.store";
import { installationStore } from "@/server/installation/installation.store";
import { hashAdminPassword } from "@/server/installation/password-hash";
import { mailboxAppearanceFilePath } from "@/server/mailboxes/mailbox-appearance-file";
import { mailboxAppearanceStore } from "@/server/mailboxes/mailbox-appearance.store";

const originalDirectory = process.env["VEDA_MAIL_DATA_DIR"];
let directory = "";
const owner: MailboxAppearanceOwner = {
  email: "Member@Example.com",
  providerId: id.provider("mock"),
};
const mailbox = (value: string): Mailbox => ({
  color: "#64748b",
  id: id.mailbox(value),
  name: value,
  parentId: null,
  rights: { mayCreateChild: true, mayDelete: true, mayRename: true },
  role: "custom",
  sortOrder: 0,
  total: 0,
  unread: 0,
});
const installation = async (): Promise<InstallationDraft> => ({
  mailProfile: {
    allowedDomains: ["example.com"], config: {}, displayName: "Mail",
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
  directory = await mkdtemp(path.join(os.tmpdir(), "veda-mailbox-colors-"));
  process.env["VEDA_MAIL_DATA_DIR"] = directory;
  await installationStore.complete(installation);
});

afterEach(async () => {
  if (originalDirectory === undefined) delete process.env["VEDA_MAIL_DATA_DIR"];
  else process.env["VEDA_MAIL_DATA_DIR"] = originalDirectory;
  await rm(directory, { force: true, recursive: true });
});

describe("encrypted mailbox appearance store", () => {
  it("isolates, encrypts, migrates, and removes account-scoped colors", async () => {
    const oldMailbox = mailbox("old-private-id");
    const newMailbox = mailbox("new-private-id");
    await mailboxAppearanceStore.set(owner, oldMailbox.id, "#a855f7");
    expect(await mailboxAppearanceStore.decorate(owner, [oldMailbox])).toMatchObject([
      { color: "#a855f7", id: oldMailbox.id },
    ]);
    expect(await mailboxAppearanceStore.decorate({
      email: "other@example.com", providerId: owner.providerId,
    }, [oldMailbox])).toMatchObject([{ color: "#64748b" }]);
    await mailboxAppearanceStore.set(owner, newMailbox.id, undefined, oldMailbox.id);
    expect(await mailboxAppearanceStore.decorate(owner, [newMailbox])).toMatchObject([
      { color: "#a855f7", id: newMailbox.id },
    ]);
    const file = mailboxAppearanceFilePath();
    const [contents, fileStats] = await Promise.all([readFile(file, "utf8"), stat(file)]);
    expect(fileStats.mode & 0o777).toBe(0o600);
    expect(contents).not.toContain("Member@Example.com");
    expect(contents).not.toContain("new-private-id");
    await mailboxAppearanceStore.remove(owner, newMailbox.id);
    expect(await mailboxAppearanceStore.decorate(owner, [newMailbox])).toMatchObject([
      { color: "#64748b" },
    ]);
  });
});
