import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { LabelOwner } from "@/domain/mail/label";
import { id } from "@/domain/shared/brand";
import type { InstallationDraft } from "@/server/installation/installation.store";
import { installationStore } from "@/server/installation/installation.store";
import { hashAdminPassword } from "@/server/installation/password-hash";
import { labelCatalogFilePath } from "@/server/labels/label-catalog-file";
import { labelCatalogStore } from "@/server/labels/label-catalog.store";

const originalDirectory = process.env["VEDA_MAIL_DATA_DIR"];
let directory = "";
const owner: LabelOwner = {
  email: "Member@Example.com",
  providerId: id.provider("mock"),
};
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
  directory = await mkdtemp(path.join(os.tmpdir(), "veda-label-catalog-"));
  process.env["VEDA_MAIL_DATA_DIR"] = directory;
  await installationStore.complete(installation);
});
afterEach(async () => {
  if (originalDirectory === undefined) delete process.env["VEDA_MAIL_DATA_DIR"];
  else process.env["VEDA_MAIL_DATA_DIR"] = originalDirectory;
  await rm(directory, { force: true, recursive: true });
});

describe("encrypted label catalog", () => {
  it("creates, updates, isolates, and encrypts account label metadata", async () => {
    const created = await labelCatalogStore.create(owner, {
      color: "#4f46e5", name: "Customers",
    });
    const label = created[0]!;
    expect(label.id).toMatch(/^veda-label-[a-z2-7]{26}$/u);
    expect(await labelCatalogStore.update(owner, label.id, {
      color: "#10b981", name: "Priority customers",
    })).toMatchObject([{ color: "#10b981", name: "Priority customers" }]);
    expect(await labelCatalogStore.list({
      email: "other@example.com", providerId: owner.providerId,
    })).toEqual([]);

    const file = labelCatalogFilePath();
    const [contents, fileStats] = await Promise.all([readFile(file, "utf8"), stat(file)]);
    expect(fileStats.mode & 0o777).toBe(0o600);
    expect(contents).not.toContain("Member@Example.com");
    expect(contents).not.toContain("Priority customers");
    expect(contents).not.toContain(label.id);
  });

  it("serializes concurrent writers without losing catalog entries", async () => {
    await Promise.all(Array.from({ length: 12 }, (_, index) =>
      labelCatalogStore.create(owner, {
        color: "#64748b",
        name: `Project ${index}`,
      }),
    ));

    const labels = await labelCatalogStore.list(owner);
    expect(labels).toHaveLength(12);
    expect(new Set(labels.map(({ id }) => id)).size).toBe(12);
  });

  it("fails closed when the encrypted catalog is corrupted", async () => {
    await labelCatalogStore.create(owner, {
      color: "#4f46e5", name: "Customers",
    });
    await writeFile(labelCatalogFilePath(), '{"version":1,"owners":"bad"}', "utf8");

    await expect(labelCatalogStore.list(owner)).rejects.toMatchObject({
      code: "LABELS_UNAVAILABLE",
    });
  });
});
