import { mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { withSetupLock } from "@/server/installation/setup-lock";

const originalDirectory = process.env["VEDA_MAIL_DATA_DIR"];
let temporaryDirectory = "";

beforeEach(async () => {
  temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "veda-lock-"));
  process.env["VEDA_MAIL_DATA_DIR"] = temporaryDirectory;
});

afterEach(async () => {
  if (originalDirectory === undefined) {
    delete process.env["VEDA_MAIL_DATA_DIR"];
  } else {
    process.env["VEDA_MAIL_DATA_DIR"] = originalDirectory;
  }
  await rm(temporaryDirectory, { force: true, recursive: true });
});

describe("cross-process setup lock", () => {
  it("permits only one active setup owner", async () => {
    let releaseFirst = (): void => undefined;
    let markAcquired = (): void => undefined;
    const gate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const acquired = new Promise<void>((resolve) => {
      markAcquired = resolve;
    });
    const first = withSetupLock(async () => {
      markAcquired();
      return gate;
    });
    await acquired;

    await expect(withSetupLock(async () => "second")).rejects.toMatchObject({
      code: "SETUP_IN_PROGRESS",
      status: 409,
    });
    releaseFirst();
    await first;
  });

  it("reclaims a lock abandoned for more than five minutes", async () => {
    const lock = path.join(temporaryDirectory, ".setup.lock");
    await writeFile(lock, "abandoned", { mode: 0o600 });
    const old = new Date(Date.now() - 6 * 60 * 1000);
    await utimes(lock, old, old);

    await expect(withSetupLock(async () => "recovered")).resolves.toBe(
      "recovered",
    );
  });
});
