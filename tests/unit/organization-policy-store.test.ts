import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { organizationPolicyStore } from "@/server/organization/organization-policy.store";

const originalDirectory = process.env["VEDA_MAIL_DATA_DIR"];
let temporaryDirectory = "";

beforeEach(async () => {
  temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "veda-policy-"));
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

describe("organization policy store", () => {
  it("uses enabled compatibility defaults without creating upgrade state", async () => {
    await expect(organizationPolicyStore.get()).resolves.toEqual({
      memberPasswordChange: true,
      memberProfileEditing: true,
      memberTwoFactorEnrollment: true,
    });
    await expect(
      readFile(path.join(temporaryDirectory, "organization-policy.json")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("atomically persists a strict mode-0600 versioned record", async () => {
    const policy = {
      memberPasswordChange: false,
      memberProfileEditing: true,
      memberTwoFactorEnrollment: false,
    };
    await organizationPolicyStore.put(policy);
    const file = path.join(temporaryDirectory, "organization-policy.json");
    const [contents, fileStats] = await Promise.all([
      readFile(file, "utf8"),
      stat(file),
    ]);

    expect(fileStats.mode & 0o777).toBe(0o600);
    expect(JSON.parse(contents)).toMatchObject({ policy, version: 1 });
    await expect(organizationPolicyStore.get()).resolves.toEqual(policy);
  });

  it("serializes concurrent updates so the last admitted write wins", async () => {
    const first = organizationPolicyStore.put({
      memberPasswordChange: false,
      memberProfileEditing: false,
      memberTwoFactorEnrollment: false,
    });
    const secondPolicy = {
      memberPasswordChange: true,
      memberProfileEditing: false,
      memberTwoFactorEnrollment: true,
    };
    const second = organizationPolicyStore.put(secondPolicy);
    await Promise.all([first, second]);

    await expect(organizationPolicyStore.get()).resolves.toEqual(secondPolicy);
  });
});
