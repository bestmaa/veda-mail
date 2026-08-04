import "server-only";

import { createHmac, hkdfSync, timingSafeEqual } from "node:crypto";

import { scheduledJobRootKey } from "@/server/scheduled-send/scheduled-send-key";

const RULE_NAMESPACE = "veda-mail/member-rules";

export const ruleSubkey = (context: string): Buffer => Buffer.from(hkdfSync(
  "sha256",
  scheduledJobRootKey(),
  Buffer.alloc(0),
  `${RULE_NAMESPACE}/${context}/v1`,
  32,
));

export const ruleKeyCheck = (): string => createHmac(
  "sha256",
  ruleSubkey("key-check"),
).update(`${RULE_NAMESPACE}/key-check/v1`).digest("base64url");

export const assertRuleKeyCheck = (stored: string): void => {
  const expected = Buffer.from(ruleKeyCheck(), "utf8");
  const supplied = Buffer.from(stored, "utf8");
  if (expected.byteLength !== supplied.byteLength ||
      !timingSafeEqual(expected, supplied)) {
    throw new Error("The rules encryption key does not match the store.");
  }
};
