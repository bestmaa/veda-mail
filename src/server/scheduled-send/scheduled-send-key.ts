import "server-only";

import { createHmac, hkdfSync, timingSafeEqual } from "node:crypto";

const ROOT_KEY_BYTES = 32;

const decodeKey = (encoded: string): Buffer => {
  if (!/^[A-Za-z0-9+/_-]+={0,2}$/u.test(encoded)) {
    throw new Error("VEDA_MAIL_JOB_KEY must be a base64 32-byte key.");
  }
  const key = Buffer.from(encoded, "base64");
  if (key.byteLength !== ROOT_KEY_BYTES) {
    throw new Error("VEDA_MAIL_JOB_KEY must be a base64 32-byte key.");
  }
  return key;
};

export const scheduledJobRootKey = (): Buffer => {
  const configured = process.env["VEDA_MAIL_JOB_KEY"]?.trim();
  if (!configured) {
    throw new Error("VEDA_MAIL_JOB_KEY is required for durable scheduled send.");
  }
  return decodeKey(configured);
};

export const scheduledJobSubkey = (context: string): Buffer =>
  Buffer.from(
    hkdfSync(
      "sha256",
      scheduledJobRootKey(),
      Buffer.alloc(0),
      `veda-mail/scheduled-send/${context}/v1`,
      32,
    ),
  );

export const scheduledSendConfigured = (): boolean => {
  try {
    scheduledJobRootKey();
    return true;
  } catch {
    return false;
  }
};

export const scheduledJobKeyCheck = (): string =>
  createHmac("sha256", scheduledJobSubkey("key-check"))
    .update("veda-mail/scheduled-send/key-check/v1")
    .digest("base64url");

export const assertScheduledJobKeyCheck = (stored: string): void => {
  const expected = Buffer.from(scheduledJobKeyCheck(), "utf8");
  const supplied = Buffer.from(stored, "utf8");
  if (
    expected.byteLength !== supplied.byteLength ||
    !timingSafeEqual(expected, supplied)
  ) {
    throw new Error("The scheduled-job encryption key does not match the store.");
  }
};
