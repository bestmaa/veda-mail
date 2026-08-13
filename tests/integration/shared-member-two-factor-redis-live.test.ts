import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import * as OTPAuth from "otpauth";
import { createClient } from "redis";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  decryptMemberSecurity,
  encryptMemberSecurity,
  memberSecurityOwnerKey,
} from "@/server/auth/member-two-factor-crypto";
import { memberSecurityFilePath } from
  "@/server/auth/member-two-factor-file";
import { memberTwoFactorSecurity } from "@/server/auth/member-two-factor";
import { encryptedMemberSecuritySchema } from
  "@/server/auth/member-two-factor-record";
import { id } from "@/domain/shared/brand";
import type { InstallationDraft } from
  "@/server/installation/installation.store";
import { installationStore } from
  "@/server/installation/installation.store";
import { hashAdminPassword } from "@/server/installation/password-hash";
import { resetSharedStateRedisClientForTests } from
  "@/server/shared-state/shared-state-redis";
import { sharedOwnerRepository } from
  "@/server/shared-state/shared-owner-repository";

const redisUrl = process.env["VEDA_MAIL_TEST_REDIS_URL"];
const prefix = `veda-mail:test:member-2fa:${crypto.randomUUID()}`;
const email = "private@example.com";
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

describe.skipIf(!redisUrl)("live shared member two-factor security", () => {
  const inspector = createClient({ url: redisUrl! });
  let backupCodes: readonly string[] = [];
  let directory = "";
  let totp: OTPAuth.TOTP;
  const clear = async () => {
    const keys = await inspector.keys(`${prefix}:*`);
    if (keys.length > 0) await inspector.del(keys);
  };

  beforeAll(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), "veda-shared-member-2fa-"));
    process.env["VEDA_MAIL_DATA_DIR"] = directory;
    await installationStore.complete(installation);
    totp = new OTPAuth.TOTP({
      issuer: "Private Mail", label: email,
      secret: new OTPAuth.Secret({ size: 20 }),
    });
    backupCodes = await memberTwoFactorSecurity.enable(email, totp.toString());
    process.env["VEDA_MAIL_STATE_REDIS_URL"] = redisUrl;
    process.env["VEDA_MAIL_STATE_REDIS_PREFIX"] = prefix;
    await inspector.connect();
    await clear();
  });

  afterAll(async () => {
    resetSharedStateRedisClientForTests();
    await clear();
    inspector.destroy();
    await rm(directory, { force: true, recursive: true });
    delete process.env["VEDA_MAIL_DATA_DIR"];
    delete process.env["VEDA_MAIL_STATE_REDIS_URL"];
    delete process.env["VEDA_MAIL_STATE_REDIS_PREFIX"];
  });

  it("migrates opaque records and CAS-consumes a recovery code once", async () => {
    await expect(memberTwoFactorSecurity.isEnabled(email)).resolves.toBe(true);
    const archived = `${memberSecurityFilePath()}.migrated-to-redis`;
    expect(await readFile(archived, "utf8")).not.toContain(totp.secret.base32);
    await expect(stat(memberSecurityFilePath()))
      .rejects.toMatchObject({ code: "ENOENT" });

    const installed = await installationStore.get();
    if (!installed) throw new Error("Installation missing.");
    const sessionSecret = installed.sessionSecret;
    const ownerKey = memberSecurityOwnerKey(email, sessionSecret);
    const expected = await sharedOwnerRepository.get("member-two-factor", ownerKey);
    const encrypted = encryptedMemberSecuritySchema.parse(JSON.parse(expected!));
    const current = decryptMemberSecurity(encrypted, ownerKey, sessionSecret);
    const consumed = { ...current, recoveryCodes: current.recoveryCodes.slice(1) };
    const results = await Promise.all([0, 1].map(() =>
      sharedOwnerRepository.compareAndSet(
        "member-two-factor", ownerKey, expected,
        JSON.stringify(encryptMemberSecurity(consumed, ownerKey, sessionSecret)),
      )));
    expect(results.filter(Boolean)).toHaveLength(1);

    resetSharedStateRedisClientForTests();
    await expect(memberTwoFactorSecurity.verify(email, backupCodes[0]!))
      .resolves.toBe(false);
    await expect(memberTwoFactorSecurity.verify(email, totp.generate()))
      .resolves.toBe(true);
    const keys = await inspector.keys(`${prefix}:*`);
    const surface = JSON.stringify({ keys, values: await inspector.mGet(keys) });
    for (const privateValue of [
      email, "Private Mail", totp.secret.base32, backupCodes[0]!,
      current.enabledAt, current.recoveryCodes[0]!.digest,
    ]) expect(surface).not.toContain(privateValue);

    const [recordKey] = await inspector.keys(
      `${prefix}:owner-record:member-two-factor:record:*`,
    );
    const original = (await inspector.get(recordKey!))!;
    const tampered = JSON.parse(original);
    tampered.ciphertext = `${tampered.ciphertext.startsWith("A") ? "B" : "A"}${tampered.ciphertext.slice(1)}`;
    await inspector.set(recordKey!, JSON.stringify(tampered));
    resetSharedStateRedisClientForTests();
    await expect(memberTwoFactorSecurity.isEnabled(email)).rejects.toBeDefined();
    await expect(memberTwoFactorSecurity.verify(email, totp.generate()))
      .resolves.toBe(false);
  });
});
