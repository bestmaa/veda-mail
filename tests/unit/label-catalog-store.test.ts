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
import { labelDeletionCatalogStore } from "@/server/labels/label-deletion-catalog.store";

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

  it("leases resumable deletion, rejects new use, and finalizes after two empty checks", async () => {
    const [label] = await labelCatalogStore.create(owner, {
      color: "#4f46e5", name: "Customers",
    });
    const claim = await labelDeletionCatalogStore.claim(owner, label!.id);

    await expect(labelCatalogStore.requireActive(owner, label!.id)).rejects.toMatchObject({
      failure: "missing",
    });
    expect(await labelCatalogStore.list(owner)).toEqual([label]);
    expect(await labelDeletionCatalogStore.list(owner)).toMatchObject([{
      labelId: label!.id, processed: 0, removed: 0,
    }]);
    await expect(
      labelDeletionCatalogStore.claim(owner, label!.id),
    ).rejects.toMatchObject({ code: "LABEL_DELETION_BUSY" });

    const first = await labelDeletionCatalogStore.record(owner, claim, {
      complete: false,
      cursor: "provider-cursor",
      processed: 100,
      removed: 3,
    });
    expect(first).toMatchObject({ done: false, deletion: { processed: 100, removed: 3 } });

    const secondClaim = await labelDeletionCatalogStore.claim(owner, label!.id);
    expect(secondClaim.cursor).toBe("provider-cursor");
    const firstEmpty = await labelDeletionCatalogStore.record(owner, secondClaim, {
      complete: true, cursor: null, processed: 0, removed: 0,
    });
    expect(firstEmpty.done).toBe(false);

    const verificationClaim = await labelDeletionCatalogStore.claim(owner, label!.id);
    expect(verificationClaim.cursor).toBeNull();
    const continued = await labelDeletionCatalogStore.record(owner, verificationClaim, {
      complete: false, cursor: "verification-cursor", processed: 0, removed: 0,
    });
    expect(continued.done).toBe(false);
    const finalClaim = await labelDeletionCatalogStore.claim(owner, label!.id);
    const finalized = await labelDeletionCatalogStore.record(owner, finalClaim, {
      complete: true, cursor: null, processed: 0, removed: 0,
    });
    expect(finalized.done).toBe(true);
    expect(finalized.labels).toEqual([]);
    expect(await labelCatalogStore.list(owner)).toEqual([]);
    await expect(
      labelDeletionCatalogStore.claim(owner, label!.id),
    ).rejects.toMatchObject({ failure: "missing" });
  });

  it("releases a failed deletion lease and rejects invalid provider progress", async () => {
    const [label] = await labelCatalogStore.create(owner, {
      color: "#4f46e5", name: "Customers",
    });
    const claim = await labelDeletionCatalogStore.claim(owner, label!.id);
    await expect(labelDeletionCatalogStore.record(owner, claim, {
      complete: false, cursor: null, processed: 2, removed: 3,
    })).rejects.toMatchObject({ code: "LABEL_DELETION_INVALID_PROGRESS" });
    await labelDeletionCatalogStore.release(owner, claim);
    await expect(labelDeletionCatalogStore.claim(owner, label!.id)).resolves.toMatchObject({
      cursor: null,
    });
  });

  it("restarts a credential-bound provider cursor without losing counts", async () => {
    const [label] = await labelCatalogStore.create(owner, {
      color: "#4f46e5", name: "Customers",
    });
    const claim = await labelDeletionCatalogStore.claim(owner, label!.id);
    await labelDeletionCatalogStore.record(owner, claim, {
      complete: false, cursor: "signed-cursor", processed: 8, removed: 2,
    });
    const resumed = await labelDeletionCatalogStore.claim(owner, label!.id);
    expect(resumed.cursor).toBe("signed-cursor");
    await labelDeletionCatalogStore.restart(owner, resumed);

    const restarted = await labelDeletionCatalogStore.claim(owner, label!.id);
    expect(restarted.cursor).toBeNull();
    expect(await labelDeletionCatalogStore.list(owner)).toMatchObject([{
      processed: 8, removed: 2,
    }]);
  });

  it("reserves a deleting label name until cleanup finalizes", async () => {
    const [deleting] = await labelCatalogStore.create(owner, {
      color: "#4f46e5", name: "Customers",
    });
    await labelDeletionCatalogStore.claim(owner, deleting!.id);
    const labels = await labelCatalogStore.create(owner, {
      color: "#64748b", name: "Prospects",
    });
    const prospects = labels.find(({ name }) => name === "Prospects")!;

    await expect(labelCatalogStore.update(owner, prospects.id, {
      name: "customers",
    })).rejects.toMatchObject({ failure: "conflict" });
  });
});
