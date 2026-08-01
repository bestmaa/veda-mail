import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { LabelOwner } from "@/domain/mail/label";
import { id } from "@/domain/shared/brand";
import type { InstallationDraft } from "@/server/installation/installation.store";
import { installationStore } from "@/server/installation/installation.store";
import { hashAdminPassword } from "@/server/installation/password-hash";
import { mailboxEmptyOperationStore } from "@/server/mailboxes/mailbox-empty-operation.store";

const originalDirectory = process.env["VEDA_MAIL_DATA_DIR"];
const mailboxId = id.mailbox("trash-a");
const owner: LabelOwner = {
  email: "member@example.com",
  providerId: id.provider("mock"),
};
let directory = "";

const installation = async (): Promise<InstallationDraft> => ({
  mailProfile: {
    allowedDomains: ["example.com"],
    config: {},
    displayName: "Mail",
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
  directory = await mkdtemp(path.join(os.tmpdir(), "veda-mailbox-empty-"));
  process.env["VEDA_MAIL_DATA_DIR"] = directory;
  await installationStore.complete(installation);
});

afterEach(async () => {
  if (originalDirectory === undefined) delete process.env["VEDA_MAIL_DATA_DIR"];
  else process.env["VEDA_MAIL_DATA_DIR"] = originalDirectory;
  await rm(directory, { force: true, recursive: true });
});

describe("mailbox empty operation store", () => {
  it("persists prepare progress and resumes to cumulative completion", async () => {
    const preparedClaim = await mailboxEmptyOperationStore.claim(owner, mailboxId);
    expect(preparedClaim.cursor).toBeNull();
    expect(await mailboxEmptyOperationStore.list(owner)).toEqual([]);
    await expect(
      mailboxEmptyOperationStore.claim(owner, mailboxId),
    ).rejects.toMatchObject({ code: "MAILBOX_EMPTY_BUSY" });

    await mailboxEmptyOperationStore.record(owner, preparedClaim, {
      complete: false,
      cursor: "prepared_cursor",
      processed: 0,
      removed: 0,
    });
    expect(await mailboxEmptyOperationStore.list(owner)).toMatchObject([{
      mailboxId,
      processed: 0,
      removed: 0,
    }]);

    const batchClaim = await mailboxEmptyOperationStore.claim(owner, mailboxId);
    expect(batchClaim.cursor).toBe("prepared_cursor");
    await mailboxEmptyOperationStore.record(owner, batchClaim, {
      complete: false,
      cursor: "next_cursor",
      processed: 100,
      removed: 100,
    });
    const finalClaim = await mailboxEmptyOperationStore.claim(owner, mailboxId);
    const finished = await mailboxEmptyOperationStore.record(owner, finalClaim, {
      complete: true,
      cursor: null,
      processed: 3,
      removed: 3,
    });

    expect(finished).toEqual({ complete: true, processed: 103, removed: 103 });
    expect(await mailboxEmptyOperationStore.list(owner)).toEqual([]);
  });
});
