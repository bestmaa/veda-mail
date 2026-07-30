import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
  vi.useRealTimers();
  await rm(directory, { force: true, recursive: true });
});

describe("attachment quarantine operation deadlines", () => {
  it("enforces the idle deadline while MIME detection hangs after scanning", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
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
    const rejection = expect(upload).rejects.toMatchObject({
      code: "ATTACHMENT_UPLOAD_TIMEOUT",
      status: 408,
    });
    await entered.promise;
    await vi.advanceTimersByTimeAsync(25);

    await rejection;
    await expect(readdir(directory)).resolves.toEqual([]);
  });

  it("does not commit a delayed MIME result after the total deadline", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
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
    const rejection = expect(upload).rejects.toMatchObject({
      code: "ATTACHMENT_UPLOAD_TIMEOUT",
      status: 408,
    });
    await entered.promise;
    await vi.advanceTimersByTimeAsync(25);

    await rejection;
    release.resolve();
    await Promise.resolve();
    await expect(readdir(directory)).resolves.toEqual([]);
    await expect(
      quarantine.inspect(reserved.id, attachmentScope),
    ).resolves.toMatchObject({ state: "rejected" });
  });
});
