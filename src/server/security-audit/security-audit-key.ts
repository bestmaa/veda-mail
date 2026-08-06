import "server-only";

import { createHmac, hkdfSync } from "node:crypto";

import { scheduledJobRootKey } from "@/server/scheduled-send/scheduled-send-key";

const NAMESPACE = "veda-mail/security-audit";

export const securityAuditSubkey = (context: string): Buffer => Buffer.from(
  hkdfSync(
    "sha256",
    scheduledJobRootKey(),
    Buffer.alloc(0),
    `${NAMESPACE}/${context}/v1`,
    32,
  ),
);

const digest = (context: string, value: string): string =>
  createHmac("sha256", securityAuditSubkey(context))
    .update(value, "utf8")
    .digest("base64url");

export const securityAuditKeyCheck = (): string =>
  digest("key-check", `${NAMESPACE}/key-check/v1`);

export const securityAuditSubjectId = (
  kind: "actor" | "target",
  value: string,
): string => digest(`${kind}-index`, `${kind}\0${value.trim().toLowerCase()}`);

export const securityAuditGenesis = (): string =>
  digest("entry-chain", `${NAMESPACE}/genesis/v1`);
