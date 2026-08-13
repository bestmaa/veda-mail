import "server-only";

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import * as OTPAuth from "otpauth";

import {
  decryptOtpUrl,
  encryptOtpUrl,
  normalizedMemberEmail,
} from "@/server/auth/member-two-factor-crypto";
import {
  readMemberSecurityFile,
  writeMemberSecurityFile,
} from "@/server/auth/member-two-factor-file";
import {
  type MemberSecurity,
  memberSecurityFileSchema,
  type RecoveryDigest,
} from "@/server/auth/member-two-factor-record";
import {
  ensureMemberSecurityMigrated,
  replaceSharedMemberSecurity,
  sharedMemberSecurity,
} from "@/server/auth/member-two-factor-shared";
import { installationStore } from "@/server/installation/installation.store";

const globalState = globalThis as typeof globalThis & {
  __vedaMailMemberSecurityQueue?: Promise<void>;
};
globalState.__vedaMailMemberSecurityQueue ??= Promise.resolve();
const serialized = async <T>(task: () => Promise<T>): Promise<T> => {
  const result = globalState.__vedaMailMemberSecurityQueue!.then(task, task);
  globalState.__vedaMailMemberSecurityQueue = result.then(
    () => undefined, () => undefined,
  );
  return result;
};

const secret = async (): Promise<string> => {
  const installation = await installationStore.get();
  if (!installation) throw new Error("Veda Mail is not installed.");
  return installation.sessionSecret;
};
const normalizeCode = (value: string) =>
  value.trim().toUpperCase().replaceAll(" ", "");
const digest = (code: string, salt: Buffer): RecoveryDigest => ({
  algorithm: "sha256",
  digest: createHash("sha256").update(salt).update("\0")
    .update(normalizeCode(code)).digest("base64url"),
  salt: salt.toString("base64url"),
});
const matches = (code: string, stored: RecoveryDigest): boolean => {
  const candidate = Buffer.from(
    digest(code, Buffer.from(stored.salt, "base64url")).digest,
    "base64url",
  );
  const expected = Buffer.from(stored.digest, "base64url");
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
};
const recoveryCodes = () => {
  const codes = Array.from({ length: 10 }, () =>
    randomBytes(9).toString("hex").toUpperCase().match(/.{1,6}/gu)!.join("-"));
  return { codes, digests: codes.map((code) => digest(code, randomBytes(16))) };
};
const verifiesTotp = (
  member: MemberSecurity, email: string, code: string, sessionSecret: string,
): boolean => {
  if (!/^\d{6}$/u.test(code.trim())) return false;
  const authenticator = OTPAuth.URI.parse(
    decryptOtpUrl(member.otpUrl, email, sessionSecret),
  );
  return authenticator instanceof OTPAuth.TOTP &&
    authenticator.validate({ token: code.trim(), window: 1 }) !== null;
};

const sharedMode = (sessionSecret: string) =>
  ensureMemberSecurityMigrated(sessionSecret);

export const memberTwoFactorSecurity = {
  async isEnabled(email: string): Promise<boolean> {
    const normalized = normalizedMemberEmail(email);
    const sessionSecret = await secret();
    if (await sharedMode(sessionSecret)) {
      return Boolean((await sharedMemberSecurity(normalized, sessionSecret)).security);
    }
    return Boolean((await readMemberSecurityFile()).members[normalized]);
  },

  async enable(email: string, otpUrl: string) {
    return serialized(async () => {
      const normalized = normalizedMemberEmail(email);
      const sessionSecret = await secret();
      const recovery = recoveryCodes();
      const now = new Date().toISOString();
      const updated: MemberSecurity = {
        enabledAt: now,
        otpUrl: encryptOtpUrl(otpUrl, normalized, sessionSecret),
        recoveryCodes: recovery.digests,
      };
      if (await sharedMode(sessionSecret)) {
        const current = await sharedMemberSecurity(normalized, sessionSecret);
        if (current.security) throw new Error("2FA is already enabled.");
        if (!await replaceSharedMemberSecurity(current, updated, sessionSecret)) {
          throw new Error("2FA is already enabled.");
        }
        return recovery.codes;
      }
      const current = await readMemberSecurityFile();
      if (current.members[normalized]) throw new Error("2FA is already enabled.");
      await writeMemberSecurityFile(memberSecurityFileSchema.parse({
        ...current,
        members: { ...current.members, [normalized]: updated },
        updatedAt: now,
      }));
      return recovery.codes;
    });
  },

  async verify(email: string, code: string): Promise<boolean> {
    return serialized(async () => {
      const normalized = normalizedMemberEmail(email);
      try {
        const sessionSecret = await secret();
        if (await sharedMode(sessionSecret)) {
          const current = await sharedMemberSecurity(normalized, sessionSecret);
          if (!current.security) return false;
          if (verifiesTotp(current.security, normalized, code, sessionSecret)) return true;
          const index = current.security.recoveryCodes.findIndex((value) =>
            matches(code, value));
          if (index < 0) return false;
          const updated = { ...current.security, recoveryCodes:
            current.security.recoveryCodes.filter((_, item) => item !== index) };
          return replaceSharedMemberSecurity(current, updated, sessionSecret);
        }
        const current = await readMemberSecurityFile();
        const member = current.members[normalized];
        if (!member) return false;
        if (verifiesTotp(member, normalized, code, sessionSecret)) return true;
        const index = member.recoveryCodes.findIndex((value) => matches(code, value));
        if (index < 0) return false;
        await writeMemberSecurityFile(memberSecurityFileSchema.parse({
          ...current,
          members: { ...current.members, [normalized]: { ...member,
            recoveryCodes: member.recoveryCodes.filter((_, item) => item !== index) } },
          updatedAt: new Date().toISOString(),
        }));
        return true;
      } catch { return false; }
    });
  },

  async disable(email: string): Promise<void> {
    await serialized(async () => {
      const normalized = normalizedMemberEmail(email);
      const sessionSecret = await secret();
      if (await sharedMode(sessionSecret)) {
        for (let attempt = 0; attempt < 5; attempt += 1) {
          const current = await sharedMemberSecurity(normalized, sessionSecret);
          if (!current.security ||
              await replaceSharedMemberSecurity(current, null, sessionSecret)) return;
        }
        throw new Error("Member 2FA changed concurrently.");
      }
      const current = await readMemberSecurityFile();
      const members = { ...current.members };
      delete members[normalized];
      await writeMemberSecurityFile(memberSecurityFileSchema.parse({
        ...current, members, updatedAt: new Date().toISOString(),
      }));
    });
  },
};
