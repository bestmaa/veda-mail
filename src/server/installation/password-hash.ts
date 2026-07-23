import "server-only";

import { randomBytes, scrypt as nodeScrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

import type { PasswordDigest } from "@/domain/installation/installation";

const scrypt = promisify(nodeScrypt);
const KEY_LENGTH = 64;

const derive = async (password: string, salt: Buffer): Promise<Buffer> =>
  (await scrypt(password, salt, KEY_LENGTH)) as Buffer;

export const hashAdminPassword = async (
  password: string,
): Promise<PasswordDigest> => {
  const salt = randomBytes(24);
  const digest = await derive(password, salt);
  return {
    algorithm: "scrypt",
    digest: digest.toString("base64"),
    salt: salt.toString("base64"),
  };
};

export const verifyAdminPasswordDigest = async (
  candidate: string,
  stored: PasswordDigest,
): Promise<boolean> => {
  const expected = Buffer.from(stored.digest, "base64");
  const actual = await derive(candidate, Buffer.from(stored.salt, "base64"));
  return expected.length === actual.length && timingSafeEqual(expected, actual);
};
