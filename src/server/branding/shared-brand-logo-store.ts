import "server-only";

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  hkdfSync,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

import { z } from "zod";

import { scheduledJobRootKey } from
  "@/server/scheduled-send/scheduled-send-key";
import {
  runSharedStateRedis,
  sharedStateRedisConfigured,
  sharedStateRedisPrefix,
} from "@/server/shared-state/shared-state-redis";
import { ApiError } from "@/transport/http/api-error";

const MAX_LOGO_BYTES = 2 * 1_024 * 1_024;
const MAX_SERIALIZED_BYTES = 3 * 1_024 * 1_024;
const HASHED_LOGO_PATTERN = /^branding\/logo-([a-f0-9]{64})\.webp$/u;
const envelopeSchema = z.object({
  algorithm: z.literal("aes-256-gcm"),
  ciphertext: z.string().min(1).max(2_796_203)
    .regex(/^[A-Za-z0-9_-]+$/u),
  iv: z.string().regex(/^[A-Za-z0-9_-]{16}$/u),
  tag: z.string().regex(/^[A-Za-z0-9_-]{22}$/u),
  version: z.literal(1),
}).strict();

const subkey = (purpose: string): Buffer => Buffer.from(hkdfSync(
  "sha256",
  scheduledJobRootKey(),
  Buffer.alloc(0),
  `veda-mail/brand-logo/${purpose}/v1`,
  32,
));
const opaqueKey = (fileName: string): string => createHmac(
  "sha256", subkey("record-index"),
).update(fileName).digest("base64url");
const recordKey = (fileName: string): string =>
  `${sharedStateRedisPrefix()}:brand-logo:v1:${opaqueKey(fileName)}`;
const keyCheckKey = (): string =>
  `${sharedStateRedisPrefix()}:brand-logo:v1:key-check`;
const keyCheck = (): string => createHmac(
  "sha256", subkey("key-check"),
).update("veda-mail/brand-logo/key-check/v1").digest("base64url");
const aad = (fileName: string): Buffer =>
  Buffer.from(`veda-mail/brand-logo/payload/v1\0${fileName}`, "utf8");
const unavailable = (): never => {
  throw new ApiError(
    "Shared branding storage is temporarily unavailable.",
    "SHARED_BRANDING_UNAVAILABLE",
    503,
  );
};
const assertSize = (value: Buffer | string, maximum: number): void => {
  if (Buffer.byteLength(value) > maximum) unavailable();
};
const assertDigest = (fileName: string, contents: Buffer): void => {
  const expected = HASHED_LOGO_PATTERN.exec(fileName)?.[1];
  if (expected && createHash("sha256").update(contents).digest("hex") !== expected) {
    unavailable();
  }
};
const ensureKey = async (): Promise<void> => {
  const expected = keyCheck();
  let stored = await runSharedStateRedis((client) => client.get(keyCheckKey()));
  if (stored === null) {
    await runSharedStateRedis((client) => client.set(
      keyCheckKey(), expected, { NX: true },
    ));
    stored = await runSharedStateRedis((client) => client.get(keyCheckKey()));
  }
  const storedCheck = stored ?? unavailable();
  if (storedCheck.length === 0) unavailable();
  const actualBytes = Buffer.from(storedCheck, "utf8");
  const expectedBytes = Buffer.from(expected, "utf8");
  if (
    actualBytes.byteLength !== expectedBytes.byteLength ||
    !timingSafeEqual(actualBytes, expectedBytes)
  ) unavailable();
};
const encrypt = (fileName: string, contents: Buffer): string => {
  assertSize(contents, MAX_LOGO_BYTES);
  assertDigest(fileName, contents);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", subkey("encryption"), iv);
  cipher.setAAD(aad(fileName));
  const ciphertext = Buffer.concat([cipher.update(contents), cipher.final()]);
  return JSON.stringify({
    algorithm: "aes-256-gcm",
    ciphertext: ciphertext.toString("base64url"),
    iv: iv.toString("base64url"),
    tag: cipher.getAuthTag().toString("base64url"),
    version: 1,
  });
};
const decrypt = (fileName: string, serialized: string): Buffer => {
  assertSize(serialized, MAX_SERIALIZED_BYTES);
  const envelope = envelopeSchema.parse(JSON.parse(serialized));
  const decipher = createDecipheriv(
    "aes-256-gcm", subkey("encryption"),
    Buffer.from(envelope.iv, "base64url"),
  );
  decipher.setAAD(aad(fileName));
  decipher.setAuthTag(Buffer.from(envelope.tag, "base64url"));
  const contents = Buffer.concat([
    decipher.update(Buffer.from(envelope.ciphertext, "base64url")),
    decipher.final(),
  ]);
  assertSize(contents, MAX_LOGO_BYTES);
  assertDigest(fileName, contents);
  return contents;
};

export const sharedBrandLogoStore = {
  configured: sharedStateRedisConfigured,

  async put(fileName: string, contents: Buffer): Promise<void> {
    await ensureKey();
    const serialized = encrypt(fileName, contents);
    assertSize(serialized, MAX_SERIALIZED_BYTES);
    const created = await runSharedStateRedis((client) => client.set(
      recordKey(fileName), serialized, { NX: true },
    ));
    if (created === null) {
      const existing = await this.get(fileName);
      if (!existing) unavailable();
    }
  },

  async get(fileName: string): Promise<Buffer | null> {
    await ensureKey();
    const serialized = await runSharedStateRedis((client) =>
      client.get(recordKey(fileName)));
    return serialized ? decrypt(fileName, serialized) : null;
  },

  async remove(fileName: string): Promise<void> {
    await ensureKey();
    await runSharedStateRedis((client) => client.del(recordKey(fileName)));
  },
};
