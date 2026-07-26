import "server-only";

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import * as OTPAuth from "otpauth";
import { z } from "zod";

import { installationStore } from "@/server/installation/installation.store";
const FILE_NAME = "member-security.json";
const CONTEXT = "veda-mail/member-two-factor/v1";
const digestSchema = z.object({
  algorithm: z.literal("sha256"),
  digest: z.string().min(1),
  salt: z.string().min(1),
});
const encryptedSchema = z.object({
  algorithm: z.literal("aes-256-gcm"),
  ciphertext: z.string().min(1),
  iv: z.string().min(1),
  tag: z.string().min(1),
});
const memberSchema = z.object({
  enabledAt: z.string().datetime(),
  otpUrl: encryptedSchema,
  recoveryCodes: z.array(digestSchema).max(10),
});
const fileSchema = z.object({
  members: z.record(z.string(), memberSchema),
  updatedAt: z.string().datetime(),
  version: z.literal(1),
});
type SecurityFile = z.infer<typeof fileSchema>;
type MemberSecurity = z.infer<typeof memberSchema>;
type RecoveryDigest = z.infer<typeof digestSchema>;

const globalState = globalThis as typeof globalThis & {
  __vedaMailMemberSecurityQueue?: Promise<void>;
};
globalState.__vedaMailMemberSecurityQueue ??= Promise.resolve();

const dataDirectory = (): string =>
  process.env["VEDA_MAIL_DATA_DIR"] ??
  path.join(/*turbopackIgnore: true*/ process.cwd(), "data");
const filePath = (): string => path.join(dataDirectory(), FILE_NAME);
const normalizedEmail = (email: string): string => email.trim().toLowerCase();
const emptyFile = (): SecurityFile => ({
  members: {},
  updatedAt: new Date(0).toISOString(),
  version: 1,
});

const read = async (): Promise<SecurityFile> => {
  try {
    return fileSchema.parse(JSON.parse(await readFile(filePath(), "utf8")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyFile();
    throw error;
  }
};

const write = async (value: SecurityFile): Promise<void> => {
  const directory = dataDirectory();
  const temporary = path.join(directory, `.${FILE_NAME}.${crypto.randomUUID()}`);
  await mkdir(directory, { mode: 0o700, recursive: true });
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  });
  try {
    await rename(temporary, filePath());
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
};

const serialized = async <T>(task: () => Promise<T>): Promise<T> => {
  const result = globalState.__vedaMailMemberSecurityQueue!.then(task, task);
  globalState.__vedaMailMemberSecurityQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
};

const secret = async (): Promise<string> => {
  const installation = await installationStore.get();
  if (!installation) throw new Error("Veda Mail is not installed.");
  return installation.sessionSecret;
};
const key = (sessionSecret: string): Buffer =>
  createHash("sha256").update(CONTEXT).update("\0").update(sessionSecret).digest();
const aad = (email: string): Buffer => Buffer.from(`${CONTEXT}\0${email}`);

const encrypt = (
  value: string,
  email: string,
  sessionSecret: string,
): MemberSecurity["otpUrl"] => {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(sessionSecret), iv);
  cipher.setAAD(aad(email));
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return {
    algorithm: "aes-256-gcm",
    ciphertext: ciphertext.toString("base64url"),
    iv: iv.toString("base64url"),
    tag: cipher.getAuthTag().toString("base64url"),
  };
};

const decrypt = (
  value: MemberSecurity["otpUrl"],
  email: string,
  sessionSecret: string,
): string => {
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key(sessionSecret),
    Buffer.from(value.iv, "base64url"),
  );
  decipher.setAAD(aad(email));
  decipher.setAuthTag(Buffer.from(value.tag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(value.ciphertext, "base64url")),
    decipher.final(),
  ]).toString("utf8");
};

const normalizeCode = (value: string): string =>
  value.trim().toUpperCase().replaceAll(" ", "");
const digest = (code: string, salt: Buffer): RecoveryDigest => ({
  algorithm: "sha256",
  digest: createHash("sha256")
    .update(salt)
    .update("\0")
    .update(normalizeCode(code))
    .digest("base64url"),
  salt: salt.toString("base64url"),
});
const matches = (code: string, stored: RecoveryDigest): boolean => {
  const candidate = digest(code, Buffer.from(stored.salt, "base64url"));
  const left = Buffer.from(candidate.digest, "base64url");
  const right = Buffer.from(stored.digest, "base64url");
  return left.length === right.length && timingSafeEqual(left, right);
};
const recoveryCodes = () => {
  const codes = Array.from({ length: 10 }, () =>
    randomBytes(9).toString("hex").toUpperCase().match(/.{1,6}/g)!.join("-"),
  );
  return {
    codes,
    digests: codes.map((code) => digest(code, randomBytes(16))),
  };
};

export const memberTwoFactorSecurity = {
  async isEnabled(email: string): Promise<boolean> {
    return Boolean((await read()).members[normalizedEmail(email)]);
  },
  async enable(email: string, otpUrl: string) {
    return serialized(async () => {
      const normalized = normalizedEmail(email);
      const current = await read();
      if (current.members[normalized]) throw new Error("2FA is already enabled.");
      const recovery = recoveryCodes();
      const next = {
        ...current,
        members: {
          ...current.members,
          [normalized]: {
            enabledAt: new Date().toISOString(),
            otpUrl: encrypt(otpUrl, normalized, await secret()),
            recoveryCodes: recovery.digests,
          },
        },
        updatedAt: new Date().toISOString(),
      };
      await write(fileSchema.parse(next));
      return recovery.codes;
    });
  },

  async verify(email: string, code: string): Promise<boolean> {
    return serialized(async () => {
      const normalized = normalizedEmail(email);
      const current = await read();
      const member = current.members[normalized];
      if (!member) return false;
      try {
        if (/^\d{6}$/.test(code.trim())) {
          const authenticator = OTPAuth.URI.parse(
            decrypt(member.otpUrl, normalized, await secret()),
          );
          if (
            authenticator instanceof OTPAuth.TOTP &&
            authenticator.validate({ token: code.trim(), window: 1 }) !== null
          ) return true;
        }
        const index = member.recoveryCodes.findIndex((stored) =>
          matches(code, stored),
        );
        if (index < 0) return false;
        const updated = {
          ...current,
          members: {
            ...current.members,
            [normalized]: {
              ...member,
              recoveryCodes: member.recoveryCodes.filter(
                (_stored, currentIndex) => currentIndex !== index,
              ),
            },
          },
          updatedAt: new Date().toISOString(),
        };
        await write(fileSchema.parse(updated));
        return true;
      } catch {
        return false;
      }
    });
  },

  async disable(email: string): Promise<void> {
    await serialized(async () => {
      const normalized = normalizedEmail(email);
      const current = await read();
      const members = { ...current.members };
      delete members[normalized];
      await write(
        fileSchema.parse({
          ...current,
          members,
          updatedAt: new Date().toISOString(),
        }),
      );
    });
  },
};
