import "server-only";

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import * as OTPAuth from "otpauth";
import QRCode from "qrcode";
import type {
  AdminEncryptedSecret,
  AdminRecoveryCodeDigest,
  AdminTwoFactor,
} from "@/domain/installation/installation";
const ENROLLMENT_TTL_MS = 10 * 60 * 1_000;
const RECOVERY_CODE_COUNT = 10;
const ENCRYPTION_CONTEXT = "veda-mail/admin-two-factor/v1";
interface PendingEnrollment {
  readonly createdAt: number;
  readonly otpUrl: string;
  readonly totp: OTPAuth.TOTP;
}
export interface AdminTwoFactorEnrollment {
  readonly qrDataUrl: string;
  readonly secret: string;
}
export interface AdminSecondFactorResult {
  readonly recoveryCodeIndex: number | null;
  readonly valid: boolean;
}
const globalState = globalThis as typeof globalThis & {
  __vedaMailAdminTwoFactorEnrollments?: Map<string, PendingEnrollment>;
};

const enrollments =
  globalState.__vedaMailAdminTwoFactorEnrollments ??
  new Map<string, PendingEnrollment>();
globalState.__vedaMailAdminTwoFactorEnrollments = enrollments;

const enrollmentKey = (authVersion: number, username: string): string =>
  `${authVersion}:${username}`;

const prune = (): void => {
  const expiresBefore = Date.now() - ENROLLMENT_TTL_MS;
  for (const [key, enrollment] of enrollments) {
    if (enrollment.createdAt < expiresBefore) enrollments.delete(key);
  }
};

const encryptionKey = (sessionSecret: string): Buffer =>
  createHash("sha256")
    .update(ENCRYPTION_CONTEXT)
    .update("\0")
    .update(sessionSecret)
    .digest();

const encrypt = (
  plaintext: string,
  sessionSecret: string,
): AdminEncryptedSecret => {
  const iv = randomBytes(12);
  const cipher = createCipheriv(
    "aes-256-gcm",
    encryptionKey(sessionSecret),
    iv,
  );
  cipher.setAAD(Buffer.from(ENCRYPTION_CONTEXT));
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  return {
    algorithm: "aes-256-gcm",
    ciphertext: ciphertext.toString("base64url"),
    iv: iv.toString("base64url"),
    tag: cipher.getAuthTag().toString("base64url"),
  };
};

const decrypt = (
  secret: AdminEncryptedSecret,
  sessionSecret: string,
): string => {
  const decipher = createDecipheriv(
    "aes-256-gcm",
    encryptionKey(sessionSecret),
    Buffer.from(secret.iv, "base64url"),
  );
  decipher.setAAD(Buffer.from(ENCRYPTION_CONTEXT));
  decipher.setAuthTag(Buffer.from(secret.tag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(secret.ciphertext, "base64url")),
    decipher.final(),
  ]).toString("utf8");
};

const normalizeRecoveryCode = (value: string): string =>
  value.trim().toUpperCase().replaceAll(" ", "");

const digestRecoveryCode = (
  code: string,
  salt: Buffer,
): AdminRecoveryCodeDigest => ({
  algorithm: "sha256",
  digest: createHash("sha256")
    .update(salt)
    .update("\0")
    .update(normalizeRecoveryCode(code))
    .digest("base64url"),
  salt: salt.toString("base64url"),
});

const recoveryCodeMatches = (
  code: string,
  stored: AdminRecoveryCodeDigest,
): boolean => {
  const candidate = digestRecoveryCode(
    code,
    Buffer.from(stored.salt, "base64url"),
  );
  const left = Buffer.from(candidate.digest, "base64url");
  const right = Buffer.from(stored.digest, "base64url");
  return left.length === right.length && timingSafeEqual(left, right);
};

const createRecoveryCodes = (): {
  readonly codes: readonly string[];
  readonly digests: readonly AdminRecoveryCodeDigest[];
} => {
  const codes = Array.from({ length: RECOVERY_CODE_COUNT }, () =>
    randomBytes(9)
      .toString("hex")
      .toUpperCase()
      .match(/.{1,6}/g)!
      .join("-"),
  );
  return {
    codes,
    digests: codes.map((code) => digestRecoveryCode(code, randomBytes(16))),
  };
};

export const adminTwoFactorEnrollmentStore = {
  async create(
    authVersion: number,
    username: string,
    issuer: string,
  ): Promise<AdminTwoFactorEnrollment> {
    prune();
    const totp = new OTPAuth.TOTP({
      algorithm: "SHA1",
      digits: 6,
      issuer,
      label: `Administrator (${username})`,
      period: 30,
      secret: new OTPAuth.Secret({ size: 20 }),
    });
    const otpUrl = totp.toString();
    enrollments.set(enrollmentKey(authVersion, username), {
      createdAt: Date.now(),
      otpUrl,
      totp,
    });
    return {
      qrDataUrl: await QRCode.toDataURL(otpUrl, {
        errorCorrectionLevel: "M",
        margin: 1,
        width: 240,
      }),
      secret: totp.secret.base32.replace(/(.{4})/g, "$1 ").trim(),
    };
  },

  confirm(
    authVersion: number,
    username: string,
    otpCode: string,
    sessionSecret: string,
  ): {
    readonly recoveryCodes: readonly string[];
    readonly twoFactor: AdminTwoFactor;
  } | null {
    prune();
    const key = enrollmentKey(authVersion, username);
    const enrollment = enrollments.get(key);
    if (
      !enrollment ||
      enrollment.totp.validate({ token: otpCode, window: 1 }) === null
    ) {
      return null;
    }
    const recovery = createRecoveryCodes();
    enrollments.delete(key);
    return {
      recoveryCodes: recovery.codes,
      twoFactor: {
        enabledAt: new Date().toISOString(),
        otpUrl: encrypt(enrollment.otpUrl, sessionSecret),
        recoveryCodes: recovery.digests,
      },
    };
  },

  remove(authVersion: number, username: string): void {
    enrollments.delete(enrollmentKey(authVersion, username));
  },
};

export const verifyAdminSecondFactor = (
  otpCode: string,
  twoFactor: AdminTwoFactor,
  sessionSecret: string,
): AdminSecondFactorResult => {
  try {
    if (/^\d{6}$/.test(otpCode.trim())) {
      const authenticator = OTPAuth.URI.parse(
        decrypt(twoFactor.otpUrl, sessionSecret),
      );
      if (
        authenticator instanceof OTPAuth.TOTP &&
        authenticator.validate({ token: otpCode.trim(), window: 1 }) !== null
      ) {
        return { recoveryCodeIndex: null, valid: true };
      }
    }
    let recoveryCodeIndex: number | null = null;
    twoFactor.recoveryCodes.forEach((stored, index) => {
      if (recoveryCodeMatches(otpCode, stored)) recoveryCodeIndex = index;
    });
    return {
      recoveryCodeIndex,
      valid: recoveryCodeIndex !== null,
    };
  } catch {
    return { recoveryCodeIndex: null, valid: false };
  }
};

export const withoutRecoveryCode = (
  twoFactor: AdminTwoFactor,
  index: number,
): AdminTwoFactor => ({
  ...twoFactor,
  recoveryCodes: twoFactor.recoveryCodes.filter(
    (_code, current) => current !== index,
  ),
});
