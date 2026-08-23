import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { mailForwardingStore } from "@/server/mail-forwarding/mail-forwarding.store";

const originalDirectory = process.env["VEDA_MAIL_DATA_DIR"];
const originalKey = process.env["VEDA_MAIL_JOB_KEY"];
let directory = "";

beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "veda-forwarding-"));
  process.env["VEDA_MAIL_DATA_DIR"] = directory;
  process.env["VEDA_MAIL_JOB_KEY"] = Buffer.alloc(32, 7).toString("base64");
});
afterEach(async () => {
  if (originalDirectory === undefined) delete process.env["VEDA_MAIL_DATA_DIR"];
  else process.env["VEDA_MAIL_DATA_DIR"] = originalDirectory;
  if (originalKey === undefined) delete process.env["VEDA_MAIL_JOB_KEY"];
  else process.env["VEDA_MAIL_JOB_KEY"] = originalKey;
  await rm(directory, { force: true, recursive: true });
});

describe("mail forwarding store", () => {
  it("encrypts forwarding addresses in a mode-0600 durable record", async () => {
    const ledger = {
      entries: [{
        destinationEmail: "private@gmail.com", keepLocalCopy: true as const,
        sourceAddresses: ["member@example.com"],
        sourceEmail: "member@example.com", status: "active" as const,
        updatedAt: "2026-08-23T00:00:00.000Z",
      }],
      revision: 1, updatedAt: "2026-08-23T00:00:00.000Z", version: 1 as const,
    };
    await expect(mailForwardingStore.put(0, ledger)).resolves.toBe(true);
    const file = path.join(directory, "mail-forwarding.enc.json");
    const [serialized, metadata] = await Promise.all([readFile(file, "utf8"), stat(file)]);
    expect(serialized).not.toContain("private@gmail.com");
    expect(serialized).not.toContain("member@example.com");
    expect(metadata.mode & 0o777).toBe(0o600);
    await expect(mailForwardingStore.get()).resolves.toEqual(ledger);
  });

  it("rejects stale revisions", async () => {
    const ledger = {
      entries: [], revision: 1,
      updatedAt: "2026-08-23T00:00:00.000Z", version: 1 as const,
    };
    await expect(mailForwardingStore.put(0, ledger)).resolves.toBe(true);
    await expect(mailForwardingStore.put(0, { ...ledger, revision: 2 })).resolves.toBe(false);
  });
});
