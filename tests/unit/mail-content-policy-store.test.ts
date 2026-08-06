import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { DEFAULT_MAIL_CONTENT_POLICY } from "@/domain/installation/mail-content-policy";
import { mailContentPolicyStore } from "@/server/organization/mail-content-policy.store";

const originalDirectory = process.env["VEDA_MAIL_DATA_DIR"];
let temporaryDirectory = "";

beforeEach(async () => {
  temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "veda-mail-policy-"));
  process.env["VEDA_MAIL_DATA_DIR"] = temporaryDirectory;
});

afterEach(async () => {
  if (originalDirectory === undefined) delete process.env["VEDA_MAIL_DATA_DIR"];
  else process.env["VEDA_MAIL_DATA_DIR"] = originalDirectory;
  await rm(temporaryDirectory, { force: true, recursive: true });
});

describe("mail content policy store", () => {
  it("uses compatibility defaults without creating upgrade state", async () => {
    await expect(mailContentPolicyStore.get()).resolves.toEqual(DEFAULT_MAIL_CONTENT_POLICY);
    await expect(readFile(path.join(temporaryDirectory, "mail-content-policy.json")))
      .rejects.toMatchObject({ code: "ENOENT" });
  });

  it("atomically persists a strict mode-0600 versioned record", async () => {
    const next = { ...DEFAULT_MAIL_CONTENT_POLICY, blockedExtensions: ["exe"] };
    await mailContentPolicyStore.put(next);
    const file = path.join(temporaryDirectory, "mail-content-policy.json");
    const [contents, fileStats] = await Promise.all([readFile(file, "utf8"), stat(file)]);
    expect(fileStats.mode & 0o777).toBe(0o600);
    expect(JSON.parse(contents)).toMatchObject({ policy: next, version: 1 });
    await expect(mailContentPolicyStore.get()).resolves.toEqual(next);
  });

  it("serializes concurrent updates so the last admitted write wins", async () => {
    const first = mailContentPolicyStore.put({
      ...DEFAULT_MAIL_CONTENT_POLICY, blockedExtensions: ["exe"],
    });
    const last = { ...DEFAULT_MAIL_CONTENT_POLICY, blockedExtensions: ["js"] };
    await Promise.all([first, mailContentPolicyStore.put(last)]);
    await expect(mailContentPolicyStore.get()).resolves.toEqual(last);
  });
});
