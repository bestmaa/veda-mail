import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  removeAttachmentOrphanDirectories,
  scheduleAttachmentExpirySweep,
} from "@/server/mail/attachment-service";
import {
  attachmentScope,
  body,
  quarantineFixture,
  reserveText,
} from "./attachment-quarantine.fixture";

let directory = "";

beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "veda-attachment-service-"));
});

afterEach(async () => {
  await rm(directory, { force: true, recursive: true });
});

const waitFor = async (condition: () => Promise<boolean>) => {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (await condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Timed out waiting for attachment cleanup.");
};

describe("attachment service lifecycle", () => {
  it("reaps expired encrypted attachments without another user request", async () => {
    let now = 1_000;
    const quarantine = quarantineFixture(directory, {
      now: () => now,
      ttlMs: 25,
    });
    const reserved = await reserveText(quarantine, 1);
    await quarantine.upload(reserved.id, attachmentScope, body("x"), 1);
    now += 25;
    const timer = scheduleAttachmentExpirySweep(quarantine, 10);
    try {
      await waitFor(async () => (await readdir(directory)).length === 0);
    } finally {
      clearInterval(timer);
    }
    await expect(
      quarantine.inspect(reserved.id, attachmentScope),
    ).rejects.toMatchObject({ code: "ATTACHMENT_NOT_FOUND" });
  });

  it("removes only bounded Veda Mail orphan directories", async () => {
    const first = path.join(directory, "veda-mail-attachments-old-a");
    const second = path.join(directory, "veda-mail-attachments-old-b");
    const unrelated = path.join(directory, "unrelated");
    await Promise.all([mkdir(first), mkdir(second), mkdir(unrelated)]);
    await Promise.all([
      writeFile(path.join(first, "ciphertext"), "a"),
      writeFile(path.join(second, "ciphertext"), "b"),
      writeFile(path.join(unrelated, "keep"), "c"),
    ]);

    expect(removeAttachmentOrphanDirectories(directory, 1)).toBe(1);
    expect(
      (await readdir(directory)).filter((name) =>
        name.startsWith("veda-mail-attachments-"),
      ),
    ).toHaveLength(1);
    expect(removeAttachmentOrphanDirectories(directory, 1)).toBe(1);
    await expect(readdir(unrelated)).resolves.toEqual(["keep"]);
  });
});
