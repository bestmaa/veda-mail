import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  attachmentScope,
  body,
  quarantineFixture,
  reserveText,
} from "./attachment-quarantine.fixture";

let directory = "";

beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "veda-attachment-timeout-"));
});

afterEach(async () => {
  await rm(directory, { force: true, recursive: true });
});

describe("attachment quarantine operation deadlines", () => {
  it("enforces the idle deadline while MIME detection hangs after scanning", async () => {
    const entered = Promise.withResolvers<void>();
    const quarantine = quarantineFixture(directory, {
      mimeDetector: {
        async detect() {
          entered.resolve();
          return new Promise(() => undefined);
        },
      },
      uploadIdleTimeoutMs: 25,
      uploadTimeoutMs: 250,
    });
    const reserved = await reserveText(quarantine, 4);
    const upload = quarantine.upload(
      reserved.id,
      attachmentScope,
      body("data"),
      4,
    );
    await entered.promise;

    await expect(upload).rejects.toMatchObject({
      code: "ATTACHMENT_UPLOAD_TIMEOUT",
      status: 408,
    });
    await expect(readdir(directory)).resolves.toEqual([]);
  });

  it("does not commit a delayed MIME result after the total deadline", async () => {
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const quarantine = quarantineFixture(directory, {
      mimeDetector: {
        async detect() {
          entered.resolve();
          await release.promise;
          return { mimeType: "text/plain", verdict: "accepted" };
        },
      },
      uploadIdleTimeoutMs: 250,
      uploadTimeoutMs: 25,
    });
    const reserved = await reserveText(quarantine, 4);
    const upload = quarantine.upload(
      reserved.id,
      attachmentScope,
      body("data"),
      4,
    );
    await entered.promise;

    await expect(upload).rejects.toMatchObject({
      code: "ATTACHMENT_UPLOAD_TIMEOUT",
      status: 408,
    });
    release.resolve();
    await Promise.resolve();
    await expect(readdir(directory)).resolves.toEqual([]);
    await expect(
      quarantine.inspect(reserved.id, attachmentScope),
    ).resolves.toMatchObject({ state: "rejected" });
  });
});
