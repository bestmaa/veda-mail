import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  readBrandLogo,
  removeBrandLogo,
  writeBrandLogo,
} from "@/server/branding/logo-store";

const originalDirectory = process.env["VEDA_MAIL_DATA_DIR"];
let temporaryDirectory = "";

beforeEach(async () => {
  temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "veda-logo-"));
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

describe("content-addressed logo storage", () => {
  it("keeps concurrent branding assets under distinct safe names", async () => {
    const firstContents = Buffer.from("first normalized webp");
    const secondContents = Buffer.from("second normalized webp");
    const [first, second] = await Promise.all([
      writeBrandLogo(firstContents),
      writeBrandLogo(secondContents),
    ]);

    expect(first).toMatch(/^branding\/logo-[a-f0-9]{64}\.webp$/);
    expect(second).not.toBe(first);
    await expect(readBrandLogo(first)).resolves.toEqual(firstContents);
    await expect(readBrandLogo(second)).resolves.toEqual(secondContents);

    await removeBrandLogo(first);
    await expect(readBrandLogo(first)).resolves.toBeNull();
    await expect(readBrandLogo(second)).resolves.toEqual(secondContents);
  });

  it("rejects path traversal in persisted logo references", async () => {
    await expect(readBrandLogo("../../secret")).rejects.toMatchObject({
      code: "INVALID_LOGO",
    });
  });
});
