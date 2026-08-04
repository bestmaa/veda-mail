import "server-only";

import { createHmac, hkdfSync, timingSafeEqual } from "node:crypto";

import { scheduledJobRootKey } from "@/server/scheduled-send/scheduled-send-key";

export const snoozeSubkey = (context: string): Buffer => Buffer.from(hkdfSync(
  "sha256", scheduledJobRootKey(), Buffer.alloc(0),
  `veda-mail/snooze/${context}/v1`, 32,
));

export const snoozeConfigured = (): boolean => {
  try { scheduledJobRootKey(); return true; } catch { return false; }
};

export const snoozeKeyCheck = (): string =>
  createHmac("sha256", snoozeSubkey("key-check"))
    .update("veda-mail/snooze/key-check/v1").digest("base64url");

export const assertSnoozeKeyCheck = (stored: string): void => {
  const expected = Buffer.from(snoozeKeyCheck());
  const supplied = Buffer.from(stored);
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) {
    throw new Error("The snooze encryption key does not match the store.");
  }
};
