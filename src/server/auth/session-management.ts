import "server-only";

import { createHmac } from "node:crypto";

import { securityAuditSubkey } from "@/server/security-audit/security-audit-key";

export type ManagedSessionKind = "administrator" | "member";

export const sessionManagementId = (
  kind: ManagedSessionKind,
  sessionId: string,
): string =>
  createHmac("sha256", securityAuditSubkey("session-management"))
    .update(kind)
    .update("\0")
    .update(sessionId)
    .digest("base64url");
